import type {NumberFieldOptions, SceneJsonValue} from "../../engine/scene";
import type {EditorFieldValue, NumberFieldDescription} from "../editorProtocol";
import {FIELD_INPUT_HOOK} from "../project/editorUiHooks";
import type {FieldInputKind} from "../project/editorUiHooks";
import {ListFieldEditor, StructFieldEditor} from "./compoundFieldEditors";
import {createElement} from "./dom";
import {fieldDrawers} from "./fieldDrawers";
import type {FieldDrawerRegistry} from "./fieldDrawers";
import {
    DECIMAL_INPUT_MODE,
    FieldEditorBase,
    fillSelect,
    gestureKey,
    installScrub,
    installStepping,
    InvalidFieldText,
    isNullValue,
    MIXED_CLASS,
    MIXED_OPTION_VALUE,
    numberInput,
    numericOf,
    NUMERIC_INPUT_MODE,
    selectValue,
    showText,
    showToggle,
    stepperButtons,
    textInput,
    toggleControl,
    TYPING,
} from "./fieldEditorBase";
import type {FieldEditor, FieldEditorContext} from "./fieldEditorBase";
import {
    clampedWire,
    clampToRange,
    eulerDegreesOfQuaternion,
    eulerDegreeText,
    float32Text,
    jsonFieldText,
    numberOfWire,
    numberText,
    parseFiniteNumberText,
    parseIntegerText,
    parseJsonFieldText,
    parseNumberText,
    parseRgbText,
    parseStringText,
    parseTextColorParts,
    parseTextLinesText,
    POSITIVE_INFINITY_WIRE,
    quaternionOfEulerDegrees,
    rgbText,
    sliderRangeOf,
    stringText,
    TEXT_COLOR_MODES,
    textColorParts,
    textForTextColorMode,
    textLinesText,
    wireNumber,
} from "./fieldValueText";
import type {EulerDegrees, ParsedFieldText, TextColorMode} from "./fieldValueText";
import {mixedValueOf} from "./multiSelection";
import {AssetFieldEditor, EntityFieldEditor} from "./referenceFieldEditors";
import {baseStepFor, scrubUnitsPerPixelForStep, steppedValue} from "./scrubMath";
import type {ScrubKind, StepDirection, StepModifiers} from "./scrubMath";

export type {FieldEditor, FieldEditorContext, FieldEditorServices} from "./fieldEditorBase";
export {ENTITY_CHOICE_LIMIT, MIXED_VALUE_TEXT, SCRUB_START_THRESHOLD_PX} from "./fieldEditorBase";

const AXIS_NAMES = ["X", "Y", "Z"];
const AXIS_CLASSES = ["axis-x", "axis-y", "axis-z"];
const VEC2_AXES = 2;
const VEC3_AXES = 3;
const DEGREE_SIGN = "°";
const MAX_TEXTAREA_ROWS = 12;
const MIN_TEXTAREA_ROWS = 2;
const LINE_SEPARATOR = "\n";
const NULL_STRING_PLACEHOLDER = "(none)";
const NULL_NUMBER_PLACEHOLDER = "(none)";
const UNCAPPED_PLACEHOLDER = "no cap";
const NONE_TOGGLE_TEXT = "None";
const UNCAPPED_TOGGLE_TEXT = "Uncapped";
const ROTATION_ORDER_HINT = "Euler angles in degrees, applied Z (yaw), then Y (pitch), then X (roll)";
const TEXT_COLOR_PLACEHOLDERS: Readonly<Record<TextColorMode, string>> = {default: "", palette: "0-255", rgb: "#rrggbb"};
const NO_OPTIONS: NumberFieldOptions = {};
const NULL_VALUE: SceneJsonValue = null;
const UNREADABLE_ROTATION: EulerDegrees = [Number.NaN, Number.NaN, Number.NaN];
const FALLBACK_NUMBER = 0;
const TEXT_LINES_FIELD_INPUT: FieldInputKind = "textLines";

