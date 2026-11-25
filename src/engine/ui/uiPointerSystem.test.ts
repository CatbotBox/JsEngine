import {beforeEach, describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {EntityQuery, World} from "../core";
import {RootSystemGroup} from "../core/rootSystemGroup";
import type {Component, Entity, EntityManager} from "../core";
import {Input} from "../input/input";
import {NO_MODIFIERS} from "../input/inputEvent";
import type {InputEvent} from "../input/inputEvent";
import {inputMapOf} from "../input/inputMap";
import {InputSystem} from "../input/inputSystem";
import {Key} from "../input/key";
import {PointerButton} from "../input/pointerButton";
import {Camera} from "../rendering/camera";
import {ScreenSize} from "../rendering/screenSize";
import {TextColor} from "../rendering/textColor";
import {Children} from "../translation/children";
import {Parent} from "../translation/parent";
import {UiBox} from "./uiBox";
import {UiEvents} from "./uiEvents";
import type {UiEvent} from "./uiEvents";
import {UiInputSystemGroup} from "./uiInputSystemGroup";
import {UiInteractable} from "./uiInteractable";
import {UiLayout} from "./uiLayout";
import {UiOffset} from "./uiOffset";
import {POINTER_NODE_ACCEPTS_PRESS, POINTER_NODE_DECLARES_DRAG, POINTER_NODE_DECLARES_PRESS} from "./uiPointerNodes";
import {DOUBLE_CLICK_MAX_INTERVAL_MS, UiPointerSystem} from "./uiPointerSystem";
import {UiRoot} from "./uiRoot";
import {UiScroll} from "./uiScroll";
import {UiSize} from "./uiSize";
import {UI_POINTER_STATE_BITS, UI_STATE_DISABLED, UI_STATE_HOVERED, UI_STATE_PRESSED, UiState} from "./uiState";
import {UI_INPUT_PRIORITY} from "./uiSystemPriorities";
import {UiText} from "./uiText";

const SCREEN_WIDTH = 40;
const SCREEN_HEIGHT = 12;
const DOUBLE_SCALE = 2;
const FAR_FROM_UI = 30;
const PAST_DOUBLE_CLICK_MS = DOUBLE_CLICK_MAX_INTERVAL_MS + 1;
const NOTCH = 1;

interface Interest {
    readonly click?: boolean;
    readonly press?: boolean;
    readonly drag?: boolean;
    readonly wheel?: boolean;
    readonly disabled?: boolean;
}

interface Placement {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

function component<T extends Component>(entityManager: EntityManager, entity: Entity, ctor: new () => T): T {
    const found = entityManager.getComponent<T>(entity, ctor);
    if (found === undefined) throw new Error(`entity ${entity} has no ${ctor.name}`);
    return found;
}

function attach(entityManager: EntityManager, parent: Entity, children: readonly Entity[]): void {
    const ordered = new Children(...children);
    if (entityManager.hasComponent(parent, Children)) entityManager.setComponent(parent, ordered);
    else entityManager.addComponent(parent, ordered);
    for (const child of children) entityManager.addComponent(child, new Parent(parent));
}

function interactable(interest: Interest): UiInteractable {
    const component = new UiInteractable();
    component.click = interest.click ?? false;
    component.press = interest.press ?? false;
    component.drag = interest.drag ?? false;
    component.wheel = interest.wheel ?? false;
    component.disabled = interest.disabled ?? false;
    return component;
}

function placed({x, y, width, height}: Placement): Component[] {
    const offset = new UiOffset();
    offset.x = x;
    offset.y = y;
    const size = new UiSize();
    size.widthMode = "fixed";
    size.width = width;
    size.heightMode = "fixed";
    size.height = height;
    return [offset, size];
}

function filled(background: TextColor = TextColor.BLUE): UiBox {
    const box = new UiBox();
    box.background = background;
    return box;
}

function padded(): UiLayout {
    const layout = new UiLayout();
    layout.paddingLeft = 1;
    layout.paddingTop = 1;
    layout.align = "start";
    return layout;
}

function label(value: string): UiText {
    const text = new UiText();
    text.text = value;
    return text;
}

function move(x: number, y: number): InputEvent {
    return {type: "pointerMove", x, y, ...NO_MODIFIERS};
}

function down(x: number, y: number, button: PointerButton = PointerButton.Left): InputEvent {
    return {type: "pointerDown", button, x, y, ...NO_MODIFIERS};
}

function up(x: number, y: number, button: PointerButton = PointerButton.Left): InputEvent {
    return {type: "pointerUp", button, x, y, ...NO_MODIFIERS};
}

function wheel(x: number, y: number, delta: number): InputEvent {
    return {type: "wheel", delta, x, y, ...NO_MODIFIERS};
}

describe("UiPointerSystem", () => {
    let world: World;
    let entityManager: EntityManager;
    let input: Input;
    let root: Entity;
    const names = new Map<Entity, string>();

    function named(name: string, components: readonly Component[]): Entity {
        const entity = entityManager.createEntity(name, components);
        names.set(entity, name);
        return entity;
    }

    function nameOf(entity: Entity): string {
        return names.get(entity) ?? `#${entity}`;
    }

    function uiEvents(): readonly UiEvent[] {
        return world.resources.get(UiEvents).events;
    }

    function frame(...events: InputEvent[]): string[] {
        for (const event of events) input.enqueue(event);
        world.step();
        return uiEvents().map(event => `${event.type} ${nameOf(event.target)}`);
    }

    function stateOf(entity: Entity): {hovered: boolean, pressed: boolean, disabled: boolean} {
        const state = component(entityManager, entity, UiState);
        return {hovered: state.hovered, pressed: state.pressed, disabled: state.disabled};
    }

    function rootWith(name: string, settings: Partial<Pick<UiRoot, "scale" | "sortOrder" | "blocksGameInput">>, children: readonly Entity[]): Entity {
        const uiRoot = new UiRoot();
        uiRoot.scale = settings.scale ?? uiRoot.scale;
        uiRoot.sortOrder = settings.sortOrder ?? uiRoot.sortOrder;
        uiRoot.blocksGameInput = settings.blocksGameInput ?? uiRoot.blocksGameInput;
        const entity = named(name, [uiRoot, new UiLayout()]);
        attach(entityManager, entity, children);
        return entity;
    }

    function button(name: string, placement: Placement, interest: Interest = {click: true}, children: readonly Entity[] = []): Entity {
        const entity = named(name, [...placed(placement), filled(), interactable(interest), padded()]);
        if (children.length > 0) attach(entityManager, entity, children);
        return entity;
    }

    function settle(): void {
        world.step();
    }

    beforeEach(() => {
        names.clear();
        world = new World({platform: new MemoryPlatform()});
        world.getOrCreateSystem(UiPointerSystem);
        entityManager = world.entityManager;
        input = world.resources.getOrCreate(Input);
        const camera = entityManager.createEntity("camera", [new Camera()]);
        const screenSize = component(entityManager, camera, ScreenSize);
        screenSize.x = SCREEN_WIDTH;
        screenSize.y = SCREEN_HEIGHT;
    });

    test("the UI input group runs right after InputSystem, before any game system", () => {
        const systems = world.getOrCreateSystem(RootSystemGroup).systems;
        expect(systems[0]).toBeInstanceOf(InputSystem);
        expect(systems[1]).toBeInstanceOf(UiInputSystemGroup);
        expect(UI_INPUT_PRIORITY).toBe(-Number.MAX_VALUE);
    });

    test("the combined flag constants, written as literals so bundles can drop their modules, are the unions they name", () => {
        expect(UI_POINTER_STATE_BITS).toBe(UI_STATE_HOVERED | UI_STATE_PRESSED | UI_STATE_DISABLED);
        expect(POINTER_NODE_ACCEPTS_PRESS).toBe(POINTER_NODE_DECLARES_PRESS | POINTER_NODE_DECLARES_DRAG);
    });

    test("the deepest drawn node under the pointer is the origin, and a click bubbles to the nearest clickable ancestor", () => {
        const ok = named("okLabel", [label("OK")]);
        const okButton = button("ok", {x: 2, y: 2, width: 10, height: 3}, {click: true}, [ok]);
        root = rootWith("root", {}, [okButton]);
        settle();
        expect(frame(down(3, 3), up(3, 3))).toEqual(["pointerEnter ok", "click ok"]);
        const click = uiEvents()[1];
        expect([nameOf(click.origin), click.x, click.y]).toEqual(["okLabel", 3, 3]);
        expect(frame(down(5, 4), up(5, 4)).at(-1)).toBe("click ok");
        expect(nameOf(uiEvents().at(-1)!.origin)).toBe("ok");
    });

    test("a node's clip rect bounds where it can be hit", () => {
        const layout = new UiLayout();
        layout.clip = true;
        layout.align = "start";
        const wide = button("wide", {x: 0, y: 0, width: 12, height: 1});
        const clipper = named("clipper", [layout, ...placed({x: 0, y: 0, width: 6, height: 3})]);
        attach(entityManager, clipper, [wide]);
        root = rootWith("root", {}, [clipper]);
        settle();
        expect(frame(down(8, 0), up(8, 0))).toEqual([]);
        expect(frame(down(5, 0), up(5, 0))).toEqual(["pointerEnter wide", "click wide"]);
    });

    test("roots hit in reverse sort order and their undrawn areas let the pointer through to the roots below", () => {
        const front = button("front", {x: 5, y: 0, width: 10, height: 3});
        rootWith("frontRoot", {sortOrder: 1}, [front]);
        const back = button("back", {x: 0, y: 0, width: 10, height: 3});
        rootWith("backRoot", {sortOrder: 0}, [back]);
        settle();
        expect(frame(down(6, 1), up(6, 1))).toEqual(["pointerEnter front", "click front"]);
        expect(frame(down(2, 1), up(2, 1))).toEqual(["pointerLeave front", "pointerEnter back", "click back"]);
    });

    test("each event goes to the nearest ancestor of the origin that declared interest in it", () => {
        const text = named("text", [label("go")]);
        const inner = button("inner", {x: 1, y: 1, width: 6, height: 3}, {press: true}, [text]);
        const card = button("card", {x: 0, y: 0, width: 20, height: 8}, {click: true}, [inner]);
        root = rootWith("root", {}, [card]);
        settle();
        expect(frame(down(3, 3), up(3, 3))).toEqual(["pointerEnter card", "pointerEnter inner", "press inner", "release inner", "click card"]);
        const press = uiEvents()[2];
        expect([nameOf(press.target), nameOf(press.origin)]).toEqual(["inner", "text"]);
    });

    test("pointerEnter and pointerLeave follow the hover path, and hovered marks every node on it", () => {
        const aLabel = named("aLabel", [label("a")]);
        const a = button("a", {x: 0, y: 0, width: 5, height: 3}, {click: true}, [aLabel]);
        const b = button("b", {x: 6, y: 0, width: 5, height: 3});
        root = rootWith("root", {}, [a, b]);
        settle();
        expect(frame(move(1, 1))).toEqual(["pointerEnter a"]);
        expect([stateOf(aLabel).hovered, stateOf(a).hovered, stateOf(root).hovered, stateOf(b).hovered]).toEqual([true, true, true, false]);
        expect(frame(move(0, 0))).toEqual([]);
        expect(stateOf(aLabel).hovered).toBe(false);
        expect(frame(move(7, 1))).toEqual(["pointerLeave a", "pointerEnter b"]);
        expect(frame(move(FAR_FROM_UI, 1))).toEqual(["pointerLeave b"]);
        expect([stateOf(a).hovered, stateOf(b).hovered, stateOf(root).hovered]).toEqual([false, false, false]);
    });

    test("a press and a release over different targets is no click; the press target still gets its release", () => {
        const a = button("a", {x: 0, y: 0, width: 5, height: 3}, {press: true, click: true});
        const b = button("b", {x: 6, y: 0, width: 5, height: 3}, {press: true, click: true});
        root = rootWith("root", {}, [a, b]);
        settle();
        expect(frame(down(1, 1))).toEqual(["pointerEnter a", "press a"]);
        expect([stateOf(a).pressed, stateOf(root).pressed, stateOf(b).pressed]).toEqual([true, true, false]);
        expect(frame(move(7, 1), up(7, 1))).toEqual(["pointerLeave a", "pointerEnter b", "release a"]);
        expect(nameOf(uiEvents()[2].origin)).toBe("b");
        expect([stateOf(a).pressed, stateOf(root).pressed]).toEqual([false, false]);
    });

    test("a second click on the same target soon enough and near enough is a double click", () => {
        const target = button("target", {x: 0, y: 0, width: 10, height: 3});
        root = rootWith("root", {}, [target]);
        settle();
        expect(frame(down(1, 1), up(1, 1))).toEqual(["pointerEnter target", "click target"]);
        expect(frame(down(1, 1), up(1, 1))).toEqual(["click target", "doubleClick target"]);
        expect(frame(down(1, 1), up(1, 1))).toEqual(["click target"]);
        world.step(PAST_DOUBLE_CLICK_MS);
        expect(frame(down(1, 1), up(1, 1))).toEqual(["click target"]);
        expect(frame(down(3, 1), up(3, 1))).toEqual(["click target"]);
        expect(frame(down(3, 1, PointerButton.Right), up(3, 1, PointerButton.Right))).toEqual(["click target"]);
        expect(world.resources.get(UiEvents).clicked(target)).toBe(false);
        expect(world.resources.get(UiEvents).clicked(target, PointerButton.Right)).toBe(true);
    });

    test("a drag target keeps the pointer until release, outside itself and outside every root", () => {
        const slider = button("slider", {x: 0, y: 0, width: 4, height: 1}, {drag: true, click: true});
        root = rootWith("root", {}, [slider]);
        settle();
        expect(frame(down(1, 0))).toEqual(["pointerEnter slider", "press slider"]);
        expect(frame(move(20, 5))).toEqual(["pointerLeave slider", "drag slider"]);
        const drag = world.resources.get(UiEvents).of("drag")[0];
        expect([drag.dx, drag.dy, drag.x, drag.y, drag.origin]).toEqual([19, 5, 20, 5, 0]);
        expect(input.buttonHeld(PointerButton.Left)).toBe(false);
        expect(frame(move(22, 6), up(22, 6))).toEqual(["drag slider", "release slider"]);
        expect(input.buttonReleased(PointerButton.Left)).toBe(false);
        expect(frame(down(22, 6))).toEqual([]);
        expect(input.buttonPressed(PointerButton.Left)).toBe(true);
    });

    test("disabled interactables get nothing, show as disabled and swallow the events they declare", () => {
        const off = button("off", {x: 1, y: 1, width: 5, height: 2}, {click: true, disabled: true});
        const card = button("card", {x: 0, y: 0, width: 20, height: 6}, {click: true, wheel: true}, [off]);
        root = rootWith("root", {}, [card]);
        settle();
        expect(frame(down(3, 2), up(3, 2))).toEqual(["pointerEnter card"]);
        expect(stateOf(off)).toEqual({hovered: true, pressed: false, disabled: true});
        expect(frame(wheel(3, 2, NOTCH))).toEqual(["wheel card"]);
        expect(input.pointerClaimed).toBe(true);
        component(entityManager, off, UiInteractable).disabled = false;
        expect(frame()).toEqual(["pointerEnter off"]);
        expect(frame(down(3, 2), up(3, 2))).toEqual(["click off"]);
        expect(stateOf(off).disabled).toBe(false);
        component(entityManager, off, UiInteractable).disabled = true;
        expect(frame()).toEqual(["pointerLeave off"]);
        expect(stateOf(off).disabled).toBe(true);
    });

    test("a captured target destroyed mid-drag gets nothing more, and the UI keeps the pointer until the button is up", () => {
        const slider = button("slider", {x: 0, y: 0, width: 4, height: 1}, {drag: true});
        root = rootWith("root", {}, [slider]);
        settle();
        frame(down(1, 0));
        entityManager.destroyEntity(slider);
        expect(frame(move(10, 3))).toEqual([]);
        expect([input.pointerClaimed, input.buttonHeld(PointerButton.Left)]).toEqual([true, false]);
        expect(frame(up(12, 3))).toEqual([]);
        expect([input.pointerClaimed, input.buttonReleased(PointerButton.Left)]).toEqual([true, false]);
        expect(frame(down(12, 3))).toEqual([]);
        expect(input.pointerClaimed).toBe(false);
    });

    test("losing focus releases the press target without a click", () => {
        const target = button("target", {x: 0, y: 0, width: 10, height: 3}, {press: true, click: true});
        root = rootWith("root", {}, [target]);
        settle();
        frame(down(1, 1));
        expect(frame({type: "focus", focused: false})).toEqual(["release target"]);
        expect(frame(down(1, 1), up(1, 1))).toEqual(["press target", "release target", "click target"]);
    });

    test("the wheel goes to the nearest scroll region, and the game sees none of it", () => {
        const item = named("item", [label("item")]);
        const list = named("list", [new UiScroll(), ...placed({x: 0, y: 0, width: 10, height: 4})]);
        attach(entityManager, list, [item]);
        root = rootWith("root", {}, [list]);
        settle();
        expect(frame(wheel(1, 0, -NOTCH))).toEqual(["wheel list"]);
        const event = world.resources.get(UiEvents).of("wheel")[0];
        expect([event.delta, nameOf(event.origin)]).toEqual([-NOTCH, "item"]);
        expect(input.wheelDelta).toBe(0);
        expect(frame(wheel(FAR_FROM_UI, 0, NOTCH))).toEqual([]);
        expect(input.wheelDelta).toBe(NOTCH);
    });

    test("positions are in the target root's UI units and hits snap to the root's units", () => {
        const target = button("target", {x: 2, y: 1, width: 4, height: 2}, {click: true, drag: true});
        root = rootWith("root", {scale: DOUBLE_SCALE}, [target]);
        settle();
        expect(frame(down(3.9, 3), up(3.9, 3))).toEqual([]);
        expect(frame(down(5, 3))).toEqual(["pointerEnter target", "press target"]);
        expect([uiEvents()[1].x, uiEvents()[1].y]).toEqual([2.5, 1.5]);
        frame(move(9, 4));
        const drag = world.resources.get(UiEvents).of("drag")[0];
        expect([drag.dx, drag.dy, drag.x, drag.y]).toEqual([2, 0.5, 4.5, 2]);
    });

    test("UiState is written only when a bit changes", () => {
        const target = button("target", {x: 0, y: 0, width: 10, height: 3});
        root = rootWith("root", {}, [target]);
        settle();
        frame(move(1, 1));
        const states = new EntityQuery(world, [UiState]);
        const mark = world.changeStamps.advance();
        frame(move(2, 1));
        world.step();
        expect(states.stream({read: {state: UiState}}, {filterLastUpdated: mark}).hasAny()).toBe(false);
        frame(move(FAR_FROM_UI, 1));
        expect(states.stream({read: {state: UiState}}, {filterLastUpdated: mark}).hasAny()).toBe(true);
    });

    test("a node that appears under a still pointer is entered without the pointer moving", () => {
        root = rootWith("root", {}, []);
        settle();
        expect(frame(move(1, 1))).toEqual([]);
        attach(entityManager, root, [button("late", {x: 0, y: 0, width: 5, height: 3})]);
        settle();
        expect(frame()).toEqual(["pointerEnter late"]);
    });

    test("within lists the events aimed at a node or its subtree", () => {
        const a = button("a", {x: 0, y: 0, width: 5, height: 3});
        const panel = named("panel", [new UiLayout()]);
        attach(entityManager, panel, [a]);
        const b = button("b", {x: 6, y: 0, width: 5, height: 3});
        root = rootWith("root", {}, [panel, b]);
        settle();
        frame(down(1, 1), up(1, 1));
        const events = world.resources.get(UiEvents);
        expect(events.within(panel).map(event => `${event.type} ${nameOf(event.target)}`)).toEqual(["pointerEnter a", "click a"]);
        expect(events.within(b)).toEqual([]);
        expect(events.of("click").map(event => nameOf(event.target))).toEqual(["a"]);
    });
});

describe("UiPointerSystem and the Input claim", () => {
    let world: World;
    let entityManager: EntityManager;
    let input: Input;

    function frame(...events: InputEvent[]): void {
        for (const event of events) input.enqueue(event);
        world.step();
    }

    beforeEach(() => {
        world = new World({platform: new MemoryPlatform()});
        world.getOrCreateSystem(UiPointerSystem);
        entityManager = world.entityManager;
        input = world.resources.getOrCreate(Input);
        const camera = entityManager.createEntity("camera", [new Camera()]);
        const screenSize = component(entityManager, camera, ScreenSize);
        screenSize.x = SCREEN_WIDTH;
        screenSize.y = SCREEN_HEIGHT;
    });

    function rootOf(blocksGameInput: boolean, children: readonly Entity[]): Entity {
        const uiRoot = new UiRoot();
        uiRoot.blocksGameInput = blocksGameInput;
        const entity = entityManager.createEntity("root", [uiRoot, new UiLayout()]);
        attach(entityManager, entity, children);
        return entity;
    }

    test("a press on a UI button hides the pointer from the game, a key still drives a shared action, raw events stay", () => {
        input.useInputMap(inputMapOf({fire: {keys: [Key.Space], buttons: [PointerButton.Left]}, aim: {buttons: [PointerButton.Left]}}));
        const fire = input.action("fire"), aim = input.action("aim");
        rootOf(false, [entityManager.createEntity("button", [...placed({x: 0, y: 0, width: 5, height: 3}), filled(), interactable({click: true})])]);
        world.step();
        frame(down(1, 1), {type: "keyDown", key: Key.Space, repeat: false, ...NO_MODIFIERS});
        expect([input.pointerClaimed, input.buttonPressed(PointerButton.Left), input.buttonHeld(PointerButton.Left)]).toEqual([true, false, false]);
        expect([input.actionPressed(fire), input.actionHeld(fire), input.actionPressed(aim), input.actionHeld(aim)]).toEqual([true, true, false, false]);
        expect(input.events.map(event => event.type)).toEqual(["pointerDown", "keyDown"]);
        frame(up(1, 1));
        expect([input.buttonReleased(PointerButton.Left), input.actionReleased(aim), input.actionHeld(fire)]).toEqual([false, false, true]);
    });

    test("a press outside the UI reaches the game, and a gesture the game began stays the game's over UI", () => {
        rootOf(false, [entityManager.createEntity("button", [...placed({x: 0, y: 0, width: 5, height: 3}), filled(), interactable({click: true})])]);
        world.step();
        frame(down(FAR_FROM_UI, 1));
        expect([input.pointerClaimed, input.buttonPressed(PointerButton.Left)]).toEqual([false, true]);
        frame(move(1, 1));
        expect([input.pointerClaimed, input.buttonHeld(PointerButton.Left)]).toEqual([false, true]);
        frame(up(1, 1));
        expect([input.pointerClaimed, input.buttonReleased(PointerButton.Left)]).toEqual([false, true]);
        expect(world.resources.get(UiEvents).of("click")).toEqual([]);
        frame();
        expect(input.pointerClaimed).toBe(true);
    });

    test("a root that blocks game input claims the pointer over its drawn nodes only", () => {
        const panel = (): Entity => entityManager.createEntity("panel", [...placed({x: 0, y: 0, width: 5, height: 3}), filled()]);
        rootOf(true, [panel()]);
        world.step();
        frame(down(1, 1), up(1, 1));
        expect(input.pointerClaimed).toBe(true);
        frame(down(FAR_FROM_UI, 1), up(FAR_FROM_UI, 1));
        expect([input.pointerClaimed, input.buttonPressed(PointerButton.Left)]).toEqual([false, true]);
    });

    test("a root that does not block game input lets a press on a plain panel through", () => {
        const panel = entityManager.createEntity("panel", [...placed({x: 0, y: 0, width: 5, height: 3}), filled()]);
        rootOf(false, [panel]);
        world.step();
        frame(down(1, 1), up(1, 1));
        expect([input.pointerClaimed, input.buttonPressed(PointerButton.Left)]).toEqual([false, true]);
        expect(component(entityManager, panel, UiState).hovered).toBe(true);
    });
});
