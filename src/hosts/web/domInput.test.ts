import {describe, expect, test} from "../../engine/testing/harness";
import {Key} from "../../engine/input/key";
import {PointerButton} from "../../engine/input/pointerButton";
import {NO_MODIFIERS} from "../../engine/input/inputEvent";
import type {InputEvent, KeyDownEvent, Modifiers} from "../../engine/input/inputEvent";
import {installDomInput} from "./domInput";
import type {CellArea, DomInputTarget, DomKeyboardEvent, DomListenerOptions, DomPointerEvent, DomWheelEvent} from "./domInput";

const AREA: CellArea = {left: 10, top: 20, width: 800, height: 400, columns: 80, rows: 20};
const POINTER_ID = 7;
const DOM_DELTA_PIXEL = 0;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const DOM_BACK_BUTTON = 3;
const REPEATED = true;

interface ModifierInit {
    readonly ctrlKey?: boolean;
    readonly altKey?: boolean;
    readonly shiftKey?: boolean;
    readonly metaKey?: boolean;
    readonly repeat?: boolean;
}

class FakeDomEvent {
    public prevented = false;
    public stopped = false;
    public ctrlKey = false;
    public altKey = false;
    public shiftKey = false;
    public metaKey = false;

    public preventDefault(): void {
        this.prevented = true;
    }

    public stopPropagation(): void {
        this.stopped = true;
    }
}

class FakeKeyboardEvent extends FakeDomEvent implements DomKeyboardEvent {
    public repeat = false;

    public constructor(public readonly key: string, public readonly code: string, init: ModifierInit = {}) {
        super();
        Object.assign(this, init);
    }
}

class FakePointerEvent extends FakeDomEvent implements DomPointerEvent {
    public readonly pointerId = POINTER_ID;

    public constructor(public readonly button: number, public readonly clientX: number, public readonly clientY: number) {
        super();
    }
}

class FakeWheelEvent extends FakeDomEvent implements DomWheelEvent {
    public readonly clientX = AREA.left;
    public readonly clientY = AREA.top;

    public constructor(public readonly deltaY: number, public readonly deltaMode: number = DOM_DELTA_PIXEL) {
        super();
    }
}

interface Registration {
    readonly type: string;
    readonly listener: (event: never) => void;
    readonly options?: DomListenerOptions;
}

class FakeElement implements DomInputTarget {
    public readonly registrations: Registration[] = [];
    public readonly captures: number[] = [];

    public addEventListener(type: string, listener: (event: never) => void, options?: DomListenerOptions): void {
        this.registrations.push({type, listener, options});
    }

    public removeEventListener(type: string, listener: (event: never) => void, options?: DomListenerOptions): void {
        const index = this.registrations.findIndex(registration =>
            registration.type === type && registration.listener === listener && registration.options?.capture === options?.capture);
        if (index >= 0) this.registrations.splice(index, 1);
    }

    public setPointerCapture(pointerId: number): void {
        this.captures.push(pointerId);
    }

    public dispatch<E extends object>(type: string, event: E): E {
        for (const registration of [...this.registrations]) {
            if (registration.type === type) (registration.listener as (event: E) => void)(event);
        }
        return event;
    }
}

function installed(area: CellArea = AREA): {element: FakeElement, events: InputEvent[], uninstall: () => void} {
    const element = new FakeElement();
    const events: InputEvent[] = [];
    const uninstall = installDomInput(element, {sink: {enqueue: event => events.push(event)}, cellArea: () => area});
    return {element, events, uninstall};
}

function keyDown(key: Key, modifiers: Partial<Modifiers> = {}, repeat = false): KeyDownEvent {
    return {type: "keyDown", key, repeat, ...NO_MODIFIERS, ...modifiers};
}

function pressedKeys(events: readonly InputEvent[]): Key[] {
    return events.filter((event): event is KeyDownEvent => event.type === "keyDown").map(event => event.key);
}

describe("installDomInput wiring", () => {
    test("listens in the capture phase, keeps wheel cancelable, and uninstalls every listener", () => {
        const {element, uninstall} = installed();
        expect(element.registrations.map(registration => registration.type).sort()).toEqual([
            "focusin", "focusout", "keydown", "keyup", "pointercancel", "pointerdown", "pointermove", "pointerup", "wheel",
        ]);
        expect(element.registrations.every(registration => registration.options?.capture === true)).toBe(true);
        expect(element.registrations.find(registration => registration.type === "wheel")!.options?.passive).toBe(false);
        uninstall();
        expect(element.registrations).toEqual([]);
    });
});

