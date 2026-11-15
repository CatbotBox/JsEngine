import type {Entity} from "../../engine/core";
import type {SceneJsonValue} from "../../engine/scene";
import type {EditorEntitySummary, EditorFieldDescription, EditorFieldValue} from "../editorProtocol";
import {capturePointer, createElement} from "./dom";
import {
    assetText,
    entityLabel,
    entityOptionValue,
    eulerDegreeText,
    float32Text,
    isInlineAssetSummary,
    NO_ENTITY_OPTION_VALUE,
    numberOfWire,
    numberText,
    parseAssetPathText,
    parseEntityOptionValue,
    parseFiniteNumberText,
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
    VEC3_COMPONENT_COUNT,
    wireNumber,
} from "./fieldValueText";
import type {EulerDegrees, ParsedFieldText, TextColorMode} from "./fieldValueText";
import {LatestOnly} from "./latestOnly";
import {fieldValuesEqual, mixedValueOf} from "./multiSelection";
import type {RotationEulerCache} from "./rotationEulerCache";
import {arrowStepDirection, scrubbedValue, steppedValue, wheelStepDirection} from "./scrubMath";
import type {ScrubKind, StepDirection, StepModifiers} from "./scrubMath";
import type {ProjectFileKind} from "./projectFiles";

export interface FieldEditorContext {
    readonly typeName: string;
    readonly field: EditorFieldDescription;
    readonly entities: readonly Entity[];
    readonly rotations: RotationEulerCache;
    readonly label: HTMLElement;

    entityChoices(): readonly EditorEntitySummary[];

    commit(before: readonly EditorFieldValue[], after: readonly SceneJsonValue[], coalesceKey?: string): Promise<readonly EditorFieldValue[] | undefined>;

    endGesture(coalesceKey: string): void;

    reportInvalid(message: string): void;

    draggedAsset(): {readonly path: string, readonly fileKind: ProjectFileKind} | undefined;
}

export interface FieldEditor {
    readonly element: HTMLElement;

    show(values: readonly EditorFieldValue[]): void;

    showEntityChoices(): void;
}

export const ENTITY_CHOICE_LIMIT = 500;
export const MIXED_VALUE_TEXT = "—";
export const SCRUB_START_THRESHOLD_PX = 2;

const AXIS_NAMES = ["X", "Y", "Z"];
const AXIS_CLASSES = ["axis-x", "axis-y", "axis-z"];
const DEGREE_SIGN = "°";
const DECIMAL_INPUT_MODE = "decimal";
const NUMERIC_INPUT_MODE = "numeric";
const MAX_TEXTAREA_ROWS = 12;
const MIN_TEXTAREA_ROWS = 2;
const LINE_SEPARATOR = "\n";
const NO_ENTITY_LABEL = "(none)";
const NULL_STRING_PLACEHOLDER = "(none)";
const ASSET_PATH_PLACEHOLDER = "path/to/file";
const MIXED_OPTION_VALUE = "\u0000mixed";
const ROTATION_ORDER_HINT = "Euler angles in degrees, applied Z (yaw), then Y (pitch), then X (roll)";
const SCRUB_HINT = "Drag to change (Shift faster, Alt slower); Arrow keys and the wheel step while the field is focused";
const TEXT_COLOR_PLACEHOLDERS: Readonly<Record<TextColorMode, string>> = {default: "", palette: "0-255", rgb: "#rrggbb"};
const MIXED_CLASS = "mixed";
const SCRUBBING_CLASS = "scrubbing";
const DROP_TARGET_CLASS = "drop-target";
const LEFT_BUTTON = 0;
const STEP_UP: StepDirection = 1;
const STEP_DOWN: StepDirection = -1;
const ASSET_KIND_BY_FIELD: Readonly<Record<string, ProjectFileKind>> = {mesh: "mesh", spriteImage: "image"};

let nextGestureId = 1;

function gestureKey(prefix: string): string {
    return `${prefix}:${nextGestureId++}`;
}

class InvalidFieldText extends Error {
    public constructor(public readonly reason: string) {
        super(reason);
    }
}

function modifiersOf(event: {readonly shiftKey: boolean, readonly altKey: boolean}): StepModifiers {
    return {faster: event.shiftKey, slower: event.altKey};
}

function numericOf(value: EditorFieldValue | undefined): number {
    if (value === undefined) return Number.NaN;
    return numberOfWire(value as SceneJsonValue) ?? Number.NaN;
}