function vectorComponents(value: EditorFieldValue, length: number): SceneJsonValue[] {
    if (!Array.isArray(value) || value.length !== length) throw new InvalidFieldText(`${JSON.stringify(value)} is not ${length} numbers`);
    return [...value];
}

function withComponent(value: EditorFieldValue, length: number, index: number, component: SceneJsonValue): SceneJsonValue {
    const components = vectorComponents(value, length);
    components[index] = component;
    return components;
}

function componentValues(values: readonly EditorFieldValue[], index: number): EditorFieldValue[] {
    return values.map(value => Array.isArray(value) ? value[index] ?? null : null);
}

function textAreaRows(text: string | undefined): number {
    return Math.max(MIN_TEXTAREA_ROWS, Math.min(MAX_TEXTAREA_ROWS, (text ?? "").split(LINE_SEPARATOR).length));
}

function isUncappedValue(value: EditorFieldValue): boolean {
    return value === POSITIVE_INFINITY_WIRE;
}

class NumberFieldEditor extends FieldEditorBase {
    private readonly input: HTMLInputElement;
    private readonly slider: HTMLInputElement | undefined;
    private readonly noneToggle: HTMLInputElement | undefined;
    private readonly uncappedToggle: HTMLInputElement | undefined;
    private readonly scrubKind: ScrubKind;
    private readonly options: NumberFieldOptions;
    private readonly uncapped: boolean;
    private lastFinite: number | undefined;

    public constructor(context: FieldEditorContext, document: Document, field: NumberFieldDescription) {
        super(context, document);
        const integer = field.kind === "integer";
        this.scrubKind = integer ? "integer" : "number";
        this.options = field.options ?? NO_OPTIONS;
        this.uncapped = field.kind === "number" && field.uncapped === true;
        this.input = numberInput(document, this.fieldLabel, integer ? NUMERIC_INPUT_MODE : DECIMAL_INPUT_MODE);
        const parse = (text: string): ParsedFieldText => clampedWire(integer ? parseIntegerText(text) : parseNumberText(text), this.options, this.uncapped);
        this.commitParsedWhileTyping(this.input, parse);
        this.input.addEventListener("change", () => this.commitParsed(parse(this.input.value)));
        installStepping(this.input, (direction, modifiers) => void this.commitEach(current => this.stepped(current, direction, modifiers), this.focusKey));
        installScrub(context.label, {
            kind: this.scrubKind,
            unitsPerPixel: scrubUnitsPerPixelForStep(this.options.step, this.scrubKind),
            startValues: () => this.values.map(numericOf),
            apply: (values, key) => this.commitEach((_, index) => this.bounded(values[index]), key),
        }, key => this.endGesture(key));
        const range = sliderRangeOf(this.options);
        if (range !== undefined) {
            const slider = createElement(document, "input", "field-input slider");
            slider.type = "range";
            slider.min = String(range.min);
            slider.max = String(range.max);
            slider.step = this.options.step === undefined ? "any" : String(this.options.step);
            slider.setAttribute("aria-label", `${this.fieldLabel} slider`);
            this.sendWhileTyping(slider, key => this.commitValues(() => this.bounded(Number(slider.value)), key, TYPING).then(stored => {
                if (stored !== undefined) this.render(stored);
            }));
            slider.addEventListener("change", () => {
                const key = this.focusKey;
                this.focusKey = gestureKey("slider");
                this.afterTyping(() => this.endGesture(key));
            });
            this.slider = slider;
            this.element.append(slider);
        }
        this.element.append(this.input);
        if (this.options.unit !== undefined) this.element.append(createElement(document, "span", "field-unit", this.options.unit));
        this.element.append(stepperButtons(document, this.fieldLabel, (direction, modifiers) => {
            const key = gestureKey("stepper");
            void this.commitEach(current => this.stepped(current, direction, modifiers), key).then(() => this.endGesture(key));
        }));
        if (field.nullable === true) {
            const toggle = toggleControl(document, NONE_TOGGLE_TEXT, `${this.fieldLabel} has no value`);
            toggle.input.addEventListener("change", () => this.commitAll(toggle.input.checked ? NULL_VALUE : this.bounded(this.lastFinite ?? FALLBACK_NUMBER)));
            this.noneToggle = toggle.input;
            this.element.append(toggle.element);
        }
        if (this.uncapped) {
            const toggle = toggleControl(document, UNCAPPED_TOGGLE_TEXT, `${this.fieldLabel} has no cap (Infinity)`);
            toggle.input.addEventListener("change", () => this.toggleUncapped(toggle.input.checked));
            this.uncappedToggle = toggle.input;
            this.element.append(toggle.element);
        }
    }

