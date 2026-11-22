import {Key, keyForCharacter} from "../../engine/input/key";
import {PointerButton} from "../../engine/input/pointerButton";
import type {InputEvent, InputEventSink, KeyDownEvent, Modifiers, PointerPosition} from "../../engine/input/inputEvent";
import type {CellArea} from "../../hosts/web/domInput";

export type TerminalBytesSink = (data: string) => void;

const ESCAPE = "\x1b";
const CSI = `${ESCAPE}[`;
const SS3 = `${ESCAPE}O`;
const NUL = "\x00";
const DELETE = "\x7f";
const BACKSPACE = "\b";
const CARRIAGE_RETURN = "\r";
const TAB = "\t";
const BACK_TAB = `${CSI}Z`;
const FOCUS_IN_REPORT = `${CSI}I`;
const FOCUS_OUT_REPORT = `${CSI}O`;
const NOTHING = "";

const MODIFIER_PARAMETER_BASE = 1;
const SHIFT_PARAMETER_BIT = 1;
const ALT_PARAMETER_BIT = 2;
const CTRL_PARAMETER_BIT = 4;
const CURSOR_KEY_ROW_PARAMETER = 1;

const CURSOR_KEY_FINALS: ReadonlyMap<Key, string> = new Map([
    [Key.Up, "A"], [Key.Down, "B"], [Key.Right, "C"], [Key.Left, "D"], [Key.Home, "H"], [Key.End, "F"],
]);
const SS3_FUNCTION_KEY_FINALS: ReadonlyMap<Key, string> = new Map([
    [Key.F1, "P"], [Key.F2, "Q"], [Key.F3, "R"], [Key.F4, "S"],
]);
const TILDE_KEY_NUMBERS: ReadonlyMap<Key, number> = new Map([
    [Key.Insert, 2], [Key.Delete, 3], [Key.PageUp, 5], [Key.PageDown, 6],
    [Key.F5, 15], [Key.F6, 17], [Key.F7, 18], [Key.F8, 19], [Key.F9, 20], [Key.F10, 21], [Key.F11, 23], [Key.F12, 24],
]);
const TILDE_FINAL = "~";
const MODIFIER_KEYS: ReadonlySet<Key> = new Set([Key.Shift, Key.Ctrl, Key.Alt, Key.Meta]);

const CONTROL_CODE_MASK = 0x1f;
const LETTER = /^[a-z]$/i;
const CONTROL_CHARACTERS: ReadonlyMap<string, string> = new Map([
    ["@", NUL], ["2", NUL], [" ", NUL],
    ["[", ESCAPE], ["\\", "\x1c"], ["]", "\x1d"], ["^", "\x1e"], ["6", "\x1e"], ["_", "\x1f"], ["-", "\x1f"], ["/", "\x1f"],
]);

const FIRST_PRINTABLE_ASCII = 0x20;
const LAST_PRINTABLE_ASCII = 0x7e;
const UNSHIFTED = false;

const SGR_MOUSE_PREFIX = `${CSI}<`;
const SGR_PRESS_FINAL = "M";
const SGR_RELEASE_FINAL = "m";
const SGR_SHIFT_BIT = 4;
const SGR_ALT_BIT = 8;
const SGR_CTRL_BIT = 16;
const SGR_MOTION_BIT = 32;
const SGR_NO_BUTTON = 3;
const SGR_WHEEL_UP = 64;
const SGR_WHEEL_DOWN = 65;
const SGR_FIRST_CELL = 1;
const SGR_BUTTON_CODES: ReadonlyMap<PointerButton, number> = new Map([
    [PointerButton.Left, 0], [PointerButton.Middle, 1], [PointerButton.Right, 2],
]);
const WHOLE_NOTCH = 1;

function characterTableKey(key: Key, shift: boolean): string {
    return `${key}\0${shift}`;
}

function printableCharacterTable(): ReadonlyMap<string, string> {
    const table = new Map<string, string>();
    for (let code = FIRST_PRINTABLE_ASCII; code <= LAST_PRINTABLE_ASCII; code++) {
        const character = String.fromCharCode(code);
        const typed = keyForCharacter(character);
        if (typed !== undefined) table.set(characterTableKey(typed.key, typed.shift), character);
    }
    return table;
}

const CHARACTER_BY_KEY = printableCharacterTable();

function characterOf(key: Key, shift: boolean): string | undefined {
    return CHARACTER_BY_KEY.get(characterTableKey(key, shift)) ?? CHARACTER_BY_KEY.get(characterTableKey(key, UNSHIFTED));
}

function modifierParameter(modifiers: Modifiers): number {
    return MODIFIER_PARAMETER_BASE
        + (modifiers.shift ? SHIFT_PARAMETER_BIT : 0)
        + (modifiers.alt ? ALT_PARAMETER_BIT : 0)
        + (modifiers.ctrl ? CTRL_PARAMETER_BIT : 0);
}

function controlBytes(character: string): string {
    if (LETTER.test(character)) return String.fromCharCode(character.toLowerCase().charCodeAt(0) & CONTROL_CODE_MASK);
    return CONTROL_CHARACTERS.get(character) ?? character;
}

function escapedWhenAlt(event: KeyDownEvent, bytes: string): string {
    return event.alt ? ESCAPE + bytes : bytes;
}

