export type SmokeModifier = "control" | "shift" | "alt" | "meta";
export type SmokeMouseButton = "left" | "middle" | "right";

export interface SmokeKeyEvent {
    readonly type: "keyDown" | "char" | "keyUp";
    readonly keyCode: string;
    readonly modifiers: SmokeModifier[];
}

export interface SmokeMouseEvent {
    readonly type: "mouseMove" | "mouseDown" | "mouseUp";
    readonly x: number;
    readonly y: number;
    readonly button: SmokeMouseButton;
    readonly clickCount: number;
    readonly modifiers: SmokeModifier[];
}

export type SmokeInputEvent = SmokeKeyEvent | SmokeMouseEvent;

export class SmokeChordError extends Error {
}

const CHORD_SEPARATOR = "+";
const SINGLE_CLICK = 1;
const NO_CLICK = 0;
const MODIFIER_NAMES: Readonly<Record<string, SmokeModifier>> = {ctrl: "control", control: "control", shift: "shift", alt: "alt", meta: "meta", cmd: "meta"};
const TYPED_WITHOUT_COMMAND_MODIFIERS = /^[ -~]$/;
const SINGLE_LETTER = /^[a-z]$/i;
const ELECTRON_KEY_CODES: Readonly<Record<string, string>> = {ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right"};

export function keyEventsOfChord(chord: string): SmokeKeyEvent[] {
    const parts = chord.split(CHORD_SEPARATOR).map(part => part.trim());
    const named = parts.pop();
    if (named === undefined || named.length === 0) throw new SmokeChordError(`"${chord}" names no key`);
    const keyCode = SINGLE_LETTER.test(named) ? named.toLowerCase() : ELECTRON_KEY_CODES[named] ?? named;
    const modifiers = parts.map(part => {
        const modifier = MODIFIER_NAMES[part.toLowerCase()];
        if (modifier === undefined) throw new SmokeChordError(`"${part}" in "${chord}" is not a modifier`);
        return modifier;
    });
    const typesCharacter = TYPED_WITHOUT_COMMAND_MODIFIERS.test(keyCode) && !modifiers.some(modifier => modifier === "control" || modifier === "alt" || modifier === "meta");
    return [
        {type: "keyDown", keyCode, modifiers},
        ...(typesCharacter ? [{type: "char" as const, keyCode, modifiers}] : []),
        {type: "keyUp", keyCode, modifiers},
    ];
}

export function mouseEventsOfClick(x: number, y: number, button: SmokeMouseButton): SmokeMouseEvent[] {
    const at = {x: Math.round(x), y: Math.round(y), button, modifiers: []};
    return [
        {...at, type: "mouseMove", clickCount: NO_CLICK},
        {...at, type: "mouseDown", clickCount: SINGLE_CLICK},
        {...at, type: "mouseUp", clickCount: SINGLE_CLICK},
    ];
}

export function mouseEventOfHover(x: number, y: number): SmokeMouseEvent {
    return {type: "mouseMove", x: Math.round(x), y: Math.round(y), button: "left", clickCount: NO_CLICK, modifiers: []};
}
