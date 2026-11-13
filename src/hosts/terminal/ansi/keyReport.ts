import type {Key, Modifiers} from "../../../engine/input";

export type KeyTransition = "press" | "repeat" | "release";

export interface KeyReport {
    readonly key: Key | undefined;
    readonly transition: KeyTransition;
    readonly modifiers: Modifiers;
    readonly text: string | undefined;
}

const FIRST_PRINTABLE_CODE_POINT = 0x20;
const DELETE_CODE_POINT = 0x7f;

export function isPrintableCodePoint(codePoint: number): boolean {
    return codePoint >= FIRST_PRINTABLE_CODE_POINT && codePoint !== DELETE_CODE_POINT;
}

export function modifiersAllowText(modifiers: Modifiers): boolean {
    const altGraph = modifiers.ctrl && modifiers.alt;
    const unmodified = !modifiers.ctrl && !modifiers.alt;
    return !modifiers.meta && (unmodified || altGraph);
}