function functionKeyBytes(event: KeyDownEvent): string | undefined {
    const parameter = modifierParameter(event);
    const modified = parameter !== MODIFIER_PARAMETER_BASE;
    const cursorFinal = CURSOR_KEY_FINALS.get(event.key) ?? SS3_FUNCTION_KEY_FINALS.get(event.key);
    if (cursorFinal !== undefined) {
        if (modified) return `${CSI}${CURSOR_KEY_ROW_PARAMETER};${parameter}${cursorFinal}`;
        return CURSOR_KEY_FINALS.has(event.key) ? CSI + cursorFinal : SS3 + cursorFinal;
    }
    const number = TILDE_KEY_NUMBERS.get(event.key);
    if (number === undefined) return undefined;
    return modified ? `${CSI}${number};${parameter}${TILDE_FINAL}` : `${CSI}${number}${TILDE_FINAL}`;
}

function editingKeyBytes(event: KeyDownEvent): string | undefined {
    switch (event.key) {
        case Key.Enter:
            return escapedWhenAlt(event, CARRIAGE_RETURN);
        case Key.Tab:
            return event.shift ? BACK_TAB : escapedWhenAlt(event, TAB);
        case Key.Backspace:
            return escapedWhenAlt(event, event.ctrl ? BACKSPACE : DELETE);
        case Key.Escape:
            return escapedWhenAlt(event, ESCAPE);
        default:
            return undefined;
    }
}

function characterKeyBytes(event: KeyDownEvent): string {
    const textEventCarriesCharacter = event.ctrl === event.alt;
    if (textEventCarriesCharacter) return NOTHING;
    const character = characterOf(event.key, event.shift);
    if (character === undefined) return NOTHING;
    return event.ctrl ? controlBytes(character) : ESCAPE + character;
}

export function legacyKeyBytes(event: KeyDownEvent): string {
    if (event.meta || MODIFIER_KEYS.has(event.key)) return NOTHING;
    return functionKeyBytes(event) ?? editingKeyBytes(event) ?? characterKeyBytes(event);
}

function sgrModifierBits(modifiers: Modifiers): number {
    return (modifiers.shift ? SGR_SHIFT_BIT : 0) | (modifiers.alt ? SGR_ALT_BIT : 0) | (modifiers.ctrl ? SGR_CTRL_BIT : 0);
}

function sgrCell(position: number, cells: number): number {
    const cell = Math.floor(position) + SGR_FIRST_CELL;
    const last = cells > 0 ? Math.max(SGR_FIRST_CELL, Math.floor(cells)) : Number.POSITIVE_INFINITY;
    return Math.min(Math.max(SGR_FIRST_CELL, cell), last);
}

export class TerminalInputEncoder implements InputEventSink {
    private readonly buttonsHeld = new Set<PointerButton>();
    private lastMotionCell = "";
    private wheelNotches = 0;

    public constructor(private readonly send: TerminalBytesSink, private readonly cellArea: () => CellArea) {
    }

    public enqueue(event: InputEvent): void {
        const bytes = this.bytesOf(event);
        if (bytes.length > 0) this.send(bytes);
    }

    private bytesOf(event: InputEvent): string {
        switch (event.type) {
            case "keyDown":
                return legacyKeyBytes(event);
            case "keyUp":
                return NOTHING;
            case "text":
                return event.text;
            case "pointerDown":
                this.buttonsHeld.add(event.button);
                return this.buttonReport(event.button, event, event, SGR_PRESS_FINAL);
            case "pointerUp":
                this.buttonsHeld.delete(event.button);
                return this.buttonReport(event.button, event, event, SGR_RELEASE_FINAL);
            case "pointerMove":
                return this.motionReport(event, event);
            case "wheel":
                return this.wheelReports(event.delta, event, event);
            case "focus":
                if (event.focused) return FOCUS_IN_REPORT;
                this.buttonsHeld.clear();
                return FOCUS_OUT_REPORT;
        }
    }

    private cellOf(position: PointerPosition): string {
        const area = this.cellArea();
        return `${sgrCell(position.x, area.columns)};${sgrCell(position.y, area.rows)}`;
    }

    private report(code: number, cell: string, final: string): string {
        return `${SGR_MOUSE_PREFIX}${code};${cell}${final}`;
    }

    private buttonReport(button: PointerButton, position: PointerPosition, modifiers: Modifiers, final: string): string {
        const code = SGR_BUTTON_CODES.get(button);
        if (code === undefined) return NOTHING;
        const cell = this.cellOf(position);
        this.lastMotionCell = cell;
        return this.report(code | sgrModifierBits(modifiers), cell, final);
    }

    private motionReport(position: PointerPosition, modifiers: Modifiers): string {
        const cell = this.cellOf(position);
        if (cell === this.lastMotionCell) return NOTHING;
        this.lastMotionCell = cell;
        const held = [...this.buttonsHeld].map(button => SGR_BUTTON_CODES.get(button) ?? SGR_NO_BUTTON);
        const button = held.length === 0 ? SGR_NO_BUTTON : Math.min(...held);
        return this.report(SGR_MOTION_BIT | button | sgrModifierBits(modifiers), cell, SGR_PRESS_FINAL);
    }

    private wheelReports(delta: number, position: PointerPosition, modifiers: Modifiers): string {
        this.wheelNotches += delta;
        const cell = this.cellOf(position);
        let reports = NOTHING;
        while (Math.abs(this.wheelNotches) >= WHOLE_NOTCH) {
            const up = this.wheelNotches > 0;
            reports += this.report((up ? SGR_WHEEL_UP : SGR_WHEEL_DOWN) | sgrModifierBits(modifiers), cell, SGR_PRESS_FINAL);
            this.wheelNotches -= up ? WHOLE_NOTCH : -WHOLE_NOTCH;
        }
        return reports;
    }
}
