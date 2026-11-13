import type {Entity} from "../../engine/core";
import type {SceneJsonValue} from "../../engine/scene";
import type {EditorEntitySummary, EditorFieldDescription, EditorFieldValue} from "../editorProtocol";
import {
    assetText,
    entityLabel,
    entityOptionValue,
    eulerDegreeText,
    isInlineAssetSummary,
    NO_ENTITY_OPTION_VALUE,
    numberText,
    parseAssetPathText,
    parseEntityOptionValue,
    parseEulerDegreeTexts,
    parseIntegerText,
    parseNumberText,
    parseRgbText,
    parseStringText,
    parseTextColorParts,
    parseTextLinesText,
    quaternionOfEulerDegrees,
    rgbText,
    stringText,
    TEXT_COLOR_MODES,
    textColorParts,
    textForTextColorMode,
    textLinesText,
    vec3Texts,
    vec3WithComponentText,
} from "./fieldValueText";
import type {ParsedFieldText, TextColorMode} from "./fieldValueText";
import type {RotationEulerCache} from "./rotationEulerCache";

export interface FieldEditorContext {
    readonly entity: Entity;
    readonly typeName: string;
    readonly field: EditorFieldDescription;
    readonly rotations: RotationEulerCache;

    entities(): readonly EditorEntitySummary[];

    commit(value: SceneJsonValue): Promise<EditorFieldValue | undefined>;

    reportInvalid(message: string): void;
}

export interface FieldEditor {
    readonly element: HTMLElement;

    show(value: EditorFieldValue): void;

    showEntityChoices(): void;
}

export const ENTITY_CHOICE_LIMIT = 500;

type NumberKind = "number" | "integer";

interface SelectOption {
    readonly value: string;
    readonly label: string;
}

const AXIS_NAMES = ["x", "y", "z"];
const DEGREE_SIGN = "°";
const DECIMAL_INPUT_MODE = "decimal";
const INTEGER_STEP = "1";
const MAX_TEXTAREA_ROWS = 12;
const MIN_TEXTAREA_ROWS = 2;
const LINE_SEPARATOR = "\n";
const NO_ENTITY_LABEL = "(none)";
const NULL_STRING_PLACEHOLDER = "(none)";
const ASSET_PATH_PLACEHOLDER = "path/to/file";
const ROTATION_ORDER_HINT = "Euler angles in degrees, applied Z (yaw), then Y (pitch), then X (roll)";
const TEXT_COLOR_PLACEHOLDERS: Readonly<Record<TextColorMode, string>> = {default: "", palette: "0-255", rgb: "#rrggbb"};

function createElement<K extends keyof HTMLElementTagNameMap>(document: Document, tag: K, className: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    element.className = className;
    return element;
}

function textInput(document: Document, ariaLabel: string): HTMLInputElement {
    const input = createElement(document, "input", "field-input");
    input.type = "text";
    input.spellcheck = false;
    input.setAttribute("aria-label", ariaLabel);
    return input;
}

function decimalInput(document: Document, ariaLabel: string): HTMLInputElement {
    const input = textInput(document, ariaLabel);
    input.inputMode = DECIMAL_INPUT_MODE;
    input.classList.add("number");
    return input;
}

function fillSelect(select: HTMLSelectElement, options: readonly SelectOption[]): void {
    select.replaceChildren(...options.map(({value, label}) => {
        const option = select.ownerDocument.createElement("option");
        option.value = value;
        option.textContent = label;
        return option;
    }));
}

abstract class FieldEditorBase implements FieldEditor {
    public readonly element: HTMLElement;
    protected lastValue: EditorFieldValue | undefined;

    protected constructor(protected readonly context: FieldEditorContext, protected readonly document: Document) {
        this.element = createElement(document, "div", `field-editor kind-${context.field.kind}`);
    }

    protected get fieldLabel(): string {
        return `${this.context.typeName}.${this.context.field.key}`;
    }

    public show(value: EditorFieldValue): void {
        this.lastValue = value;
        if (!this.hasFocus()) this.render(value);
    }

    public showEntityChoices(): void {
    }

