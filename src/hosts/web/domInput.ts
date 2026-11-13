import {Key, keyForCharacter} from "../../engine/input/key";
import {PointerButton} from "../../engine/input/pointerButton";
import type {InputEventSink, Modifiers, PointerPosition} from "../../engine/input/inputEvent";

export interface DomListenerOptions {
    readonly capture?: boolean;
    readonly passive?: boolean;
}

interface DomModifierState {
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly shiftKey: boolean;
    readonly metaKey: boolean;
}

interface DomConsumable {
    preventDefault(): void;
    stopPropagation(): void;
}

export interface DomKeyboardEvent extends DomModifierState, DomConsumable {
    readonly key: string;
    readonly code: string;
    readonly repeat: boolean;
}

export interface DomPointerEvent extends DomModifierState, DomConsumable {
    readonly button: number;
    readonly pointerId: number;
    readonly clientX: number;
    readonly clientY: number;
}

export interface DomWheelEvent extends DomModifierState, DomConsumable {
    readonly deltaY: number;
    readonly deltaMode: number;
    readonly clientX: number;
    readonly clientY: number;
}

export interface DomInputEventMap {
    keydown: DomKeyboardEvent;
    keyup: DomKeyboardEvent;
    pointerdown: DomPointerEvent;
    pointerup: DomPointerEvent;
    pointermove: DomPointerEvent;
    pointercancel: DomPointerEvent;
    wheel: DomWheelEvent;
    focusin: unknown;
    focusout: unknown;
}

export interface DomInputTarget {
    addEventListener<K extends keyof DomInputEventMap>(type: K, listener: (event: DomInputEventMap[K]) => void, options?: DomListenerOptions): void;
    removeEventListener<K extends keyof DomInputEventMap>(type: K, listener: (event: DomInputEventMap[K]) => void, options?: DomListenerOptions): void;
    setPointerCapture?(pointerId: number): void;
}

export interface CellArea {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
    readonly columns: number;
    readonly rows: number;
}

export interface DomInputOptions {
    readonly sink: InputEventSink;
    readonly cellArea: () => CellArea;
}

const CAPTURE: DomListenerOptions = {capture: true};
const CAPTURE_CANCELABLE: DomListenerOptions = {capture: true, passive: false};

const NAMED_KEYS: ReadonlyMap<string, Key> = new Map([
    ["ArrowUp", Key.Up], ["ArrowDown", Key.Down], ["ArrowLeft", Key.Left], ["ArrowRight", Key.Right],
    ["Enter", Key.Enter], ["Tab", Key.Tab], ["Escape", Key.Escape], ["Backspace", Key.Backspace],
    ["Delete", Key.Delete], ["Insert", Key.Insert], ["Home", Key.Home], ["End", Key.End],
    ["PageUp", Key.PageUp], ["PageDown", Key.PageDown],
    ["F1", Key.F1], ["F2", Key.F2], ["F3", Key.F3], ["F4", Key.F4], ["F5", Key.F5], ["F6", Key.F6],
    ["F7", Key.F7], ["F8", Key.F8], ["F9", Key.F9], ["F10", Key.F10], ["F11", Key.F11], ["F12", Key.F12],
    ["Shift", Key.Shift], ["Control", Key.Ctrl], ["Alt", Key.Alt], ["Meta", Key.Meta],
]);
const BROWSER_KEYS: ReadonlySet<Key> = new Set([
    Key.F1, Key.F2, Key.F3, Key.F4, Key.F5, Key.F6, Key.F7, Key.F8, Key.F9, Key.F10, Key.F11, Key.F12,
]);
const LETTER_OR_DIGIT_CODE = /^(?:Key([A-Z])|Digit([0-9]))$/;
const NO_CODE = "";

