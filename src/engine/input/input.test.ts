import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {World} from "../core/world";
import {DebugWorld} from "../core/debugWorld";
import {System} from "../core/system";
import {GcSystem} from "../core/gcSystem";
import {RootSystemGroup} from "../core/rootSystemGroup";
import {Input} from "./input";
import {InputSystem} from "./inputSystem";
import {Key, keyForCharacter} from "./key";
import {PointerButton} from "./pointerButton";
import {isInputEvent, NO_MODIFIERS} from "./inputEvent";
import type {InputEvent, KeyDownEvent, KeyUpEvent, PointerDownEvent, PointerUpEvent} from "./inputEvent";

const NOT_REPEATED = false;
const REPEATED = true;

function keyDown(key: Key, repeat: boolean = NOT_REPEATED): KeyDownEvent {
    return {type: "keyDown", key, repeat, ...NO_MODIFIERS};
}

function keyUp(key: Key): KeyUpEvent {
    return {type: "keyUp", key, ...NO_MODIFIERS};
}

function pointerDown(button: PointerButton, x: number, y: number): PointerDownEvent {
    return {type: "pointerDown", button, x, y, ...NO_MODIFIERS};
}

function pointerUp(button: PointerButton, x: number, y: number): PointerUpEvent {
    return {type: "pointerUp", button, x, y, ...NO_MODIFIERS};
}

function frame(input: Input, ...events: InputEvent[]): readonly InputEvent[] {
    for (const event of events) input.enqueue(event);
    input.beginFrame();
    return input.events;
}

describe("Input frames", () => {
    test("queued events wait for the next frame and are applied in order", () => {
        const input = new Input();
        input.enqueue(keyDown(Key.A));
        input.enqueue({type: "text", text: "a"});
        expect(input.keyHeld(Key.A)).toBe(false);
        expect(input.events).toEqual([]);

        input.beginFrame();
        expect(input.events).toEqual([keyDown(Key.A), {type: "text", text: "a"}]);
        expect(input.keyHeld(Key.A)).toBe(true);
    });

    test("pressed and released are true for exactly one frame, held in between", () => {
        const input = new Input();
        frame(input, keyDown(Key.Space));
        expect([input.keyPressed(Key.Space), input.keyHeld(Key.Space), input.keyReleased(Key.Space)]).toEqual([true, true, false]);
        frame(input);
        expect([input.keyPressed(Key.Space), input.keyHeld(Key.Space), input.events.length]).toEqual([false, true, 0]);
        frame(input, keyUp(Key.Space));
        expect([input.keyPressed(Key.Space), input.keyHeld(Key.Space), input.keyReleased(Key.Space)]).toEqual([false, false, true]);
        frame(input);
        expect(input.keyReleased(Key.Space)).toBe(false);
    });

    test("a press and release inside one frame is pressed and released but not held", () => {
        const input = new Input();
        frame(input, keyDown(Key.Q), keyUp(Key.Q));
        expect([input.keyPressed(Key.Q), input.keyReleased(Key.Q), input.keyHeld(Key.Q)]).toEqual([true, true, false]);
    });

    test("repeat follows the held state, whatever the host said", () => {
        const input = new Input();
        const events = frame(input, keyDown(Key.W, REPEATED), keyDown(Key.W, NOT_REPEATED), keyDown(Key.W, REPEATED));
        expect(events.map(event => (event as KeyDownEvent).repeat)).toEqual([false, true, true]);
        expect(input.keyPressed(Key.W)).toBe(true);
    });

    test("a key-up for a key that is not held is dropped", () => {
        const input = new Input();
        expect(frame(input, keyUp(Key.E))).toEqual([]);
        expect(input.keyReleased(Key.E)).toBe(false);
    });

    test("events enqueued while a frame is applied wait for the next one", () => {
        const input = new Input();
        frame(input, keyDown(Key.A));
        input.enqueue(keyUp(Key.A));
        expect(input.keyHeld(Key.A)).toBe(true);
        frame(input);
        expect(input.keyHeld(Key.A)).toBe(false);
    });
});

