import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {World} from "../core/world";
import {Input} from "./input";
import {InputMap, inputMapOf, resolveInputActions} from "./inputMap";
import {Key} from "./key";
import {PointerButton} from "./pointerButton";
import {NO_MODIFIERS} from "./inputEvent";
import type {InputEvent, KeyDownEvent, KeyUpEvent, Modifiers, PointerDownEvent, PointerUpEvent} from "./inputEvent";

const NOT_REPEATED = false;
const REPEATED = true;
const CTRL: Modifiers = {...NO_MODIFIERS, ctrl: true};
const CTRL_SHIFT: Modifiers = {...NO_MODIFIERS, ctrl: true, shift: true};
const POINTER_X = 3;
const POINTER_Y = 4;
const QUIT_ACTIONS = {quit: "quit"} as const;
const MOVE_ACTIONS = {up: "moveUp", down: "moveDown"} as const;

function keyDown(key: Key, modifiers: Modifiers = NO_MODIFIERS, repeat: boolean = NOT_REPEATED): KeyDownEvent {
    return {type: "keyDown", key, repeat, ...modifiers};
}

function keyUp(key: Key, modifiers: Modifiers = NO_MODIFIERS): KeyUpEvent {
    return {type: "keyUp", key, ...modifiers};
}

function pointerDown(button: PointerButton): PointerDownEvent {
    return {type: "pointerDown", button, x: POINTER_X, y: POINTER_Y, ...NO_MODIFIERS};
}

function pointerUp(button: PointerButton): PointerUpEvent {
    return {type: "pointerUp", button, x: POINTER_X, y: POINTER_Y, ...NO_MODIFIERS};
}

function frame(input: Input, ...events: InputEvent[]): readonly InputEvent[] {
    for (const event of events) input.enqueue(event);
    input.beginFrame();
    return input.events;
}

function worldWithMap(map?: InputMap): World {
    const world = new World({platform: new MemoryPlatform()});
    if (map !== undefined) world.resources.insert(map);
    return world;
}

describe("resolveInputActions", () => {
    test("a world without an InputMap throws, naming the actions and the manifest entry that loads one", () => {
        expect(() => resolveInputActions(worldWithMap(), QUIT_ACTIONS))
            .toThrow("This world has no InputMap resource to resolve the input actions \"quit\" from: list {\"type\": \"InputMap\", \"path\": \"assets/input.asset.json\"}");
    });

    test("an action the map lacks throws, listing what it has", () => {
        const world = worldWithMap(inputMapOf({moveUp: {keys: [Key.W]}}));
        expect(() => resolveInputActions(world, MOVE_ACTIONS)).toThrow("The InputMap has no action named \"moveDown\"; add it to the input map (it has \"moveUp\")");
    });

    test("a map naming one action twice throws", () => {
        const map = inputMapOf({quit: {keys: [Key.Escape]}});
        map.actions.push(map.actions[0]);
        expect(() => resolveInputActions(worldWithMap(map), QUIT_ACTIONS)).toThrow("The InputMap lists the action \"quit\" more than once");
    });

    test("names resolve to the same handles every time and bind the world's Input to the map", () => {
        const world = worldWithMap(inputMapOf({moveUp: {keys: [Key.W]}, moveDown: {keys: [Key.S]}}));
        const first = resolveInputActions(world, MOVE_ACTIONS);
        const again = resolveInputActions(world, {down: "moveDown"});
        expect(again.down).toBe(first.down);
        const input = world.resources.get(Input);
        expect([input.actionName(first.up), input.actionName(first.down)]).toEqual(["moveUp", "moveDown"]);
        frame(input, keyDown(Key.S));
        expect([input.actionHeld(first.up), input.actionHeld(first.down)]).toEqual([false, true]);
    });

    test("a handle from another Input throws instead of reading another action", () => {
        const resolved = resolveInputActions(worldWithMap(inputMapOf({moveUp: {keys: [Key.W]}, moveDown: {keys: [Key.S]}})), MOVE_ACTIONS);
        const other = new Input();
        other.useInputMap(inputMapOf({moveUp: {keys: [Key.W]}}));
        other.action("moveUp");
        expect(() => other.actionHeld(resolved.down)).toThrow("Unknown input action");
    });
});

