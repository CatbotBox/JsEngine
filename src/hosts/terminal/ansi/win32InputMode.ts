import {Key, keyForCharacter} from "../../../engine/input";
import type {Modifiers} from "../../../engine/input";
import {isPrintableCodePoint, modifiersAllowText} from "./keyReport";
import type {KeyReport} from "./keyReport";

const CSI = "\x1b[";
const WIN32_INPUT_MODE = "?9001";

export const ENABLE_WIN32_INPUT_MODE = `${CSI}${WIN32_INPUT_MODE}h`;
export const DISABLE_WIN32_INPUT_MODE = `${CSI}${WIN32_INPUT_MODE}l`;

export const WIN32_KEY_REPORT = /\x1b\[(\d*(?:;\d*)*)_/y;

const DECIMAL = 10;
const FIELD_SEPARATOR = ";";
const NO_FIELD = "";
const VIRTUAL_KEY_FIELD = 0;
const UNICODE_CHARACTER_FIELD = 2;
const KEY_DOWN_FIELD = 3;
const CONTROL_KEY_STATE_FIELD = 4;
const REPEAT_COUNT_FIELD = 5;
const ABSENT_FIELD_VALUE = 0;
const ABSENT_REPEAT_COUNT = 1;
const MIN_REPEAT_COUNT = 1;
const MAX_REPEAT_COUNT = 0xffff;
const KEY_DOWN = 1;
const LAST_UTF16_CODE_UNIT = 0xffff;

const RIGHT_ALT_PRESSED = 0x1;
const LEFT_ALT_PRESSED = 0x2;
const RIGHT_CTRL_PRESSED = 0x4;
const LEFT_CTRL_PRESSED = 0x8;
const SHIFT_PRESSED = 0x10;

const VK_BACK = 0x08;
const VK_TAB = 0x09;
const VK_RETURN = 0x0d;
const VK_ESCAPE = 0x1b;
const VK_SPACE = 0x20;
const VK_PRIOR = 0x21;
const VK_NEXT = 0x22;
const VK_END = 0x23;
const VK_HOME = 0x24;
const VK_LEFT = 0x25;
const VK_UP = 0x26;
const VK_RIGHT = 0x27;
const VK_DOWN = 0x28;
const VK_INSERT = 0x2d;
const VK_DELETE = 0x2e;
const VK_0 = 0x30;
const VK_9 = 0x39;
const VK_A = 0x41;
const VK_Z = 0x5a;
const VK_NUMPAD0 = 0x60;
const NUMPAD_DIGIT_COUNT = 10;
const VK_MULTIPLY = 0x6a;
const VK_ADD = 0x6b;
const VK_SUBTRACT = 0x6d;
const VK_DECIMAL = 0x6e;
const VK_DIVIDE = 0x6f;
const VK_F1 = 0x70;
const VK_OEM_1 = 0xba;
const VK_OEM_PLUS = 0xbb;
const VK_OEM_COMMA = 0xbc;
const VK_OEM_MINUS = 0xbd;
const VK_OEM_PERIOD = 0xbe;
const VK_OEM_2 = 0xbf;
const VK_OEM_3 = 0xc0;
const VK_OEM_4 = 0xdb;
const VK_OEM_5 = 0xdc;
const VK_OEM_6 = 0xdd;
const VK_OEM_7 = 0xde;

const FUNCTION_KEYS_FROM_F1: readonly Key[] = [
    Key.F1, Key.F2, Key.F3, Key.F4, Key.F5, Key.F6, Key.F7, Key.F8, Key.F9, Key.F10, Key.F11, Key.F12,
];

const NUMPAD_CHARACTER_BY_VIRTUAL_KEY: readonly (readonly [number, string])[] = [
    [VK_MULTIPLY, "*"], [VK_ADD, "+"], [VK_SUBTRACT, "-"], [VK_DECIMAL, "."], [VK_DIVIDE, "/"],
];

function virtualKeyTable(): ReadonlyMap<number, Key> {
    const table = new Map<number, Key>([
        [VK_BACK, Key.Backspace], [VK_TAB, Key.Tab], [VK_RETURN, Key.Enter], [VK_ESCAPE, Key.Escape],
        [VK_SPACE, Key.Space], [VK_PRIOR, Key.PageUp], [VK_NEXT, Key.PageDown], [VK_END, Key.End],
        [VK_HOME, Key.Home], [VK_LEFT, Key.Left], [VK_UP, Key.Up], [VK_RIGHT, Key.Right], [VK_DOWN, Key.Down],
        [VK_INSERT, Key.Insert], [VK_DELETE, Key.Delete],
        [VK_OEM_1, Key.Semicolon], [VK_OEM_PLUS, Key.Equal], [VK_OEM_COMMA, Key.Comma], [VK_OEM_MINUS, Key.Minus],
        [VK_OEM_PERIOD, Key.Period], [VK_OEM_2, Key.Slash], [VK_OEM_3, Key.Backquote],
        [VK_OEM_4, Key.BracketLeft], [VK_OEM_5, Key.Backslash], [VK_OEM_6, Key.BracketRight], [VK_OEM_7, Key.Quote],
    ]);
    FUNCTION_KEYS_FROM_F1.forEach((key, offset) => table.set(VK_F1 + offset, key));

    const characters = [...NUMPAD_CHARACTER_BY_VIRTUAL_KEY];
    for (let digit = 0; digit < NUMPAD_DIGIT_COUNT; digit++) characters.push([VK_NUMPAD0 + digit, String(digit)]);
    for (let virtualKey = VK_0; virtualKey <= VK_9; virtualKey++) characters.push([virtualKey, String.fromCharCode(virtualKey)]);
    for (let virtualKey = VK_A; virtualKey <= VK_Z; virtualKey++) {
        characters.push([virtualKey, String.fromCharCode(virtualKey).toLowerCase()]);
    }
    for (const [virtualKey, character] of characters) {
        const mapped = keyForCharacter(character);
        if (mapped !== undefined) table.set(virtualKey, mapped.key);
    }
    return table;
}

const KEY_BY_VIRTUAL_KEY = virtualKeyTable();

function modifiersOf(controlKeyState: number): Modifiers {
    return {
        ctrl: (controlKeyState & (LEFT_CTRL_PRESSED | RIGHT_CTRL_PRESSED)) !== 0,
        alt: (controlKeyState & (LEFT_ALT_PRESSED | RIGHT_ALT_PRESSED)) !== 0,
        shift: (controlKeyState & SHIFT_PRESSED) !== 0,
        meta: false,
    };
}

function typedText(character: number, modifiers: Modifiers, repeatCount: number): string | undefined {
    if (character > LAST_UTF16_CODE_UNIT || !isPrintableCodePoint(character) || !modifiersAllowText(modifiers)) return undefined;
    return String.fromCharCode(character).repeat(repeatCount);
}

export function readWin32KeyReport(report: RegExpExecArray): KeyReport {
    const fields = report[1].split(FIELD_SEPARATOR);
    const field = (index: number, absent: number): number => {
        const value = Number.parseInt(fields[index] ?? NO_FIELD, DECIMAL);
        return Number.isNaN(value) ? absent : value;
    };
    const down = field(KEY_DOWN_FIELD, ABSENT_FIELD_VALUE) === KEY_DOWN;
    const modifiers = modifiersOf(field(CONTROL_KEY_STATE_FIELD, ABSENT_FIELD_VALUE));
    const repeatCount = Math.min(Math.max(field(REPEAT_COUNT_FIELD, ABSENT_REPEAT_COUNT), MIN_REPEAT_COUNT), MAX_REPEAT_COUNT);
    return {
        key: KEY_BY_VIRTUAL_KEY.get(field(VIRTUAL_KEY_FIELD, ABSENT_FIELD_VALUE)),
        transition: down ? "press" : "release",
        modifiers,
        text: down ? typedText(field(UNICODE_CHARACTER_FIELD, ABSENT_FIELD_VALUE), modifiers, repeatCount) : undefined,
    };
}