    protected render(values: readonly EditorFieldValue[]): void {
        const none = this.noneToggle === undefined ? false : showToggle(this.noneToggle, values, isNullValue);
        const unbounded = this.uncappedToggle === undefined ? false : showToggle(this.uncappedToggle, values, isUncappedValue);
        const shared = mixedValueOf(values);
        const number = shared === undefined || shared.mixed ? undefined : numberOfWire(shared.value as SceneJsonValue);
        if (number !== undefined && Number.isFinite(number)) this.lastFinite = number;
        const placeholder = none ? NULL_NUMBER_PLACEHOLDER : unbounded ? UNCAPPED_PLACEHOLDER : undefined;
        if (placeholder === undefined) delete this.input.dataset.placeholder;
        else this.input.dataset.placeholder = placeholder;
        const hidesNumber = none || unbounded;
        this.input.disabled = hidesNumber;
        showText(this.input, shared === undefined || shared.mixed ? undefined : hidesNumber ? "" : numberText(shared.value));
        if (this.slider !== undefined) {
            const finite = number !== undefined && Number.isFinite(number);
            this.slider.disabled = !finite;
            if (finite) this.slider.value = String(number);
            this.slider.classList.toggle(MIXED_CLASS, shared?.mixed === true);
        }
    }

    protected override hasFocus(): boolean {
        const active = this.input.ownerDocument.activeElement;
        return active === this.input || (this.slider !== undefined && active === this.slider);
    }

    private bounded(value: number): SceneJsonValue {
        return wireNumber(clampToRange(value, this.options, this.uncapped));
    }

    private stepped(current: EditorFieldValue, direction: StepDirection, modifiers: StepModifiers): SceneJsonValue {
        const value = numericOf(current);
        if (value === Number.POSITIVE_INFINITY && this.uncapped) return wireNumber(value);
        return this.bounded(steppedValue(value, direction, modifiers, this.scrubKind, baseStepFor(this.options.step, this.scrubKind)));
    }

    private toggleUncapped(uncapped: boolean): void {
        if (uncapped) {
            this.commitAll(POSITIVE_INFINITY_WIRE);
            return;
        }
        if (this.lastFinite !== undefined) {
            this.commitAll(this.bounded(this.lastFinite));
            return;
        }
        this.input.disabled = false;
        delete this.input.dataset.placeholder;
        showText(this.input, "");
        this.input.focus();
    }
}

abstract class AxisFieldEditor extends FieldEditorBase {
    protected readonly inputs: HTMLInputElement[];