describe("installDomInput keys", () => {
    test("KeyboardEvent.key maps to the base Key; shift and the other modifiers are exact flags", () => {
        const {element, events} = installed();
        element.dispatch("keydown", new FakeKeyboardEvent("ArrowUp", "ArrowUp"));
        element.dispatch("keydown", new FakeKeyboardEvent("A", "KeyA", {shiftKey: true}));
        element.dispatch("keydown", new FakeKeyboardEvent("[", "BracketLeft"));
        element.dispatch("keydown", new FakeKeyboardEvent("{", "BracketLeft", {shiftKey: true, repeat: true}));
        element.dispatch("keydown", new FakeKeyboardEvent("Enter", "NumpadEnter", {altKey: true}));
        element.dispatch("keydown", new FakeKeyboardEvent("7", "Numpad7"));
        expect(events.filter(event => event.type === "keyDown")).toEqual([
            keyDown(Key.Up),
            keyDown(Key.A, {shift: true}),
            keyDown(Key.BracketLeft),
            keyDown(Key.BracketLeft, {shift: true}, REPEATED),
            keyDown(Key.Enter, {alt: true}),
            keyDown(Key.Num7),
        ]);
    });

    test("bare modifier keys are keys of their own", () => {
        const {element, events} = installed();
        element.dispatch("keydown", new FakeKeyboardEvent("Shift", "ShiftLeft", {shiftKey: true}));
        element.dispatch("keydown", new FakeKeyboardEvent("Control", "ControlLeft", {ctrlKey: true}));
        element.dispatch("keydown", new FakeKeyboardEvent("Alt", "AltLeft", {altKey: true}));
        element.dispatch("keydown", new FakeKeyboardEvent("Meta", "MetaLeft", {metaKey: true}));
        expect(pressedKeys(events)).toEqual([Key.Shift, Key.Ctrl, Key.Alt, Key.Meta]);
    });

    test("a character with no Key falls back to the physical letter or digit key", () => {
        const {element, events} = installed();
        element.dispatch("keydown", new FakeKeyboardEvent("å", "KeyA", {altKey: true}));
        element.dispatch("keydown", new FakeKeyboardEvent("Dead", "KeyE", {altKey: true}));
        const dead = element.dispatch("keydown", new FakeKeyboardEvent("Dead", "Quote"));
        const ime = element.dispatch("keydown", new FakeKeyboardEvent("Process", "KeyK"));
        expect(pressedKeys(events)).toEqual([Key.A, Key.E, Key.K]);
        expect([dead.prevented, dead.stopped]).toEqual([false, false]);
        expect(ime.stopped).toBe(true);
    });

    test("printable characters typed without ctrl or meta are text; AltGr still types", () => {
        const {element, events} = installed();
        element.dispatch("keydown", new FakeKeyboardEvent(" ", "Space"));
        element.dispatch("keydown", new FakeKeyboardEvent("Q", "KeyQ", {shiftKey: true}));
        element.dispatch("keydown", new FakeKeyboardEvent("c", "KeyC", {ctrlKey: true}));
        element.dispatch("keydown", new FakeKeyboardEvent("v", "KeyV", {metaKey: true}));
        element.dispatch("keydown", new FakeKeyboardEvent("@", "KeyQ", {ctrlKey: true, altKey: true}));
        element.dispatch("keydown", new FakeKeyboardEvent("Tab", "Tab"));
        element.dispatch("keydown", new FakeKeyboardEvent("é", "Slash"));
        expect(events.filter(event => event.type === "text")).toEqual([
            {type: "text", text: " "}, {type: "text", text: "Q"}, {type: "text", text: "@"}, {type: "text", text: "é"},
        ]);
        expect(events.slice(0, 2)).toEqual([keyDown(Key.Space), {type: "text", text: " "}]);
    });

    test("keys the game consumes are kept from the browser; chords and function keys stay with it", () => {
        const {element, events} = installed();
        const consumed = ["Tab", " ", "ArrowDown", "PageDown", "Backspace", "/", "'"].map(key =>
            element.dispatch("keydown", new FakeKeyboardEvent(key, "")));
        expect(consumed.every(event => event.prevented && event.stopped)).toBe(true);

        const reload = element.dispatch("keydown", new FakeKeyboardEvent("r", "KeyR", {ctrlKey: true}));
        const copy = element.dispatch("keydown", new FakeKeyboardEvent("c", "KeyC", {metaKey: true}));
        const devtools = element.dispatch("keydown", new FakeKeyboardEvent("F12", "F12"));
        const back = element.dispatch("keydown", new FakeKeyboardEvent("ArrowLeft", "ArrowLeft", {altKey: true}));
        expect([reload.prevented, copy.prevented, devtools.prevented, back.prevented]).toEqual([false, false, false, true]);
        expect(pressedKeys(events).slice(-4)).toEqual([Key.R, Key.C, Key.F12, Key.Left]);

        const keyUp = element.dispatch("keyup", new FakeKeyboardEvent(" ", "Space"));
        expect(keyUp.prevented).toBe(true);
    });

    test("a key-up releases the key its key-down pressed, even when the character changed in between", () => {
        const {element, events} = installed();
        element.dispatch("keydown", new FakeKeyboardEvent("1", "Digit1"));
        element.dispatch("keyup", new FakeKeyboardEvent("!", "Digit1", {shiftKey: true}));
        element.dispatch("keydown", new FakeKeyboardEvent("&", "Digit1"));
        element.dispatch("keyup", new FakeKeyboardEvent("1", "Digit1", {shiftKey: true}));
        expect(events.filter(event => event.type === "keyUp")).toEqual([
            {type: "keyUp", key: Key.Num1, ...NO_MODIFIERS, shift: true},
            {type: "keyUp", key: Key.Num7, ...NO_MODIFIERS, shift: true},
        ]);
    });

    test("two physical keys on one Key release it only when the last one goes up", () => {
        const {element, events} = installed();
        element.dispatch("keydown", new FakeKeyboardEvent("Shift", "ShiftLeft", {shiftKey: true}));
        element.dispatch("keydown", new FakeKeyboardEvent("Shift", "ShiftRight", {shiftKey: true}));
        element.dispatch("keyup", new FakeKeyboardEvent("Shift", "ShiftLeft", {shiftKey: true}));
        expect(events.filter(event => event.type === "keyUp")).toEqual([]);
        element.dispatch("keyup", new FakeKeyboardEvent("Shift", "ShiftRight"));
        expect(events.filter(event => event.type === "keyUp")).toEqual([{type: "keyUp", key: Key.Shift, ...NO_MODIFIERS}]);
    });

    test("a key-up without its key-down maps from its own key; an unknown one is ignored", () => {
        const {element, events} = installed();
        element.dispatch("keyup", new FakeKeyboardEvent("w", "KeyW"));
        const unknown = element.dispatch("keyup", new FakeKeyboardEvent("Unidentified", ""));
        expect(events).toEqual([{type: "keyUp", key: Key.W, ...NO_MODIFIERS}]);
        expect(unknown.stopped).toBe(false);
    });
});