describe("Input pointer", () => {
    test("position follows every pointer event, buttons keep held/pressed/released per frame", () => {
        const input = new Input();
        frame(input, pointerDown(PointerButton.Left, 3, 4));
        expect([input.pointerX, input.pointerY]).toEqual([3, 4]);
        expect([input.buttonPressed(PointerButton.Left), input.buttonHeld(PointerButton.Left)]).toEqual([true, true]);
        expect(input.buttonHeld(PointerButton.Right)).toBe(false);

        frame(input, {type: "pointerMove", x: 5.5, y: 6.25, ...NO_MODIFIERS});
        expect([input.pointerX, input.pointerY, input.buttonPressed(PointerButton.Left)]).toEqual([5.5, 6.25, false]);

        frame(input, pointerUp(PointerButton.Left, 7, 8));
        expect([input.buttonReleased(PointerButton.Left), input.buttonHeld(PointerButton.Left)]).toEqual([true, false]);
        expect([input.pointerX, input.pointerY]).toEqual([7, 8]);
    });

    test("a second down for a held button and an up for a free one are dropped, the position still moves", () => {
        const input = new Input();
        frame(input, pointerDown(PointerButton.Middle, 1, 1));
        expect(frame(input, pointerDown(PointerButton.Middle, 2, 2), pointerUp(PointerButton.Right, 3, 3))).toEqual([]);
        expect([input.pointerX, input.pointerY]).toEqual([3, 3]);
        expect(input.buttonPressed(PointerButton.Middle)).toBe(false);
    });

    test("wheel deltas add up within a frame and reset on the next", () => {
        const input = new Input();
        const wheel = (delta: number): InputEvent => ({type: "wheel", delta, x: 2, y: 9, ...NO_MODIFIERS});
        frame(input, wheel(1), wheel(1), wheel(-0.5));
        expect(input.wheelDelta).toBe(1.5);
        expect([input.pointerX, input.pointerY]).toEqual([2, 9]);
        frame(input);
        expect(input.wheelDelta).toBe(0);
    });
});

describe("Input focus", () => {
    test("losing focus releases every held key and button with events, then reports the loss", () => {
        const input = new Input();
        frame(input, keyDown(Key.W), keyDown(Key.Shift), pointerDown(PointerButton.Right, 4, 5));
        expect(input.focused).toBe(true);

        const events = frame(input, {type: "focus", focused: false});
        expect(events).toEqual([
            keyUp(Key.W),
            keyUp(Key.Shift),
            pointerUp(PointerButton.Right, 4, 5),
            {type: "focus", focused: false},
        ]);
        expect(input.focused).toBe(false);
        expect([input.keyHeld(Key.W), input.keyReleased(Key.W), input.buttonReleased(PointerButton.Right)]).toEqual([false, true, true]);

        expect(frame(input, keyUp(Key.W))).toEqual([]);
    });

    test("a repeated focus change is dropped; regaining focus releases nothing", () => {
        const input = new Input();
        expect(frame(input, {type: "focus", focused: true})).toEqual([]);
        frame(input, {type: "focus", focused: false});
        frame(input, keyDown(Key.A));
        expect(frame(input, {type: "focus", focused: true})).toEqual([{type: "focus", focused: true}]);
        expect(input.keyHeld(Key.A)).toBe(true);
    });

    test("a key autorepeating after focus returns counts as a fresh press", () => {
        const input = new Input();
        frame(input, keyDown(Key.D), {type: "focus", focused: false});
        const events = frame(input, {type: "focus", focused: true}, keyDown(Key.D, REPEATED));
        expect((events[1] as KeyDownEvent).repeat).toBe(false);
        expect(input.keyPressed(Key.D)).toBe(true);
    });
});

describe("Input actions", () => {
    test("an action is held, pressed and released through any of its keys", () => {
        const input = new Input();
        input.bindAction("jump", [Key.Space, Key.W]);
        frame(input, keyDown(Key.W));
        expect([input.actionPressed("jump"), input.actionHeld("jump"), input.actionReleased("jump")]).toEqual([true, true, false]);
        frame(input);
        expect([input.actionPressed("jump"), input.actionHeld("jump")]).toEqual([false, true]);
        frame(input, keyUp(Key.W));
        expect([input.actionReleased("jump"), input.actionHeld("jump")]).toEqual([true, false]);
    });

    test("a second key of a held action neither presses it again nor releases it early", () => {
        const input = new Input();
        input.bindActions({jump: [Key.Space, Key.W]});
        frame(input, keyDown(Key.Space));
        frame(input, keyDown(Key.W));
        expect(input.actionPressed("jump")).toBe(false);
        frame(input, keyUp(Key.Space));
        expect([input.actionReleased("jump"), input.actionHeld("jump")]).toEqual([false, true]);
        frame(input, keyUp(Key.W));
        expect(input.actionReleased("jump")).toBe(true);
    });

    test("a tap inside one frame presses and releases the action", () => {
        const input = new Input();
        input.bindAction("fire", [Key.F]);
        frame(input, keyDown(Key.F), keyUp(Key.F));
        expect([input.actionPressed("fire"), input.actionReleased("fire"), input.actionHeld("fire")]).toEqual([true, true, false]);
    });

    test("a key repeat does not press an action again", () => {
        const input = new Input();
        input.bindAction("fire", [Key.F]);
        frame(input, keyDown(Key.F));
        frame(input, keyDown(Key.F, REPEATED));
        expect(input.actionPressed("fire")).toBe(false);
    });

    test("one key may drive several actions; rebinding takes effect on the held state at once", () => {
        const input = new Input();
        input.bindActions({left: [Key.A, Key.Left], strafe: [Key.A]});
        frame(input, keyDown(Key.A));
        expect([input.actionPressed("left"), input.actionPressed("strafe")]).toEqual([true, true]);
        input.bindAction("strafe", [Key.D]);
        expect(input.actionHeld("strafe")).toBe(false);
    });

    test("losing focus releases actions", () => {
        const input = new Input();
        input.bindAction("jump", [Key.Space]);
        frame(input, keyDown(Key.Space));
        frame(input, {type: "focus", focused: false});
        expect([input.actionReleased("jump"), input.actionHeld("jump")]).toEqual([true, false]);
    });

    test("an unbound action name throws instead of reading as never pressed", () => {
        const input = new Input();
        expect(() => input.actionPressed("jmup")).toThrow("No input action named \"jmup\"");
        input.bindAction("jump", [Key.Space]);
        input.unbindAction("jump");
        expect(() => input.actionHeld("jump")).toThrow("No input action named");
    });
});

