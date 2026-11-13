import {Key, keyForCharacter} from "../../../engine/input";
import type {CharacterKey, Modifiers} from "../../../engine/input";
import {isPrintableCodePoint} from "./keyReport";
import type {KeyReport, KeyTransition} from "./keyReport";

const CSI = "\x1b[";

const DISAMBIGUATE_ESCAPE_CODES_FLAG = 0b1;
const REPORT_EVENT_TYPES_FLAG = 0b10;
const REPORT_ALL_KEYS_AS_ESCAPE_CODES_FLAG = 0b1000;
const REPORT_ASSOCIATED_TEXT_FLAG = 0b10000;
const PUSHED_FLAGS = DISAMBIGUATE_ESCAPE_CODES_FLAG | REPORT_EVENT_TYPES_FLAG
    | REPORT_ALL_KEYS_AS_ESCAPE_CODES_FLAG | REPORT_ASSOCIATED_TEXT_FLAG;

export const PUSH_KITTY_KEYBOARD_FLAGS = `${CSI}>${PUSHED_FLAGS}u`;
export const QUERY_KITTY_KEYBOARD_FLAGS = `${CSI}?u`;
export const POP_KITTY_KEYBOARD_FLAGS = `${CSI}<u`;

export const KITTY_FLAGS_REPLY = /\x1b\[\?(\d+)u/y;
export const KITTY_KEY_REPORT = /\x1b\[(\d[\d:;]*)u/y;
export const KITTY_FUNCTIONAL_KEY_REPORT = /\x1b\[(\d*)(?:;(\d*)(?::(\d+))?)?([ABCDEFHPQS~])/y;

export interface KittyKeyReport extends KeyReport {
    readonly eventTypeReported: boolean;
}

const DECIMAL = 10;
const FIELD_SEPARATOR = ";";
const SUBFIELD_SEPARATOR = ":";
const NO_FIELD = "";

const SHIFT_BIT = 0b1;
const ALT_BIT = 0b10;
const CTRL_BIT = 0b100;
const SUPER_BIT = 0b1000;
const META_BIT = 0b100000;
const MODIFIER_ENCODING_OFFSET = 1;
const NO_MODIFIER_BITS = 0;

const REPEAT_EVENT_TYPE = 2;
const RELEASE_EVENT_TYPE = 3;

const TAB_KEY_CODE = 9;
const ENTER_KEY_CODE = 13;
const ESCAPE_KEY_CODE = 27;
const BACKSPACE_KEY_CODE = 127;
const KEYPAD_0_KEY_CODE = 57399;
const KEYPAD_DIGIT_COUNT = 10;
const KEYPAD_DECIMAL_KEY_CODE = 57409;
const KEYPAD_DIVIDE_KEY_CODE = 57410;
const KEYPAD_MULTIPLY_KEY_CODE = 57411;
const KEYPAD_SUBTRACT_KEY_CODE = 57412;
const KEYPAD_ADD_KEY_CODE = 57413;
const KEYPAD_ENTER_KEY_CODE = 57414;
const KEYPAD_EQUAL_KEY_CODE = 57415;
const KEYPAD_SEPARATOR_KEY_CODE = 57416;
const KEYPAD_LEFT_KEY_CODE = 57417;
const KEYPAD_RIGHT_KEY_CODE = 57418;
const KEYPAD_UP_KEY_CODE = 57419;
const KEYPAD_DOWN_KEY_CODE = 57420;
const KEYPAD_PAGE_UP_KEY_CODE = 57421;
const KEYPAD_PAGE_DOWN_KEY_CODE = 57422;
const KEYPAD_HOME_KEY_CODE = 57423;
const KEYPAD_END_KEY_CODE = 57424;
const KEYPAD_INSERT_KEY_CODE = 57425;
const KEYPAD_DELETE_KEY_CODE = 57426;

const FIRST_PRIVATE_USE_CODE_POINT = 0xe000;
const LAST_PRIVATE_USE_CODE_POINT = 0xf8ff;
const LAST_CODE_POINT = 0x10ffff;

const INSERT_TILDE_NUMBER = 2;
const DELETE_TILDE_NUMBER = 3;
const PAGE_UP_TILDE_NUMBER = 5;
const PAGE_DOWN_TILDE_NUMBER = 6;
const HOME_TILDE_NUMBER = 7;
const END_TILDE_NUMBER = 8;
const F1_TILDE_NUMBER = 11;
const F2_TILDE_NUMBER = 12;
const F3_TILDE_NUMBER = 13;
const F4_TILDE_NUMBER = 14;
const F5_TILDE_NUMBER = 15;
const F6_TILDE_NUMBER = 17;
const F7_TILDE_NUMBER = 18;
const F8_TILDE_NUMBER = 19;
const F9_TILDE_NUMBER = 20;
const F10_TILDE_NUMBER = 21;
const F11_TILDE_NUMBER = 23;
const F12_TILDE_NUMBER = 24;
const TILDE_FINAL = "~";

const UNSHIFTED = false;

const KEY_BY_TILDE_NUMBER: ReadonlyMap<number, Key> = new Map([
    [INSERT_TILDE_NUMBER, Key.Insert], [DELETE_TILDE_NUMBER, Key.Delete],
    [PAGE_UP_TILDE_NUMBER, Key.PageUp], [PAGE_DOWN_TILDE_NUMBER, Key.PageDown],
    [HOME_TILDE_NUMBER, Key.Home], [END_TILDE_NUMBER, Key.End],
    [F1_TILDE_NUMBER, Key.F1], [F2_TILDE_NUMBER, Key.F2], [F3_TILDE_NUMBER, Key.F3], [F4_TILDE_NUMBER, Key.F4],
    [F5_TILDE_NUMBER, Key.F5], [F6_TILDE_NUMBER, Key.F6], [F7_TILDE_NUMBER, Key.F7], [F8_TILDE_NUMBER, Key.F8],
    [F9_TILDE_NUMBER, Key.F9], [F10_TILDE_NUMBER, Key.F10], [F11_TILDE_NUMBER, Key.F11], [F12_TILDE_NUMBER, Key.F12],
]);

const KEY_BY_LETTER_FINAL: ReadonlyMap<string, Key> = new Map([
    ["A", Key.Up], ["B", Key.Down], ["C", Key.Right], ["D", Key.Left],
    ["F", Key.End], ["H", Key.Home], ["P", Key.F1], ["Q", Key.F2], ["S", Key.F4],
]);

const KEYPAD_CHARACTER_BY_KEY_CODE: readonly (readonly [number, string])[] = [
    [KEYPAD_DECIMAL_KEY_CODE, "."], [KEYPAD_DIVIDE_KEY_CODE, "/"], [KEYPAD_MULTIPLY_KEY_CODE, "*"],
    [KEYPAD_SUBTRACT_KEY_CODE, "-"], [KEYPAD_ADD_KEY_CODE, "+"], [KEYPAD_EQUAL_KEY_CODE, "="],
    [KEYPAD_SEPARATOR_KEY_CODE, ","],
];

function functionalKeyTable(): ReadonlyMap<number, Key> {
    const table = new Map<number, Key>([
        [TAB_KEY_CODE, Key.Tab], [ENTER_KEY_CODE, Key.Enter], [ESCAPE_KEY_CODE, Key.Escape],
        [BACKSPACE_KEY_CODE, Key.Backspace], [KEYPAD_ENTER_KEY_CODE, Key.Enter],
        [KEYPAD_LEFT_KEY_CODE, Key.Left], [KEYPAD_RIGHT_KEY_CODE, Key.Right],
        [KEYPAD_UP_KEY_CODE, Key.Up], [KEYPAD_DOWN_KEY_CODE, Key.Down],
        [KEYPAD_PAGE_UP_KEY_CODE, Key.PageUp], [KEYPAD_PAGE_DOWN_KEY_CODE, Key.PageDown],
        [KEYPAD_HOME_KEY_CODE, Key.Home], [KEYPAD_END_KEY_CODE, Key.End],
        [KEYPAD_INSERT_KEY_CODE, Key.Insert], [KEYPAD_DELETE_KEY_CODE, Key.Delete],
    ]);
    const keypadCharacters = [...KEYPAD_CHARACTER_BY_KEY_CODE];
    for (let digit = 0; digit < KEYPAD_DIGIT_COUNT; digit++) keypadCharacters.push([KEYPAD_0_KEY_CODE + digit, String(digit)]);
    for (const [keyCode, character] of keypadCharacters) {
        const mapped = keyForCharacter(character);
        if (mapped !== undefined) table.set(keyCode, mapped.key);
    }
    return table;
}

const KEY_BY_FUNCTIONAL_KEY_CODE = functionalKeyTable();

function isPrivateUseCodePoint(codePoint: number): boolean {
    return codePoint >= FIRST_PRIVATE_USE_CODE_POINT && codePoint <= LAST_PRIVATE_USE_CODE_POINT;
}

function isCodePoint(value: number): boolean {
    return Number.isInteger(value) && value >= 0 && value <= LAST_CODE_POINT;
}

function characterKeyOf(keyCode: number): CharacterKey | undefined {
    const functional = KEY_BY_FUNCTIONAL_KEY_CODE.get(keyCode);
    if (functional !== undefined) return {key: functional, shift: UNSHIFTED};
    if (!isCodePoint(keyCode)) return undefined;
    return keyForCharacter(String.fromCodePoint(keyCode));
}

function modifierBitsOf(field: string): number {
    const encoded = Number.parseInt(field, DECIMAL);
    if (Number.isNaN(encoded) || encoded < MODIFIER_ENCODING_OFFSET) return NO_MODIFIER_BITS;
    return encoded - MODIFIER_ENCODING_OFFSET;
}

function modifiersOf(bits: number): Modifiers {
    return {
        ctrl: (bits & CTRL_BIT) !== 0,
        alt: (bits & ALT_BIT) !== 0,
        shift: (bits & SHIFT_BIT) !== 0,
        meta: (bits & (SUPER_BIT | META_BIT)) !== 0,
    };
}

function transitionOf(eventType: string | undefined): KeyTransition {
    const type = Number.parseInt(eventType ?? NO_FIELD, DECIMAL);
    if (type === REPEAT_EVENT_TYPE) return "repeat";
    if (type === RELEASE_EVENT_TYPE) return "release";
    return "press";
}

function isReported(eventType: string | undefined): boolean {
    return eventType !== undefined && eventType !== NO_FIELD;
}

function associatedText(field: string): string | undefined {
    const codePoints = field.split(SUBFIELD_SEPARATOR)
        .map(codePoint => Number.parseInt(codePoint, DECIMAL))
        .filter(codePoint => isCodePoint(codePoint) && isPrintableCodePoint(codePoint));
    return codePoints.length === 0 ? undefined : String.fromCodePoint(...codePoints);
}

function unmodifiedKeyText(keyCode: number, modifiers: Modifiers): string | undefined {
    if (modifiers.shift || modifiers.ctrl || modifiers.alt || modifiers.meta) return undefined;
    if (!isCodePoint(keyCode) || !isPrintableCodePoint(keyCode) || isPrivateUseCodePoint(keyCode)) return undefined;
    return String.fromCodePoint(keyCode);
}

function reportedText(transition: KeyTransition, textField: string, keyCode: number, modifiers: Modifiers): string | undefined {
    if (transition === "release") return undefined;
    if (textField !== NO_FIELD) return associatedText(textField);
    return unmodifiedKeyText(keyCode, modifiers);
}

export function kittyFlagsReplyReportsEventTypes(reply: RegExpExecArray): boolean {
    return (Number.parseInt(reply[1], DECIMAL) & REPORT_EVENT_TYPES_FLAG) !== 0;
}

export function kittyFunctionalReportHasEventType(report: RegExpExecArray): boolean {
    return isReported(report[3]);
}

export function readKittyKeyReport(report: RegExpExecArray): KittyKeyReport {
    const [keyField, modifierField = NO_FIELD, textField = NO_FIELD] = report[1].split(FIELD_SEPARATOR);
    const keyCode = Number.parseInt(keyField.split(SUBFIELD_SEPARATOR)[0], DECIMAL);
    const [modifierBits, eventType] = modifierField.split(SUBFIELD_SEPARATOR);
    const modifiers = modifiersOf(modifierBitsOf(modifierBits));
    const mapped = characterKeyOf(keyCode);
    const transition = transitionOf(eventType);
    return {
        key: mapped?.key,
        transition,
        modifiers: {...modifiers, shift: modifiers.shift || (mapped?.shift ?? UNSHIFTED)},
        text: reportedText(transition, textField, keyCode, modifiers),
        eventTypeReported: isReported(eventType),
    };
}

export function readKittyFunctionalKeyReport(report: RegExpExecArray): KittyKeyReport {
    const [, number, modifierBits = NO_FIELD, eventType, final] = report;
    return {
        key: final === TILDE_FINAL ? KEY_BY_TILDE_NUMBER.get(Number.parseInt(number, DECIMAL)) : KEY_BY_LETTER_FINAL.get(final),
        transition: transitionOf(eventType),
        modifiers: modifiersOf(modifierBitsOf(modifierBits)),
        text: undefined,
        eventTypeReported: isReported(eventType),
    };
}