    protected constructor(context: FieldEditorContext, document: Document, axisCount: number, private readonly scrubKind: ScrubKind, unitSuffix: string) {
        super(context, document);
        this.inputs = AXIS_NAMES.slice(0, axisCount).map((axis, index) => {
            const label = createElement(document, "span", `axis-label ${AXIS_CLASSES[index]}`, axis);
            const input = numberInput(document, `${this.fieldLabel} ${axis}${unitSuffix}`, DECIMAL_INPUT_MODE);
            this.sendWhileTyping(input, key => {
                const parsed = this.parseAxisText(input.value);
                return parsed.valid ? this.commitAxisValue(index, parsed.value, key, TYPING) : undefined;
            });
            input.addEventListener("change", () => {
                const parsed = this.parseAxisText(input.value);
                this.afterTyping(() => {
                    if (parsed.valid) void this.commitAxisValue(index, parsed.value);
                    else this.rejectText(parsed.reason);
                });
            });
            installStepping(input, (direction, modifiers) => {
                void this.commitAxisNumbers(index, current => steppedValue(current, direction, modifiers, this.scrubKind), this.focusKey);
            });
            installScrub(label, {
                kind: this.scrubKind,
                startValues: () => this.axisNumbers(index),
                apply: (values, key) => this.commitAxisNumbers(index, (_, entityIndex) => values[entityIndex], key),
            }, key => this.endGesture(key));
            const cell = createElement(document, "span", "axis-cell");
            cell.append(label, input);
            this.element.append(cell);
            return input;
        });
    }

    protected abstract axisNumbers(index: number): number[];

    protected abstract commitAxisNumbers(index: number, map: (current: number, entityIndex: number) => number, coalesceKey?: string): Promise<unknown>;

    protected abstract parseAxisText(text: string): ParsedFieldText;

    protected abstract commitAxisValue(index: number, value: SceneJsonValue, coalesceKey?: string, typing?: boolean): Promise<unknown>;
}

class VectorFieldEditor extends AxisFieldEditor {
    public constructor(context: FieldEditorContext, document: Document, private readonly length: number) {
        super(context, document, length, "number", "");
    }

    protected render(values: readonly EditorFieldValue[]): void {
        this.inputs.forEach((input, index) => {
            const shared = mixedValueOf(componentValues(values, index));
            const value = shared === undefined || shared.mixed ? undefined : shared.value;
            showText(input, value === undefined ? undefined : typeof value === "number" ? float32Text(value) : numberText(value));
        });
    }

    protected axisNumbers(index: number): number[] {
        return componentValues(this.values, index).map(numericOf);
    }

    protected commitAxisNumbers(index: number, map: (current: number, entityIndex: number) => number, coalesceKey?: string): Promise<unknown> {
        return this.commitEach((current, entityIndex) => withComponent(current, this.length, index, wireNumber(map(numericOf(vectorComponents(current, this.length)[index]), entityIndex))), coalesceKey);
    }

    protected parseAxisText(text: string): ParsedFieldText {
        return parseNumberText(text);
    }

    protected commitAxisValue(index: number, value: SceneJsonValue, coalesceKey?: string, typing = false): Promise<unknown> {
        return this.commitEach(current => withComponent(current, this.length, index, value), coalesceKey, typing);
    }
}

class RotationFieldEditor extends AxisFieldEditor {
    private pendingDegrees: readonly EulerDegrees[] | undefined;

    public constructor(context: FieldEditorContext, document: Document) {
        super(context, document, VEC3_AXES, "degrees", ` in degrees`);
        this.inputs.forEach(input => input.dataset.placeholder = DEGREE_SIGN);
        this.element.title = ROTATION_ORDER_HINT;
    }

    protected render(values: readonly EditorFieldValue[]): void {
        const degrees = this.degreesOf(values);
        this.inputs.forEach((input, index) => {
            const texts = degrees.map(entry => eulerDegreeText(entry[index]));
            const first = texts[0];
            showText(input, first !== undefined && texts.every(text => text === first) ? first : undefined);
        });
    }

    protected axisNumbers(index: number): number[] {
        return this.degreesOf(this.values).map(entry => entry[index]);
    }

    protected commitAxisNumbers(index: number, map: (current: number, entityIndex: number) => number, coalesceKey?: string, typing = false): Promise<unknown> {
        const degrees = this.degreesOf(this.values).map((entry, entityIndex): EulerDegrees => {
            const updated: [number, number, number] = [entry[0], entry[1], entry[2]];
            updated[index] = map(entry[index], entityIndex);
            return updated;
        });
        if (!degrees.every(entry => entry.every(Number.isFinite))) {
            if (!typing) this.rejectText("A rotation needs finite angles");
            return Promise.resolve();
        }
        this.pendingDegrees = degrees;
        return this.commitEach((_, entityIndex) => quaternionOfEulerDegrees(degrees[entityIndex]), coalesceKey, typing);
    }