const BUTTON_BY_DOM_BUTTON: ReadonlyMap<number, PointerButton> = new Map([
    [PointerButton.Left, PointerButton.Left],
    [PointerButton.Middle, PointerButton.Middle],
    [PointerButton.Right, PointerButton.Right],
]);

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const WHEEL_PIXELS_PER_NOTCH = 100;
const WHEEL_LINES_PER_NOTCH = 3;
const WHEEL_PAGES_PER_NOTCH = 1;

const FIRST_PRINTABLE_CODE_POINT = 0x20;
const DELETE_CODE_POINT = 0x7f;

function keyOfCode(code: string): Key | undefined {
    const match = LETTER_OR_DIGIT_CODE.exec(code);
    if (match === null) return undefined;
    return keyForCharacter((match[1] ?? match[2]).toLowerCase())?.key;
}

function keyOf(event: DomKeyboardEvent): Key | undefined {
    return NAMED_KEYS.get(event.key) ?? keyForCharacter(event.key)?.key ?? keyOfCode(event.code);
}

function modifiersOf(event: DomModifierState): Modifiers {
    return {ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey};
}

function typedText(event: DomKeyboardEvent): string | undefined {
    const altGraph = event.ctrlKey && event.altKey;
    const unmodified = !event.ctrlKey && !event.altKey;
    if (event.metaKey || !(unmodified || altGraph)) return undefined;
    const codePoint = event.key.codePointAt(0);
    if (codePoint === undefined || String.fromCodePoint(codePoint).length !== event.key.length) return undefined;
    if (codePoint < FIRST_PRINTABLE_CODE_POINT || codePoint === DELETE_CODE_POINT) return undefined;
    return event.key;
}

function consumesKey(key: Key, event: DomModifierState): boolean {
    return !event.ctrlKey && !event.metaKey && !BROWSER_KEYS.has(key);
}

function wheelNotches(event: DomWheelEvent): number {
    const unitsPerNotch = event.deltaMode === DOM_DELTA_LINE ? WHEEL_LINES_PER_NOTCH
        : event.deltaMode === DOM_DELTA_PAGE ? WHEEL_PAGES_PER_NOTCH
            : WHEEL_PIXELS_PER_NOTCH;
    return -event.deltaY / unitsPerNotch;
}

function cellsAlong(offset: number, extent: number, cells: number): number {
    return extent > 0 ? offset * cells / extent : 0;
}

class DomInput {
    private readonly keysByCode = new Map<string, Key>();
    private readonly buttonsHeld = new Set<PointerButton>();

    public constructor(private readonly target: DomInputTarget, private readonly options: DomInputOptions) {
    }

    public install(): void {
        const target = this.target;
        target.addEventListener("keydown", this.onKeyDown, CAPTURE);
        target.addEventListener("keyup", this.onKeyUp, CAPTURE);
        target.addEventListener("pointerdown", this.onPointerDown, CAPTURE);
        target.addEventListener("pointerup", this.onPointerUp, CAPTURE);
        target.addEventListener("pointermove", this.onPointerMove, CAPTURE);
        target.addEventListener("pointercancel", this.onPointerCancel, CAPTURE);
        target.addEventListener("wheel", this.onWheel, CAPTURE_CANCELABLE);
        target.addEventListener("focusin", this.onFocusIn, CAPTURE);
        target.addEventListener("focusout", this.onFocusOut, CAPTURE);
    }

    public uninstall(): void {
        const target = this.target;
        target.removeEventListener("keydown", this.onKeyDown, CAPTURE);
        target.removeEventListener("keyup", this.onKeyUp, CAPTURE);
        target.removeEventListener("pointerdown", this.onPointerDown, CAPTURE);
        target.removeEventListener("pointerup", this.onPointerUp, CAPTURE);
        target.removeEventListener("pointermove", this.onPointerMove, CAPTURE);
        target.removeEventListener("pointercancel", this.onPointerCancel, CAPTURE);
        target.removeEventListener("wheel", this.onWheel, CAPTURE_CANCELABLE);
        target.removeEventListener("focusin", this.onFocusIn, CAPTURE);
        target.removeEventListener("focusout", this.onFocusOut, CAPTURE);
    }