describe("installDomInput pointer", () => {
    test("pixels become fractional 0-based cells of the cell area", () => {
        const {element, events} = installed();
        const down = element.dispatch("pointerdown", new FakePointerEvent(PointerButton.Left, 15, 70));
        element.dispatch("pointermove", new FakePointerEvent(-1, 410, 220));
        element.dispatch("pointerup", new FakePointerEvent(PointerButton.Right, 810, 420));
        expect(events).toEqual([
            {type: "pointerDown", button: PointerButton.Left, x: 0.5, y: 2.5, ...NO_MODIFIERS},
            {type: "pointerMove", x: 40, y: 10, ...NO_MODIFIERS},
            {type: "pointerUp", button: PointerButton.Right, x: 80, y: 20, ...NO_MODIFIERS},
        ]);
        expect([down.prevented, down.stopped]).toEqual([true, true]);
        expect(element.captures).toEqual([POINTER_ID]);
    });

    test("buttons other than left, middle and right are left alone", () => {
        const {element, events} = installed();
        const back = element.dispatch("pointerdown", new FakePointerEvent(DOM_BACK_BUTTON, 15, 70));
        expect(events).toEqual([]);
        expect([back.prevented, back.stopped]).toEqual([false, false]);
        expect(element.captures).toEqual([]);
    });

    test("an area with no size puts the pointer at cell 0 instead of dividing by zero", () => {
        const {element, events} = installed({...AREA, width: 0, height: 0});
        element.dispatch("pointermove", new FakePointerEvent(-1, 300, 300));
        expect(events).toEqual([{type: "pointerMove", x: 0, y: 0, ...NO_MODIFIERS}]);
    });

    test("a cancelled pointer releases the buttons it held", () => {
        const {element, events} = installed();
        element.dispatch("pointerdown", new FakePointerEvent(PointerButton.Middle, 10, 20));
        element.dispatch("pointercancel", new FakePointerEvent(-1, 10, 20));
        element.dispatch("pointercancel", new FakePointerEvent(-1, 10, 20));
        expect(events.slice(1)).toEqual([{type: "pointerUp", button: PointerButton.Middle, x: 0, y: 0, ...NO_MODIFIERS}]);
    });

    test("wheel deltas become notches, positive away from the user, whatever the delta mode", () => {
        const {element, events} = installed();
        const scrolled = element.dispatch("wheel", new FakeWheelEvent(100));
        element.dispatch("wheel", new FakeWheelEvent(-50));
        element.dispatch("wheel", new FakeWheelEvent(3, DOM_DELTA_LINE));
        element.dispatch("wheel", new FakeWheelEvent(-1, DOM_DELTA_PAGE));
        const sideways = element.dispatch("wheel", new FakeWheelEvent(0));
        expect(events.map(event => event.type === "wheel" ? event.delta : undefined)).toEqual([-1, 0.5, -1, 1]);
        expect([scrolled.prevented, sideways.prevented]).toEqual([true, false]);
    });
});

describe("installDomInput focus", () => {
    test("focus moving in and out of the element becomes focus events", () => {
        const {element, events} = installed();
        element.dispatch("focusout", {});
        element.dispatch("focusin", {});
        expect(events).toEqual([{type: "focus", focused: false}, {type: "focus", focused: true}]);
    });

    test("losing focus forgets which physical key pressed what", () => {
        const {element, events} = installed();
        element.dispatch("keydown", new FakeKeyboardEvent("&", "Digit1"));
        element.dispatch("focusout", {});
        element.dispatch("keyup", new FakeKeyboardEvent("1", "Digit1"));
        expect(events.slice(2)).toEqual([{type: "focus", focused: false}, {type: "keyUp", key: Key.Num1, ...NO_MODIFIERS}]);
    });
});