function vectorComponents(value: EditorFieldValue): SceneJsonValue[] {
    if (!Array.isArray(value) || value.length !== VEC3_COMPONENT_COUNT) throw new InvalidFieldText(`${JSON.stringify(value)} is not three numbers`);
    return [...value];
}

function withComponent(value: EditorFieldValue, index: number, component: SceneJsonValue): SceneJsonValue {
    const components = vectorComponents(value);
    components[index] = component;
    return components;
}

function componentValues(values: readonly EditorFieldValue[], index: number): EditorFieldValue[] {
    return values.map(value => Array.isArray(value) ? value[index] ?? null : null);
}

function textInput(document: Document, ariaLabel: string): HTMLInputElement {
    const input = createElement(document, "input", "field-input");
    input.type = "text";
    input.spellcheck = false;
    input.setAttribute("aria-label", ariaLabel);
    return input;
}

function numberInput(document: Document, ariaLabel: string, inputMode: string): HTMLInputElement {
    const input = textInput(document, ariaLabel);
    input.inputMode = inputMode;
    input.classList.add("number");
    return input;
}

function showText(input: HTMLInputElement | HTMLTextAreaElement, text: string | undefined): void {
    input.value = text ?? "";
    input.placeholder = text === undefined ? MIXED_VALUE_TEXT : input.dataset.placeholder ?? "";
    input.classList.toggle(MIXED_CLASS, text === undefined);
}

function fillSelect(select: HTMLSelectElement, options: readonly {readonly value: string, readonly label: string}[]): void {
    select.replaceChildren(...options.map(({value, label}) => {
        const option = select.ownerDocument.createElement("option");
        option.value = value;
        option.textContent = label;
        return option;
    }));
}

function selectValue(select: HTMLSelectElement, value: string | undefined): void {
    const existing = [...select.options].find(option => option.value === MIXED_OPTION_VALUE);
    if (value === undefined) {
        if (existing === null) {
            const option = select.ownerDocument.createElement("option");
            option.value = MIXED_OPTION_VALUE;
            option.textContent = MIXED_VALUE_TEXT;
            select.prepend(option);
        }
        select.value = MIXED_OPTION_VALUE;
        return;
    }
    existing?.remove();
    select.value = value;
}

interface ScrubSpec {
    readonly kind: ScrubKind;

    startValues(): readonly number[] | undefined;

    apply(values: readonly number[], coalesceKey: string): Promise<unknown>;
}

function installScrub(handle: HTMLElement, spec: ScrubSpec, onEnd: (coalesceKey: string) => void): void {
    handle.classList.add("scrub-handle");
    handle.title = SCRUB_HINT;
    handle.addEventListener("pointerdown", event => {
        if (event.button !== LEFT_BUTTON) return;
        const start = spec.startValues();
        if (start === undefined || start.length === 0) return;
        event.preventDefault();
        capturePointer(handle, event.pointerId);
        const startX = event.clientX;
        const key = gestureKey("scrub");
        const sender = new LatestOnly();
        let scrubbing = false;
        const onMove = (move: PointerEvent): void => {
            const pixels = move.clientX - startX;
            if (!scrubbing && Math.abs(pixels) < SCRUB_START_THRESHOLD_PX) return;
            scrubbing = true;
            handle.classList.add(SCRUBBING_CLASS);
            const values = start.map(value => scrubbedValue(value, pixels, modifiersOf(move), spec.kind));
            sender.run(() => spec.apply(values, key));
        };
        const onUp = (): void => {
            handle.removeEventListener("pointermove", onMove);
            handle.removeEventListener("pointerup", onUp);
            handle.removeEventListener("pointercancel", onUp);
            handle.classList.remove(SCRUBBING_CLASS);
            sender.whenDrained(() => onEnd(key));
        };
        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", onUp);
        handle.addEventListener("pointercancel", onUp);
    });
}

function installStepping(input: HTMLInputElement, step: (direction: StepDirection, modifiers: StepModifiers) => void): void {
    input.addEventListener("keydown", event => {
        const direction = arrowStepDirection(event.key);
        if (direction === undefined) return;
        event.preventDefault();
        step(direction, modifiersOf(event));
    });
    input.addEventListener("wheel", event => {
        if (input.ownerDocument.activeElement !== input) return;
        const direction = wheelStepDirection(event.deltaY);
        if (direction === undefined) return;
        event.preventDefault();
        step(direction, modifiersOf(event));
    }, {passive: false});
}