    private readonly onKeyDown = (event: DomKeyboardEvent): void => {
        const key = keyOf(event);
        const text = typedText(event);
        if (key === undefined && text === undefined) return;
        if (key !== undefined) {
            if (event.code !== NO_CODE) this.keysByCode.set(event.code, key);
            this.options.sink.enqueue({type: "keyDown", key, repeat: event.repeat, ...modifiersOf(event)});
            if (consumesKey(key, event)) event.preventDefault();
        }
        if (text !== undefined) this.options.sink.enqueue({type: "text", text});
        event.stopPropagation();
    };

    private readonly onKeyUp = (event: DomKeyboardEvent): void => {
        const key = this.releasedKey(event);
        if (key === undefined) return;
        if (!this.stillHeldByAnotherCode(key)) {
            this.options.sink.enqueue({type: "keyUp", key, ...modifiersOf(event)});
        }
        if (consumesKey(key, event)) event.preventDefault();
        event.stopPropagation();
    };

    private releasedKey(event: DomKeyboardEvent): Key | undefined {
        const tracked = this.keysByCode.get(event.code);
        if (tracked === undefined) return keyOf(event);
        this.keysByCode.delete(event.code);
        return tracked;
    }

    private stillHeldByAnotherCode(key: Key): boolean {
        for (const held of this.keysByCode.values()) if (held === key) return true;
        return false;
    }

    private readonly onPointerDown = (event: DomPointerEvent): void => {
        const button = BUTTON_BY_DOM_BUTTON.get(event.button);
        if (button === undefined) return;
        this.target.setPointerCapture?.(event.pointerId);
        this.buttonsHeld.add(button);
        this.options.sink.enqueue({type: "pointerDown", button, ...this.cellPosition(event), ...modifiersOf(event)});
        event.preventDefault();
        event.stopPropagation();
    };

    private readonly onPointerUp = (event: DomPointerEvent): void => {
        const button = BUTTON_BY_DOM_BUTTON.get(event.button);
        if (button === undefined) return;
        this.buttonsHeld.delete(button);
        this.options.sink.enqueue({type: "pointerUp", button, ...this.cellPosition(event), ...modifiersOf(event)});
        event.preventDefault();
        event.stopPropagation();
    };

    private readonly onPointerMove = (event: DomPointerEvent): void => {
        this.options.sink.enqueue({type: "pointerMove", ...this.cellPosition(event), ...modifiersOf(event)});
        event.stopPropagation();
    };

    private readonly onPointerCancel = (event: DomPointerEvent): void => {
        const position = this.cellPosition(event);
        const modifiers = modifiersOf(event);
        for (const button of this.buttonsHeld) this.options.sink.enqueue({type: "pointerUp", button, ...position, ...modifiers});
        this.buttonsHeld.clear();
        event.stopPropagation();
    };

    private readonly onWheel = (event: DomWheelEvent): void => {
        if (event.deltaY === 0) return;
        this.options.sink.enqueue({type: "wheel", delta: wheelNotches(event), ...this.cellPosition(event), ...modifiersOf(event)});
        event.preventDefault();
        event.stopPropagation();
    };

    private readonly onFocusIn = (): void => {
        this.options.sink.enqueue({type: "focus", focused: true});
    };

    private readonly onFocusOut = (): void => {
        this.keysByCode.clear();
        this.buttonsHeld.clear();
        this.options.sink.enqueue({type: "focus", focused: false});
    };

    private cellPosition(event: {readonly clientX: number, readonly clientY: number}): PointerPosition {
        const area = this.options.cellArea();
        return {
            x: cellsAlong(event.clientX - area.left, area.width, area.columns),
            y: cellsAlong(event.clientY - area.top, area.height, area.rows),
        };
    }
}

export function installDomInput(target: DomInputTarget, options: DomInputOptions): () => void {
    const input = new DomInput(target, options);
    input.install();
    return () => input.uninstall();
}
