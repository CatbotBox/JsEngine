import type {Entity} from "../../engine/core";
import type {SceneJsonValue} from "../../engine/scene";
import type {EditorEntitySummary, EditorFieldDescription, EditorFieldValue} from "../editorProtocol";
import {capturePointer, createElement} from "./dom";
import {numberOfWire} from "./fieldValueText";
import type {ParsedFieldText} from "./fieldValueText";
import {LatestOnly} from "./latestOnly";
import {fieldValuesEqual} from "./multiSelection";
import type {ProjectFileKind} from "./projectFiles";
import type {RotationEulerCache} from "./rotationEulerCache";
import {arrowStepDirection, scrubbedValue, wheelStepDirection} from "./scrubMath";
import type {ScrubKind, StepDirection, StepModifiers} from "./scrubMath";

export interface DraggedAsset {
    readonly path: string;
    readonly fileKind: ProjectFileKind;
}

export interface FieldEditorServices {
    readonly rotations: RotationEulerCache;

    entityChoices(): readonly EditorEntitySummary[];

    endGesture(coalesceKey: string): void;

    reportInvalid(message: string): void;

    draggedAsset(): DraggedAsset | undefined;

    draggedEntities(): readonly Entity[] | undefined;

    pickEntity(): Promise<Entity | undefined>;

    assetFileSuffixes(assetType: string): readonly string[] | undefined;

    assetChoices(assetType: string): Promise<readonly string[]>;

    isDataAssetType(assetType: string): boolean;

    openDataAsset(path: string): void;

    createDataAsset(assetType: string): Promise<string | undefined>;

    isReadOnly(): boolean;
}

export interface FieldEditorContext {
    readonly typeName: string;
    readonly field: EditorFieldDescription;
    readonly entities: readonly Entity[];
    readonly label: HTMLElement;
    readonly services: FieldEditorServices;

    commit(before: readonly EditorFieldValue[], after: readonly SceneJsonValue[], coalesceKey?: string): Promise<readonly EditorFieldValue[] | undefined>;
}

export interface FieldEditor {
    readonly element: HTMLElement;

    show(values: readonly EditorFieldValue[]): void;

    showEntityChoices(): void;
}

export type FieldEditorFactory = (document: Document, context: FieldEditorContext) => FieldEditor;

export const ENTITY_CHOICE_LIMIT = 500;
export const MIXED_VALUE_TEXT = "—";
export const SCRUB_START_THRESHOLD_PX = 2;
export const MIXED_OPTION_VALUE = "\u0000mixed";
export const MIXED_CLASS = "mixed";
export const DROP_TARGET_CLASS = "drop-target";
export const DECIMAL_INPUT_MODE = "decimal";
export const NUMERIC_INPUT_MODE = "numeric";
export const TYPING = true;

const SCRUB_HINT = "Drag to change (Shift faster, Alt slower); Arrow keys and the wheel step while the field is focused";
const SCRUBBING_CLASS = "scrubbing";
const FIELD_NAME_CLASS = "field-name";
const SCRUB_LABEL_CLASS = "field-name scrub-label";
const SCRUBBED_KINDS: ReadonlySet<string> = new Set(["number", "integer"]);
const LEFT_BUTTON = 0;
const STEP_UP: StepDirection = 1;
const STEP_DOWN: StepDirection = -1;

let nextGestureId = 1;

export function gestureKey(prefix: string): string {
    return `${prefix}:${nextGestureId++}`;
}

export class InvalidFieldText extends Error {
    public constructor(public readonly reason: string) {
        super(reason);
    }
}

export function modifiersOf(event: {readonly shiftKey: boolean, readonly altKey: boolean}): StepModifiers {
    return {faster: event.shiftKey, slower: event.altKey};
}

export function numericOf(value: EditorFieldValue | undefined): number {
    if (value === undefined) return Number.NaN;
    return numberOfWire(value as SceneJsonValue) ?? Number.NaN;
}

export function fieldLabelElement(document: Document, text: string, field: EditorFieldDescription): HTMLElement {
    const label = createElement(document, "span", SCRUBBED_KINDS.has(field.kind) ? SCRUB_LABEL_CLASS : FIELD_NAME_CLASS, text);
    label.title = text;
    return label;
}

export function nestedFieldContext(parent: FieldEditorContext, field: EditorFieldDescription, label: HTMLElement, commit: FieldEditorContext["commit"]): FieldEditorContext {
    return {typeName: parent.typeName, field, entities: parent.entities, label, services: parent.services, commit};
}

export function textInput(document: Document, ariaLabel: string): HTMLInputElement {
    const input = createElement(document, "input", "field-input");
    input.type = "text";
    input.spellcheck = false;
    input.setAttribute("aria-label", ariaLabel);
    return input;
}

export function numberInput(document: Document, ariaLabel: string, inputMode: string): HTMLInputElement {
    const input = textInput(document, ariaLabel);
    input.inputMode = inputMode;
    input.classList.add("number");
    return input;
}

export function showText(input: HTMLInputElement | HTMLTextAreaElement, text: string | undefined): void {
    input.value = text ?? "";
    input.placeholder = text === undefined ? MIXED_VALUE_TEXT : input.dataset.placeholder ?? "";
    input.classList.toggle(MIXED_CLASS, text === undefined);
}

export function fillSelect(select: HTMLSelectElement, options: readonly {readonly value: string, readonly label: string}[]): void {
    select.replaceChildren(...options.map(({value, label}) => {
        const option = select.ownerDocument.createElement("option");
        option.value = value;
        option.textContent = label;
        return option;
    }));
}