function stepperButtons(document: Document, ariaLabel: string, step: (direction: StepDirection, modifiers: StepModifiers) => void): HTMLElement {
    const steppers = createElement(document, "span", "field-steppers");
    for (const [direction, text, name] of [[STEP_UP, "▲", "Increase"], [STEP_DOWN, "▼", "Decrease"]] as const) {
        const button = createElement(document, "button", "field-stepper", text);
        button.type = "button";
        button.tabIndex = -1;
        button.title = `${name} ${ariaLabel} (Shift faster, Alt slower)`;
        button.addEventListener("pointerdown", event => event.preventDefault());
        button.addEventListener("click", event => step(direction, modifiersOf(event)));
        steppers.append(button);
    }
    return steppers;
}

abstract class FieldEditorBase implements FieldEditor {
    public readonly element: HTMLElement;
    protected values: readonly EditorFieldValue[] = [];

    protected constructor(protected readonly context: FieldEditorContext, protected readonly document: Document) {
        this.element = createElement(document, "div", `field-editor kind-${context.field.kind}`);
    }

    protected get fieldLabel(): string {
        return `${this.context.typeName}.${this.context.field.key}`;
    }

    public show(values: readonly EditorFieldValue[]): void {
        this.values = values;
        if (!this.hasFocus()) this.render(values);
    }

    public showEntityChoices(): void {
    }

    protected abstract render(values: readonly EditorFieldValue[]): void;

    protected revert(): void {
        this.render(this.values);
    }

    protected rejectText(reason: string): void {
        this.context.reportInvalid(`${this.fieldLabel}: ${reason}`);
        this.revert();
    }

    protected mapValues(map: (current: EditorFieldValue, index: number) => SceneJsonValue): SceneJsonValue[] | undefined {
        try {
            return this.values.map(map);
        } catch (error) {
            if (!(error instanceof InvalidFieldText)) throw error;
            this.rejectText(error.reason);
            return undefined;
        }
    }

    protected commitEach(map: (current: EditorFieldValue, index: number) => SceneJsonValue, coalesceKey?: string): Promise<unknown> {
        const mapped = this.mapValues(map);
        if (mapped === undefined || mapped.length === 0) return Promise.resolve();
        if (coalesceKey === undefined && mapped.every((value, index) => fieldValuesEqual(value, this.values[index]))) {
            this.revert();
            return Promise.resolve();
        }
        const before = this.values;
        this.values = mapped;
        return this.context.commit(before, mapped, coalesceKey).then(stored => {
            if (stored === undefined) {
                this.revert();
                return;
            }
            this.stored(stored, mapped);
            this.values = stored;
            if (!this.hasFocus() || coalesceKey !== undefined) this.render(stored);
        });
    }

    protected commitAll(value: SceneJsonValue): void {
        void this.commitEach(() => value);
    }

    protected commitParsed(parsed: ParsedFieldText): void {
        if (parsed.valid) this.commitAll(parsed.value);
        else this.rejectText(parsed.reason);
    }

    protected stored(_stored: readonly EditorFieldValue[], _sent: readonly SceneJsonValue[]): void {
    }

    protected hasFocus(): boolean {
        const active = this.document.activeElement;
        return active !== null && this.element.contains(active);
    }

    protected endGesture(coalesceKey: string): void {
        this.context.endGesture(coalesceKey);
    }
}

class NumberFieldEditor extends FieldEditorBase {
    private readonly input: HTMLInputElement;
    private readonly scrubKind: ScrubKind;
    private stepKey = gestureKey("step");

    public constructor(context: FieldEditorContext, document: Document, private readonly integer: boolean) {
        super(context, document);
        this.scrubKind = integer ? "integer" : "number";
        this.input = numberInput(document, this.fieldLabel, integer ? NUMERIC_INPUT_MODE : DECIMAL_INPUT_MODE);
        this.input.addEventListener("change", () => this.commitParsed(integer ? parseIntegerText(this.input.value) : parseNumberText(this.input.value)));
        this.input.addEventListener("focus", () => this.stepKey = gestureKey("step"));
        this.input.addEventListener("blur", () => this.endGesture(this.stepKey));
        const step = (direction: StepDirection, modifiers: StepModifiers): void => {
            void this.commitEach(current => wireNumber(steppedValue(numericOf(current), direction, modifiers, this.scrubKind)), this.stepKey);
        };
        installStepping(this.input, step);
        installScrub(context.label, {
            kind: this.scrubKind,
            startValues: () => this.values.map(numericOf),
            apply: (values, key) => this.commitEach((_, index) => wireNumber(values[index]), key),
        }, key => this.endGesture(key));
        this.element.append(this.input, stepperButtons(document, this.fieldLabel, (direction, modifiers) => {
            const key = gestureKey("stepper");
            void this.commitEach(current => wireNumber(steppedValue(numericOf(current), direction, modifiers, this.scrubKind)), key).then(() => this.endGesture(key));
        }));
    }