    protected parseAxisText(text: string): ParsedFieldText {
        return parseFiniteNumberText(text);
    }

    protected commitAxisValue(index: number, value: SceneJsonValue, coalesceKey?: string, typing = false): Promise<unknown> {
        return this.commitAxisNumbers(index, () => value as number, coalesceKey, typing);
    }

    protected override stored(stored: readonly EditorFieldValue[]): void {
        const degrees = this.pendingDegrees;
        this.pendingDegrees = undefined;
        if (degrees === undefined) return;
        const {typeName, field, entities} = this.context;
        stored.forEach((value, index) => {
            const entity = entities[index];
            if (entity !== undefined && degrees[index] !== undefined) this.services.rotations.remember(entity, typeName, field.key, value as SceneJsonValue, degrees[index]);
        });
    }

    private degreesOf(values: readonly EditorFieldValue[]): EulerDegrees[] {
        const {typeName, field, entities} = this.context;
        return values.map((value, index) => {
            const entity = entities[index];
            if (entity !== undefined) return this.services.rotations.degreesFor(entity, typeName, field.key, value);
            return values.length === 1 ? eulerDegreesOfQuaternion(value) : UNREADABLE_ROTATION;
        });
    }
}

class RgbFieldEditor extends FieldEditorBase {
    private readonly input: HTMLInputElement;

    public constructor(context: FieldEditorContext, document: Document) {
        super(context, document);
        this.input = createElement(document, "input", "field-input color");
        this.input.type = "color";
        this.input.setAttribute("aria-label", this.fieldLabel);
        this.commitParsedWhileTyping(this.input, parseRgbText);
        this.input.addEventListener("change", () => this.commitParsed(parseRgbText(this.input.value)));
        this.element.append(this.input);
    }

    protected render(values: readonly EditorFieldValue[]): void {
        const shared = mixedValueOf(values);
        this.input.value = rgbText(shared === undefined ? null : shared.mixed ? shared.first : shared.value);
        this.input.classList.toggle(MIXED_CLASS, shared?.mixed === true);
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
        this.commitParsedWhileTyping(this.input, text => parseTextColorParts({mode: this.selectedMode(), text}));
        this.input.addEventListener("change", () => this.commitParts());
        this.element.append(this.mode, this.input);
    }

    protected render(values: readonly EditorFieldValue[]): void {
        const shared = mixedValueOf(values);
        if (shared === undefined || shared.mixed) {
            selectValue(this.mode, undefined);
            showText(this.input, undefined);
            this.input.disabled = true;
            return;
        }
        const parts = textColorParts(shared.value);
        selectValue(this.mode, parts.mode);
        showText(this.input, parts.text);
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
        this.input.addEventListener("change", () => this.commitAll(this.input.checked));
        this.element.append(this.input);
    }

    protected render(values: readonly EditorFieldValue[]): void {
        const shared = mixedValueOf(values);
        this.input.indeterminate = shared?.mixed === true;
        this.input.checked = shared !== undefined && !shared.mixed && shared.value === true;
    }
}

class StringFieldEditor extends FieldEditorBase {
    private readonly input: HTMLInputElement;

    public constructor(context: FieldEditorContext, document: Document, private readonly nullable: boolean) {
        super(context, document);
        this.input = textInput(document, this.fieldLabel);
        if (nullable) this.input.dataset.placeholder = NULL_STRING_PLACEHOLDER;
        this.sendWhileTyping(this.input, key => this.commitEach(() => parseStringText(this.input.value, {nullable: this.nullable}), key, TYPING));
        this.input.addEventListener("change", () => this.commitAll(parseStringText(this.input.value, {nullable: this.nullable})));
        this.element.append(this.input);
    }