    protected abstract render(value: EditorFieldValue): void;

    protected revert(): void {
        if (this.lastValue !== undefined) this.render(this.lastValue);
    }

    protected rejectText(reason: string): void {
        this.context.reportInvalid(`${this.fieldLabel}: ${reason}`);
        this.revert();
    }

    protected commitParsed(parsed: ParsedFieldText): void {
        if (parsed.valid) this.commit(parsed.value);
        else this.rejectText(parsed.reason);
    }

    protected commit(value: SceneJsonValue, onStored?: (stored: EditorFieldValue) => void): void {
        void this.context.commit(value).then(stored => {
            if (stored === undefined) {
                this.revert();
                return;
            }
            onStored?.(stored);
            this.show(stored);
        });
    }

    protected hasFocus(): boolean {
        const active = this.document.activeElement;
        return active !== null && this.element.contains(active);
    }
}

class NumberFieldEditor extends FieldEditorBase {
    private readonly input: HTMLInputElement;

    public constructor(context: FieldEditorContext, document: Document, private readonly numberKind: NumberKind) {
        super(context, document);
        if (numberKind === "integer") {
            this.input = createElement(document, "input", "field-input number");
            this.input.type = "number";
            this.input.step = INTEGER_STEP;
            this.input.setAttribute("aria-label", this.fieldLabel);
        } else {
            this.input = decimalInput(document, this.fieldLabel);
        }
        this.input.addEventListener("change", () => this.commitParsed(this.parse(this.input.value)));
        this.element.append(this.input);
    }

    protected render(value: EditorFieldValue): void {
        this.input.value = numberText(value);
    }

    private parse(text: string): ParsedFieldText {
        return this.numberKind === "integer" ? parseIntegerText(text) : parseNumberText(text);
    }
}

class Vec3FieldEditor extends FieldEditorBase {
    private readonly inputs: HTMLInputElement[];

    public constructor(context: FieldEditorContext, document: Document) {
        super(context, document);
        this.inputs = AXIS_NAMES.map((axis, index) => {
            const input = decimalInput(document, `${this.fieldLabel} ${axis}`);
            input.placeholder = axis;
            input.addEventListener("change", () => this.commitComponent(index));
            return input;
        });
        this.element.append(...this.inputs);
    }

    protected render(value: EditorFieldValue): void {
        const texts = vec3Texts(value);
        this.inputs.forEach((input, index) => input.value = texts[index]);
    }

    private commitComponent(index: number): void {
        if (this.lastValue === undefined) return;
        this.commitParsed(vec3WithComponentText(this.lastValue, index, this.inputs[index].value));
    }
}

class RotationFieldEditor extends FieldEditorBase {
    private readonly inputs: HTMLInputElement[];

    public constructor(context: FieldEditorContext, document: Document) {
        super(context, document);
        this.inputs = AXIS_NAMES.map(axis => {
            const input = decimalInput(document, `${this.fieldLabel} ${axis} in degrees`);
            input.placeholder = axis + DEGREE_SIGN;
            input.addEventListener("change", () => this.commitDegrees());
            return input;
        });
        this.element.append(...this.inputs);
        this.element.title = ROTATION_ORDER_HINT;
    }

    protected render(value: EditorFieldValue): void {
        const {entity, typeName, field, rotations} = this.context;
        const degrees = rotations.degreesFor(entity, typeName, field.key, value);
        this.inputs.forEach((input, index) => input.value = eulerDegreeText(degrees[index]));
    }

    private commitDegrees(): void {
        const parsed = parseEulerDegreeTexts(this.inputs.map(input => input.value));
        if (!parsed.valid) {
            this.rejectText(parsed.reason);
            return;
        }
        const {entity, typeName, field, rotations} = this.context;
        this.commit(quaternionOfEulerDegrees(parsed.degrees), stored => rotations.remember(entity, typeName, field.key, stored as SceneJsonValue, parsed.degrees));
    }
}

class RgbFieldEditor extends FieldEditorBase {
    private readonly input: HTMLInputElement;