    protected render(values: readonly EditorFieldValue[]): void {
        const shared = mixedValueOf(values);
        showText(this.input, shared === undefined || shared.mixed ? undefined : numberText(shared.value));
    }
}

abstract class AxisFieldEditor extends FieldEditorBase {
    protected readonly inputs: HTMLInputElement[];
    private stepKeys: string[];

    protected constructor(context: FieldEditorContext, document: Document, private readonly scrubKind: ScrubKind, unitSuffix: string) {
        super(context, document);
        this.stepKeys = AXIS_NAMES.map(() => gestureKey("step"));
        this.inputs = AXIS_NAMES.map((axis, index) => {
            const label = createElement(document, "span", `axis-label ${AXIS_CLASSES[index]}`, axis);
            const input = numberInput(document, `${this.fieldLabel} ${axis}${unitSuffix}`, DECIMAL_INPUT_MODE);
            input.addEventListener("change", () => this.commitAxisText(index, input.value));
            input.addEventListener("focus", () => this.stepKeys[index] = gestureKey("step"));
            input.addEventListener("blur", () => this.endGesture(this.stepKeys[index]));
            installStepping(input, (direction, modifiers) => {
                void this.commitAxisNumbers(index, current => steppedValue(current, direction, modifiers, this.scrubKind), this.stepKeys[index]);
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

    protected abstract commitAxisText(index: number, text: string): void;
}

class Vec3FieldEditor extends AxisFieldEditor {
    public constructor(context: FieldEditorContext, document: Document) {
        super(context, document, "number", "");
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
        return this.commitEach((current, entityIndex) => withComponent(current, index, wireNumber(map(numericOf(vectorComponents(current)[index]), entityIndex))), coalesceKey);
    }

    protected commitAxisText(index: number, text: string): void {
        const parsed = parseNumberText(text);
        if (!parsed.valid) {
            this.rejectText(parsed.reason);
            return;
        }
        void this.commitEach(current => withComponent(current, index, parsed.value));
    }
}

class RotationFieldEditor extends AxisFieldEditor {
    private pendingDegrees: readonly EulerDegrees[] | undefined;

    public constructor(context: FieldEditorContext, document: Document) {
        super(context, document, "degrees", ` in degrees`);
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

    protected commitAxisNumbers(index: number, map: (current: number, entityIndex: number) => number, coalesceKey?: string): Promise<unknown> {
        const degrees = this.degreesOf(this.values).map((entry, entityIndex): EulerDegrees => {
            const updated: [number, number, number] = [entry[0], entry[1], entry[2]];
            updated[index] = map(entry[index], entityIndex);
            return updated;
        });
        if (!degrees.every(entry => entry.every(Number.isFinite))) {
            this.rejectText("A rotation needs finite angles");
            return Promise.resolve();
        }
        this.pendingDegrees = degrees;
        return this.commitEach((_, entityIndex) => quaternionOfEulerDegrees(degrees[entityIndex]), coalesceKey);
    }

    protected commitAxisText(index: number, text: string): void {
        const parsed = parseFiniteNumberText(text);
        if (!parsed.valid) {
            this.rejectText(parsed.reason);
            return;
        }
        void this.commitAxisNumbers(index, () => parsed.value as number);
    }

    protected override stored(stored: readonly EditorFieldValue[]): void {
        const degrees = this.pendingDegrees;
        this.pendingDegrees = undefined;
        if (degrees === undefined) return;
        const {typeName, field, rotations, entities} = this.context;
        stored.forEach((value, index) => {
            const entity = entities[index];
            if (entity !== undefined && degrees[index] !== undefined) rotations.remember(entity, typeName, field.key, value as SceneJsonValue, degrees[index]);
        });
    }

    private degreesOf(values: readonly EditorFieldValue[]): EulerDegrees[] {
        const {typeName, field, rotations, entities} = this.context;
        return values.map((value, index) => {
            const entity = entities[index];
            return entity === undefined ? [Number.NaN, Number.NaN, Number.NaN] : rotations.degreesFor(entity, typeName, field.key, value);
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
        this.textarea.addEventListener("change", () => this.commitAll(parseTextLinesText(this.textarea.value)));
        this.element.append(this.textarea);
    }

    protected render(values: readonly EditorFieldValue[]): void {
        const shared = mixedValueOf(values);
        const text = shared === undefined || shared.mixed ? undefined : textLinesText(shared.value);
        showText(this.textarea, text);
        this.textarea.rows = Math.max(MIN_TEXTAREA_ROWS, Math.min(MAX_TEXTAREA_ROWS, (text ?? "").split(LINE_SEPARATOR).length));
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

class EntityFieldEditor extends FieldEditorBase {
    private readonly select: HTMLSelectElement;
    private shownKey: string | undefined;

    public constructor(context: FieldEditorContext, document: Document, private readonly nullable: boolean) {
        super(context, document);
        this.select = createElement(document, "select", "field-input");
        this.select.setAttribute("aria-label", this.fieldLabel);
        this.select.addEventListener("change", () => {
            if (this.select.value !== MIXED_OPTION_VALUE) this.commitAll(parseEntityOptionValue(this.select.value));
        });
        this.element.append(this.select);
    }

    public override showEntityChoices(): void {
        if (!this.hasFocus()) this.render(this.values);
    }

    protected render(values: readonly EditorFieldValue[]): void {
        const shared = mixedValueOf(values);
        const selected = shared === undefined || shared.mixed ? undefined : entityOptionValue(shared.value);
        const choices = this.context.entityChoices();
        const key = `${choices.length}:${selected}:${choices.slice(0, ENTITY_CHOICE_LIMIT).map(summary => `${summary.entity}=${summary.name ?? ""}`).join(",")}`;
        if (key !== this.shownKey) {
            this.shownKey = key;
            fillSelect(this.select, this.options(choices, selected));
        }
        selectValue(this.select, selected);
    }

    private options(choices: readonly EditorEntitySummary[], selected: string | undefined): {value: string, label: string}[] {
        const options = choices.slice(0, ENTITY_CHOICE_LIMIT).map(summary => ({value: String(summary.entity), label: entityLabel(summary.entity, summary.name)}));
        if (this.nullable) options.unshift({value: NO_ENTITY_OPTION_VALUE, label: NO_ENTITY_LABEL});
        if (selected !== undefined && !options.some(option => option.value === selected)) {
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
        this.input.dataset.placeholder = ASSET_PATH_PLACEHOLDER;
        this.input.addEventListener("change", () => this.commitAll(parseAssetPathText(this.input.value)));
        this.inline = createElement(document, "span", "field-read-only");
        this.element.append(this.input, this.inline);
        const wanted = ASSET_KIND_BY_FIELD[context.field.kind];
        const acceptedPath = (): string | undefined => {
            const dragged = this.context.draggedAsset();
            return dragged !== undefined && dragged.fileKind === wanted ? dragged.path : undefined;
        };
        this.element.addEventListener("dragover", event => {
            if (acceptedPath() === undefined) return;
            event.preventDefault();
            this.element.classList.add(DROP_TARGET_CLASS);
        });
        this.element.addEventListener("dragleave", () => this.element.classList.remove(DROP_TARGET_CLASS));
        this.element.addEventListener("drop", event => {
            this.element.classList.remove(DROP_TARGET_CLASS);
            const path = acceptedPath();
            if (path === undefined) return;
            event.preventDefault();
            this.commitAll({path});
        });
    }

    protected render(values: readonly EditorFieldValue[]): void {
        const shared = mixedValueOf(values);
        const value = shared === undefined || shared.mixed ? undefined : shared.value;
        const inline = value !== undefined && isInlineAssetSummary(value);
        this.input.hidden = inline;
        this.inline.hidden = !inline;
        if (inline) this.inline.textContent = assetText(value);
        else showText(this.input, value === undefined ? undefined : assetText(value));
    }
}

export function createFieldEditor(document: Document, context: FieldEditorContext): FieldEditor {
    const field = context.field;
    switch (field.kind) {
        case "number":
            return new NumberFieldEditor(context, document, false);
        case "integer":
            return new NumberFieldEditor(context, document, true);
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