class EventProbeSystem extends System {
    public seen: InputEvent[][] = [];

    onUpdate(): void {
        this.seen.push([...this.world.resources.getOrCreate(Input).events]);
    }
}

describe("InputSystem", () => {
    test("runs first in the root group, so a system of any priority sees this frame's events", () => {
        const world = new World({platform: new MemoryPlatform()});
        const probe = world.getOrCreateSystem(EventProbeSystem);
        const root = world.getOrCreateSystem(RootSystemGroup);
        expect(root.systems[0]).toBeInstanceOf(InputSystem);

        const input = world.resources.getOrCreate(Input);
        input.enqueue(keyDown(Key.A));
        root.update();
        root.update();
        expect(probe.seen).toEqual([[keyDown(Key.A)], []]);
    });

    test("a DebugWorld keeps both default systems in its rebuilt root group", () => {
        const world = new DebugWorld({platform: new MemoryPlatform()});
        const root = world.getOrCreateSystem(RootSystemGroup);
        expect(root.systems.some(system => system instanceof InputSystem)).toBe(true);
        expect(root.systems.some(system => system instanceof GcSystem)).toBe(true);
        expect(root.systems.includes(world.tryGetSystem(GcSystem)!)).toBe(true);
    });
});

describe("keyForCharacter", () => {
    test("letters, digits and punctuation type their own key; shifted US symbols name their base key", () => {
        expect(keyForCharacter("a")).toEqual({key: Key.A, shift: false});
        expect(keyForCharacter("A")).toEqual({key: Key.A, shift: true});
        expect(keyForCharacter("7")).toEqual({key: Key.Num7, shift: false});
        expect(keyForCharacter(" ")).toEqual({key: Key.Space, shift: false});
        expect(keyForCharacter("[")).toEqual({key: Key.BracketLeft, shift: false});
        expect(keyForCharacter("{")).toEqual({key: Key.BracketLeft, shift: true});
        expect(keyForCharacter("_")).toEqual({key: Key.Minus, shift: true});
        expect(keyForCharacter("!")).toEqual({key: Key.Num1, shift: true});
        expect(keyForCharacter("é")).toBeUndefined();
        expect(keyForCharacter("ab")).toBeUndefined();
    });
});

describe("isInputEvent", () => {
    test("accepts every event shape and rejects wrong fields", () => {
        const valid: InputEvent[] = [
            keyDown(Key.Up),
            keyUp(Key.Up),
            {type: "text", text: "x"},
            pointerDown(PointerButton.Left, 0.5, 2),
            pointerUp(PointerButton.Right, 0, 0),
            {type: "pointerMove", x: 1, y: 1, ...NO_MODIFIERS},
            {type: "wheel", delta: -1, x: 1, y: 1, ...NO_MODIFIERS},
            {type: "focus", focused: false},
        ];
        expect(valid.every(isInputEvent)).toBe(true);

        expect(isInputEvent({...keyDown(Key.Up), key: "hyper"})).toBe(false);
        expect(isInputEvent({type: "keyDown", key: Key.Up, ...NO_MODIFIERS})).toBe(false);
        expect(isInputEvent({...pointerDown(PointerButton.Left, 0, 0), button: 3})).toBe(false);
        expect(isInputEvent({type: "pointerMove", x: Number.NaN, y: 0, ...NO_MODIFIERS})).toBe(false);
        expect(isInputEvent({type: "wheel", delta: 1, x: 0, y: 0, ctrl: false})).toBe(false);
        expect(isInputEvent({type: "focus", focused: "yes"})).toBe(false);
        expect(isInputEvent({type: "toString"})).toBe(false);
        expect(isInputEvent(null)).toBe(false);
        expect(isInputEvent("keyDown")).toBe(false);
    });
});