describe("Input action chords", () => {
    test("a chord presses its action on a key-down carrying its modifiers, and releases it with the key", () => {
        const input = new Input();
        input.useInputMap(inputMapOf({quit: {keys: [Key.Escape], chords: [{key: Key.C, ctrl: true}]}}));
        const quit = input.action("quit");
        frame(input, keyDown(Key.C));
        expect(input.actionPressed(quit)).toBe(false);
        frame(input, keyUp(Key.C));
        frame(input, keyDown(Key.C, CTRL_SHIFT));
        expect([input.actionPressed(quit), input.actionHeld(quit)]).toEqual([true, true]);
        frame(input, keyUp(Key.C));
        expect([input.actionReleased(quit), input.actionHeld(quit)]).toEqual([true, false]);
    });

    test("a repeat carrying the modifiers presses the chord of a key already held", () => {
        const input = new Input();
        input.useInputMap(inputMapOf({quit: {chords: [{key: Key.C, ctrl: true}]}}));
        const quit = input.action("quit");
        frame(input, keyDown(Key.C));
        frame(input, keyDown(Key.C, CTRL, REPEATED));
        expect(input.actionPressed(quit)).toBe(true);
    });

    test("a tap of the chord inside one frame presses and releases the action", () => {
        const input = new Input();
        input.useInputMap(inputMapOf({quit: {chords: [{key: Key.C, ctrl: true}]}}));
        const quit = input.action("quit");
        frame(input, keyDown(Key.C, CTRL), keyUp(Key.C, CTRL));
        expect([input.actionPressed(quit), input.actionReleased(quit), input.actionHeld(quit)]).toEqual([true, true, false]);
    });
});

describe("Input action buttons", () => {
    test("a pointer button holds, presses and releases its action", () => {
        const input = new Input();
        input.useInputMap(inputMapOf({look: {buttons: [PointerButton.Left]}}));
        const look = input.action("look");
        frame(input, pointerDown(PointerButton.Right));
        expect(input.actionHeld(look)).toBe(false);
        frame(input, pointerDown(PointerButton.Left));
        expect([input.actionPressed(look), input.actionHeld(look)]).toEqual([true, true]);
        frame(input, pointerUp(PointerButton.Left));
        expect([input.actionReleased(look), input.actionHeld(look)]).toEqual([true, false]);
    });

    test("losing focus releases a button action", () => {
        const input = new Input();
        input.useInputMap(inputMapOf({look: {buttons: [PointerButton.Left]}}));
        const look = input.action("look");
        frame(input, pointerDown(PointerButton.Left));
        frame(input, {type: "focus", focused: false});
        expect([input.actionReleased(look), input.actionHeld(look)]).toEqual([true, false]);
    });
});

describe("Input.isActionEvent", () => {
    test("matches key-downs including repeats, key-ups, chords with their modifiers and pointer buttons", () => {
        const input = new Input();
        input.useInputMap(inputMapOf({
            up: {keys: [Key.Up]},
            quit: {chords: [{key: Key.C, ctrl: true}]},
            look: {buttons: [PointerButton.Left]},
        }));
        const up = input.action("up"), quit = input.action("quit"), look = input.action("look");
        expect(input.isActionEvent(keyDown(Key.Up), up)).toBe(true);
        expect(input.isActionEvent(keyDown(Key.Up, CTRL, REPEATED), up)).toBe(true);
        expect(input.isActionEvent(keyUp(Key.Up), up)).toBe(true);
        expect(input.isActionEvent(keyDown(Key.Down), up)).toBe(false);
        expect(input.isActionEvent(keyDown(Key.C), quit)).toBe(false);
        expect(input.isActionEvent(keyDown(Key.C, CTRL), quit)).toBe(true);
        expect(input.isActionEvent(keyUp(Key.C), quit)).toBe(true);
        expect(input.isActionEvent(pointerDown(PointerButton.Left), look)).toBe(true);
        expect(input.isActionEvent(pointerUp(PointerButton.Left), look)).toBe(true);
        expect(input.isActionEvent(pointerDown(PointerButton.Right), look)).toBe(false);
        expect(input.isActionEvent({type: "pointerMove", x: POINTER_X, y: POINTER_Y, ...NO_MODIFIERS}, look)).toBe(false);
    });
});

describe("InputSystem and a changing InputMap", () => {
    test("replacing the map's actions, as a data asset reload does, rebinds by name before the frame's events", () => {
        const map = inputMapOf({moveUp: {keys: [Key.W]}, moveDown: {keys: [Key.S]}});
        const world = worldWithMap(map);
        const {up} = resolveInputActions(world, MOVE_ACTIONS);
        const input = world.resources.get(Input);
        map.actions = inputMapOf({moveDown: {keys: [Key.S]}, moveUp: {keys: [Key.Up]}}).actions;
        input.enqueue(keyDown(Key.Up));
        world.step();
        expect(input.actionPressed(up)).toBe(true);
    });

    test("a map that drops an action the game resolved stops the frame with the action's name", () => {
        const map = inputMapOf({moveUp: {keys: [Key.W]}, moveDown: {keys: [Key.S]}});
        const world = worldWithMap(map);
        resolveInputActions(world, MOVE_ACTIONS);
        map.actions = inputMapOf({moveUp: {keys: [Key.W]}}).actions;
        expect(() => world.step()).toThrow("The InputMap has no action named \"moveDown\"");
    });

    test("a world without an InputMap keeps raw keys working and resolves nothing", () => {
        const world = worldWithMap();
        const input = world.resources.getOrCreate(Input);
        input.enqueue(keyDown(Key.W));
        world.step();
        expect(input.keyPressed(Key.W)).toBe(true);
    });
});
