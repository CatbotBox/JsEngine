import {Key} from "./key";
import {POINTER_BUTTONS} from "./pointerButton";
import type {PointerButton} from "./pointerButton";

export interface Modifiers {
    readonly ctrl: boolean;
    readonly alt: boolean;
    readonly shift: boolean;
    readonly meta: boolean;
}

export const NO_MODIFIERS: Modifiers = Object.freeze({ctrl: false, alt: false, shift: false, meta: false});

export interface PointerPosition {
    readonly x: number;
    readonly y: number;
}

export interface KeyDownEvent extends Modifiers {
    readonly type: "keyDown";
    readonly key: Key;
    readonly repeat: boolean;
}

export interface KeyUpEvent extends Modifiers {
    readonly type: "keyUp";
    readonly key: Key;
}

export interface TextTypedEvent {
    readonly type: "text";
    readonly text: string;
}

export interface PointerDownEvent extends Modifiers, PointerPosition {
    readonly type: "pointerDown";
    readonly button: PointerButton;
}

export interface PointerUpEvent extends Modifiers, PointerPosition {
    readonly type: "pointerUp";
    readonly button: PointerButton;
}

export interface PointerMoveEvent extends Modifiers, PointerPosition {
    readonly type: "pointerMove";
}

export interface WheelScrollEvent extends Modifiers, PointerPosition {
    readonly type: "wheel";
    readonly delta: number;
}

export interface FocusChangeEvent {
    readonly type: "focus";
    readonly focused: boolean;
}

export type InputEvent =
    | KeyDownEvent
    | KeyUpEvent
    | TextTypedEvent
    | PointerDownEvent
    | PointerUpEvent
    | PointerMoveEvent
    | WheelScrollEvent
    | FocusChangeEvent;

export type InputEventType = InputEvent["type"];

export interface InputEventSink {
    enqueue(event: InputEvent): void;
}

type EventFields = Readonly<Record<string, unknown>>;

const KEYS: ReadonlySet<unknown> = new Set<unknown>(Object.values(Key));
const BUTTONS: ReadonlySet<unknown> = new Set<unknown>(POINTER_BUTTONS);

const isBoolean = (value: unknown): boolean => typeof value === "boolean";
const isFiniteNumber = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value);
const hasModifiers = (event: EventFields): boolean =>
    isBoolean(event.ctrl) && isBoolean(event.alt) && isBoolean(event.shift) && isBoolean(event.meta);
const hasPosition = (event: EventFields): boolean => isFiniteNumber(event.x) && isFiniteNumber(event.y);
const isButtonEvent = (event: EventFields): boolean => BUTTONS.has(event.button) && hasPosition(event) && hasModifiers(event);

const HAS_FIELDS_OF_TYPE: Readonly<Record<InputEventType, (event: EventFields) => boolean>> = {
    keyDown: event => KEYS.has(event.key) && isBoolean(event.repeat) && hasModifiers(event),
    keyUp: event => KEYS.has(event.key) && hasModifiers(event),
    text: event => typeof event.text === "string",
    pointerDown: isButtonEvent,
    pointerUp: isButtonEvent,
    pointerMove: event => hasPosition(event) && hasModifiers(event),
    wheel: event => isFiniteNumber(event.delta) && hasPosition(event) && hasModifiers(event),
    focus: event => isBoolean(event.focused),
};

export function isInputEvent(value: unknown): value is InputEvent {
    if (typeof value !== "object" || value === null) return false;
    const event = value as EventFields;
    const type = event.type;
    if (typeof type !== "string" || !Object.prototype.hasOwnProperty.call(HAS_FIELDS_OF_TYPE, type)) return false;
    return HAS_FIELDS_OF_TYPE[type as InputEventType](event);
}