    public constructor(context: FieldEditorContext, document: Document) {
        super(context, document);
        this.input = createElement(document, "input", "field-input color");
        this.input.type = "color";
        this.input.setAttribute("aria-label", this.fieldLabel);
        this.input.addEventListener("change", () => this.commitParsed(parseRgbText(this.input.value)));
        this.element.append(this.input);
    }

    protected render(value: EditorFieldValue): void {
        this.input.value = rgbText(value);
    }
}

class TextColorFieldEditor extends FieldEditorBase {
    private readonly mode: HTMLSelectElement;
    private readonly input: HTMLInputElement;

    public constructor(context: FieldEditorContext, document: Document) {
        super(context, document);
        this.mode = createElement(document, "select", "field-input");
        this.mode.setAttribute("aria-label", `${this.fieldLabel} kind`);
        fillSelect(this.mode, TEXT_COLOR_MODES.map(mode => ({value: mode, label: mode})));
        this.input = textInput(document, `${this.fieldLabel} value`);
        this.mode.addEventListener("change", () => {
            this.input.value = textForTextColorMode(this.selectedMode(), this.input.value);
            this.updateInputState();
            this.commitParts();
        });
        this.input.addEventListener("change", () => this.commitParts());
        this.element.append(this.mode, this.input);
    }

    protected render(value: EditorFieldValue): void {
        const parts = textColorParts(value);
        this.mode.value = parts.mode;
        this.input.value = parts.text;
        this.updateInputState();
    }

    private selectedMode(): TextColorMode {
        return TEXT_COLOR_MODES.find(mode => mode === this.mode.value) ?? TEXT_COLOR_MODES[0];
    }

    private updateInputState(): void {
        const mode = this.selectedMode();
        this.input.disabled = mode === "default";
        this.input.placeholder = TEXT_COLOR_PLACEHOLDERS[mode];
    }

    private commitParts(): void {
        this.commitParsed(parseTextColorParts({mode: this.selectedMode(), text: this.input.value}));
    }
}

class BooleanFieldEditor extends FieldEditorBase {
    private readonly input: HTMLInputElement;

    public constructor(context: FieldEditorContext, document: Document) {
        super(context, document);
        this.input = createElement(document, "input", "field-input checkbox");
        this.input.type = "checkbox";
        this.input.setAttribute("aria-label", this.fieldLabel);
        this.input.addEventListener("change", () => this.commit(this.input.checked));
        this.element.append(this.input);
    }

    protected render(value: EditorFieldValue): void {
        this.input.checked = value === true;
    }
}

class StringFieldEditor extends FieldEditorBase {
    private readonly input: HTMLInputElement;

    public constructor(context: FieldEditorContext, document: Document, private readonly nullable: boolean) {
        super(context, document);
        this.input = textInput(document, this.fieldLabel);
        if (nullable) this.input.placeholder = NULL_STRING_PLACEHOLDER;
        this.input.addEventListener("change", () => this.commit(parseStringText(this.input.value, {nullable: this.nullable})));
        this.element.append(this.input);
    }

    protected render(value: EditorFieldValue): void {
        this.input.value = stringText(value);
    }
}

class TextLinesFieldEditor extends FieldEditorBase {
    private readonly textarea: HTMLTextAreaElement;

    public constructor(context: FieldEditorContext, document: Document) {
        super(context, document);
        this.textarea = createElement(document, "textarea", "field-input text-lines");
        this.textarea.spellcheck = false;
        this.textarea.wrap = "off";
        this.textarea.setAttribute("aria-label", this.fieldLabel);
        this.textarea.addEventListener("change", () => this.commit(parseTextLinesText(this.textarea.value)));
        this.element.append(this.textarea);
    }

    protected render(value: EditorFieldValue): void {
        const text = textLinesText(value);
        this.textarea.value = text;
        this.textarea.rows = Math.max(MIN_TEXTAREA_ROWS, Math.min(MAX_TEXTAREA_ROWS, text.split(LINE_SEPARATOR).length));
    }
}

class EnumFieldEditor extends FieldEditorBase {
    private readonly select: HTMLSelectElement;