    protected render(values: readonly EditorFieldValue[]): void {
        const shared = mixedValueOf(values);
        showText(this.input, shared === undefined || shared.mixed ? undefined : stringText(shared.value));
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
        this.textarea.setAttribute(FIELD_INPUT_HOOK, TEXT_LINES_FIELD_INPUT);
        this.sendWhileTyping(this.textarea, key => this.commitEach(() => parseTextLinesText(this.textarea.value), key, TYPING));
        this.textarea.addEventListener("change", () => this.commitAll(parseTextLinesText(this.textarea.value)));
        this.element.append(this.textarea);
    }

    protected render(values: readonly EditorFieldValue[]): void {
        const shared = mixedValueOf(values);
        const text = shared === undefined || shared.mixed ? undefined : textLinesText(shared.value);
        showText(this.textarea, text);
        this.textarea.rows = textAreaRows(text);
    }
}

class EnumFieldEditor extends FieldEditorBase {
    private readonly select: HTMLSelectElement;

    public constructor(context: FieldEditorContext, document: Document, private readonly names: readonly string[]) {
        super(context, document);
        this.select = createElement(document, "select", "field-input");
        this.select.setAttribute("aria-label", this.fieldLabel);
        this.select.addEventListener("change", () => {
            if (this.select.value !== MIXED_OPTION_VALUE) this.commitAll(this.select.value);
        });
        this.element.append(this.select);
    }

    protected render(values: readonly EditorFieldValue[]): void {
        fillSelect(this.select, this.names.map(name => ({value: name, label: name})));
        const shared = mixedValueOf(values);
        selectValue(this.select, shared === undefined || shared.mixed ? undefined : typeof shared.value === "string" ? shared.value : "");
    }
}

class JsonFieldEditor extends FieldEditorBase {
    private readonly textarea: HTMLTextAreaElement;

    public constructor(context: FieldEditorContext, document: Document) {
        super(context, document);
        this.textarea = createElement(document, "textarea", "field-input text-lines json-value");
        this.textarea.spellcheck = false;
        this.textarea.wrap = "off";
        this.textarea.setAttribute("aria-label", `${this.fieldLabel} as JSON`);
        this.textarea.addEventListener("change", () => this.commitParsed(parseJsonFieldText(this.textarea.value)));
        this.element.append(this.textarea);
    }

    protected render(values: readonly EditorFieldValue[]): void {
        const shared = mixedValueOf(values);
        const text = shared === undefined || shared.mixed ? undefined : jsonFieldText(shared.value);
        showText(this.textarea, text);
        this.textarea.rows = textAreaRows(text);
    }
}

function builtInFieldEditor(document: Document, context: FieldEditorContext, nested: (document: Document, context: FieldEditorContext) => FieldEditor): FieldEditor {
    const field = context.field;
    switch (field.kind) {
        case "number":
        case "integer":
            return new NumberFieldEditor(context, document, field);
        case "vec2":
            return new VectorFieldEditor(context, document, VEC2_AXES);
        case "vec3":
            return new VectorFieldEditor(context, document, VEC3_AXES);
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
        case "asset":
            return new AssetFieldEditor(context, document, field, nested);
        case "list":
            return new ListFieldEditor(context, document, field, nested);
        case "struct":
            return new StructFieldEditor(context, document, field, nested);
        case "custom":
            return new JsonFieldEditor(context, document);
    }
}

export function createFieldEditor(document: Document, context: FieldEditorContext, drawers: FieldDrawerRegistry = fieldDrawers): FieldEditor {
    const drawer = drawers.drawerFor(context.field);
    if (drawer !== undefined) return drawer(document, context);
    return builtInFieldEditor(document, context, (nestedDocument, nestedContext) => createFieldEditor(nestedDocument, nestedContext, drawers));
}