export function selectValue(select: HTMLSelectElement, value: string | undefined): void {
    const existing = [...select.options].find(option => option.value === MIXED_OPTION_VALUE);
    if (value === undefined) {
        if (existing === undefined) {
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

export function toggleControl(document: Document, text: string, title: string): {readonly element: HTMLElement, readonly input: HTMLInputElement} {
    const element = createElement(document, "label", "field-toggle");
    element.title = title;
    const input = createElement(document, "input", "field-input checkbox");
    input.type = "checkbox";
    input.setAttribute("aria-label", title);
    element.append(input, createElement(document, "span", "field-toggle-text", text));
    return {element, input};
}

export interface ScrubSpec {
    readonly kind: ScrubKind;
    readonly unitsPerPixel?: number;

    startValues(): readonly number[] | undefined;

    apply(values: readonly number[], coalesceKey: string): Promise<unknown>;
}

export function installScrub(handle: HTMLElement, spec: ScrubSpec, onEnd: (coalesceKey: string) => void): void {
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
            const values = start.map(value => scrubbedValue(value, pixels, modifiersOf(move), spec.kind, spec.unitsPerPixel));
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

export function installStepping(input: HTMLInputElement, step: (direction: StepDirection, modifiers: StepModifiers) => void): void {
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

export function stepperButtons(document: Document, ariaLabel: string, step: (direction: StepDirection, modifiers: StepModifiers) => void): HTMLElement {
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

export abstract class FieldEditorBase implements FieldEditor {
    public readonly element: HTMLElement;
    protected values: readonly EditorFieldValue[] = [];
    protected focusKey = gestureKey("focus");
    private readonly typingSender = new LatestOnly();

    protected constructor(protected readonly context: FieldEditorContext, protected readonly document: Document) {
        this.element = createElement(document, "div", `field-editor kind-${context.field.kind}`);
    }

    protected get services(): FieldEditorServices {
        return this.context.services;
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

    protected trackFocusGesture(control: HTMLElement): void {
        control.addEventListener("focus", () => this.focusKey = gestureKey("focus"));
        control.addEventListener("blur", () => {
            const key = this.focusKey;
            this.typingSender.whenDrained(() => this.endGesture(key));
        });
    }

    protected sendWhileTyping(control: HTMLElement, send: (coalesceKey: string) => Promise<unknown> | undefined): void {
        this.trackFocusGesture(control);
        control.addEventListener("input", () => this.typingSender.run(() => send(this.focusKey) ?? Promise.resolve()));
    }

    protected commitParsedWhileTyping(control: HTMLInputElement | HTMLTextAreaElement, parse: (text: string) => ParsedFieldText): void {
        this.sendWhileTyping(control, key => {
            const parsed = parse(control.value);
            return parsed.valid ? this.commitEach(() => parsed.value, key, TYPING) : undefined;
        });
    }

    protected afterTyping(commit: () => void): void {
        this.typingSender.whenDrained(commit);
    }

    protected revert(): void {
        this.render(this.values);
    }

    protected rejectText(reason: string): void {
        this.services.reportInvalid(`${this.fieldLabel}: ${reason}`);
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

    protected commitEach(map: (current: EditorFieldValue, index: number) => SceneJsonValue, coalesceKey?: string, typing = false): Promise<unknown> {
        return this.commitValues(map, coalesceKey, typing);
    }

    protected async commitValues(map: (current: EditorFieldValue, index: number) => SceneJsonValue, coalesceKey?: string, typing = false): Promise<readonly EditorFieldValue[] | undefined> {
        if (this.services.isReadOnly()) {
            if (!typing) this.revert();
            return undefined;
        }
        const mapped = typing ? this.mapValuesQuietly(map) : this.mapValues(map);
        if (mapped === undefined || mapped.length === 0) return undefined;
        const unchanged = mapped.every((value, index) => fieldValuesEqual(value, this.values[index]));
        if (unchanged && typing) return this.values;
        if (unchanged && coalesceKey === undefined) {
            this.revert();
            return this.values;
        }
        const before = this.values;
        this.values = mapped;
        const stored = await this.context.commit(before, mapped, coalesceKey);
        if (stored === undefined) {
            this.values = before;
            if (!typing) this.revert();
            return undefined;
        }
        this.stored(stored, mapped);
        this.values = stored;
        if (this.rendersAfterCommit(coalesceKey, typing)) this.render(stored);
        return stored;
    }

    protected rendersAfterCommit(coalesceKey: string | undefined, typing: boolean): boolean {
        return !this.hasFocus() || (coalesceKey !== undefined && !typing);
    }

    protected commitAll(value: SceneJsonValue): void {
        this.afterTyping(() => void this.commitEach(() => value));
    }

    protected commitParsed(parsed: ParsedFieldText): void {
        if (parsed.valid) this.commitAll(parsed.value);
        else this.afterTyping(() => this.rejectText(parsed.reason));
    }

    protected stored(_stored: readonly EditorFieldValue[], _sent: readonly SceneJsonValue[]): void {
    }

    protected hasFocus(): boolean {
        const active = this.document.activeElement;
        return active !== null && this.element.contains(active);
    }

    protected endGesture(coalesceKey: string): void {
        this.services.endGesture(coalesceKey);
    }

    private mapValuesQuietly(map: (current: EditorFieldValue, index: number) => SceneJsonValue): SceneJsonValue[] | undefined {
        try {
            return this.values.map(map);
        } catch (error) {
            if (error instanceof InvalidFieldText) return undefined;
            throw error;
        }
    }
}