    public constructor(context: FieldEditorContext, document: Document, names: readonly string[]) {
        super(context, document);
        this.select = createElement(document, "select", "field-input");
        this.select.setAttribute("aria-label", this.fieldLabel);
        fillSelect(this.select, names.map(name => ({value: name, label: name})));
        this.select.addEventListener("change", () => this.commit(this.select.value));
        this.element.append(this.select);
    }

    protected render(value: EditorFieldValue): void {
        this.select.value = typeof value === "string" ? value : "";
    }
}

class EntityFieldEditor extends FieldEditorBase {
    private readonly select: HTMLSelectElement;
    private shownChoices: readonly EditorEntitySummary[] | undefined;
    private shownValue: string | undefined;

    public constructor(context: FieldEditorContext, document: Document, private readonly nullable: boolean) {
        super(context, document);
        this.select = createElement(document, "select", "field-input");
        this.select.setAttribute("aria-label", this.fieldLabel);
        this.select.addEventListener("change", () => this.commit(parseEntityOptionValue(this.select.value)));
        this.element.append(this.select);
    }

    public override showEntityChoices(): void {
        if (this.lastValue !== undefined && !this.hasFocus()) this.render(this.lastValue);
    }

    protected render(value: EditorFieldValue): void {
        const choices = this.context.entities();
        const selected = entityOptionValue(value);
        if (choices !== this.shownChoices || selected !== this.shownValue) {
            this.shownChoices = choices;
            this.shownValue = selected;
            fillSelect(this.select, this.options(choices, selected));
        }
        this.select.value = selected;
    }

    private options(choices: readonly EditorEntitySummary[], selected: string): SelectOption[] {
        const options: SelectOption[] = choices.slice(0, ENTITY_CHOICE_LIMIT)
            .map(summary => ({value: String(summary.entity), label: entityLabel(summary.entity, summary.name)}));
        if (this.nullable) options.unshift({value: NO_ENTITY_OPTION_VALUE, label: NO_ENTITY_LABEL});
        if (!options.some(option => option.value === selected)) {
            const pastLimit = choices.find(summary => String(summary.entity) === selected);
            options.push({
                value: selected,
                label: selected === NO_ENTITY_OPTION_VALUE ? NO_ENTITY_LABEL
                    : pastLimit === undefined ? `Entity ${selected} (not listed)` : entityLabel(pastLimit.entity, pastLimit.name),
            });
        }
        return options;
    }
}

class AssetFieldEditor extends FieldEditorBase {
    private readonly input: HTMLInputElement;
    private readonly inline: HTMLElement;

    public constructor(context: FieldEditorContext, document: Document) {
        super(context, document);
        this.input = textInput(document, `${this.fieldLabel} file path`);
        this.input.placeholder = ASSET_PATH_PLACEHOLDER;
        this.input.addEventListener("change", () => this.commit(parseAssetPathText(this.input.value)));
        this.inline = createElement(document, "span", "field-read-only");
        this.element.append(this.input, this.inline);
    }

    protected render(value: EditorFieldValue): void {
        const inline = isInlineAssetSummary(value);
        this.input.hidden = inline;
        this.inline.hidden = !inline;
        if (inline) this.inline.textContent = assetText(value);
        else this.input.value = assetText(value);
    }
}

export function createFieldEditor(document: Document, context: FieldEditorContext): FieldEditor {
    const field = context.field;
    switch (field.kind) {
        case "number":
        case "integer":
            return new NumberFieldEditor(context, document, field.kind);
        case "vec3":
            return new Vec3FieldEditor(context, document);
        case "rotation":
            return new RotationFieldEditor(context, document);
        case "rgb":
            return new RgbFieldEditor(context, document);
        case "textColor":
            return new TextColorFieldEditor(context, document);
        case "boolean":
            return new BooleanFieldEditor(context, document);
        case "string":
            return new StringFieldEditor(context, document, field.nullable);
        case "textLines":
            return new TextLinesFieldEditor(context, document);
        case "enum":
            return new EnumFieldEditor(context, document, field.enumNames);
        case "entity":
            return new EntityFieldEditor(context, document, field.nullable);
        case "mesh":
        case "spriteImage":
            return new AssetFieldEditor(context, document);
    }
}
