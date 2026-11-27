import {beforeEach, describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {World} from "../core";
import type {Component, Entity, EntityManager} from "../core";
import {Input} from "../input/input";
import {NO_MODIFIERS} from "../input/inputEvent";
import type {InputEvent} from "../input/inputEvent";
import {PointerButton} from "../input/pointerButton";
import {Camera} from "../rendering/camera";
import {ScreenSize} from "../rendering/screenSize";
import {Children} from "../translation/children";
import {Parent} from "../translation/parent";
import type {UiScrollAxes} from "./layout/flexStyle";
import {UiEvents} from "./uiEvents";
import {UiInputSystemGroup} from "./uiInputSystemGroup";
import {UiInteractable} from "./uiInteractable";
import {UiLayout} from "./uiLayout";
import {POINTER_NODE_DECLARES_DRAG, POINTER_NODE_DECLARES_PRESS, POINTER_NODE_DECLARES_WHEEL, POINTER_SCROLLBAR_ACCEPTS} from "./uiPointerNodes";
import {UiPointerSystem} from "./uiPointerSystem";
import {UiRect} from "./uiRect";
import {UiRoot} from "./uiRoot";
import {UiScroll} from "./uiScroll";
import {scrollIntoView} from "./uiScrollIntoView";
import {UiScrollSystem} from "./uiScrollSystem";
import {UiSize} from "./uiSize";
import {UI_POINTER_PRIORITY, UI_SCROLL_PRIORITY} from "./uiSystemPriorities";
import {UiText} from "./uiText";

const SCREEN_WIDTH = 40;
const SCREEN_HEIGHT = 12;
const LIST_WIDTH = 10;
const LIST_HEIGHT = 4;
const ROWS = 10;
const MAX_SCROLL = ROWS - LIST_HEIGHT;
const BAR_X = LIST_WIDTH - 1;
const NOTCH_UP = 1;
const NOTCH_DOWN = -1;
const BUTTON_EVENTS: ReadonlySet<string> = new Set(["press", "release", "click", "drag"]);

function component<T extends Component>(entityManager: EntityManager, entity: Entity, ctor: new () => T): T {
    const found = entityManager.getComponent<T>(entity, ctor);
    if (found === undefined) throw new Error(`entity ${entity} has no ${ctor.name}`);
    return found;
}

function attach(entityManager: EntityManager, parent: Entity, children: readonly Entity[]): void {
    entityManager.addComponent(parent, new Children(...children));
    for (const child of children) entityManager.addComponent(child, new Parent(parent));
}

function fixedSize(width: number, height: number): UiSize {
    const size = new UiSize();
    size.widthMode = "fixed";
    size.width = width;
    size.heightMode = "fixed";
    size.height = height;
    return size;
}

function startAligned(direction: "row" | "column" = "column"): UiLayout {
    const layout = new UiLayout();
    layout.direction = direction;
    layout.align = "start";
    return layout;
}

function label(value: string): UiText {
    const text = new UiText();
    text.text = value;
    return text;
}

function scrolling(axes: UiScrollAxes = "vertical"): UiScroll {
    const scroll = new UiScroll();
    scroll.axes = axes;
    return scroll;
}

function clickable(): UiInteractable {
    const interactable = new UiInteractable();
    interactable.click = true;
    return interactable;
}

function move(x: number, y: number): InputEvent {
    return {type: "pointerMove", x, y, ...NO_MODIFIERS};
}

function down(x: number, y: number): InputEvent {
    return {type: "pointerDown", button: PointerButton.Left, x, y, ...NO_MODIFIERS};
}

function up(x: number, y: number): InputEvent {
    return {type: "pointerUp", button: PointerButton.Left, x, y, ...NO_MODIFIERS};
}

function wheel(x: number, y: number, delta: number): InputEvent {
    return {type: "wheel", delta, x, y, ...NO_MODIFIERS};
}

describe("UiScrollSystem", () => {
    let world: World;
    let entityManager: EntityManager;
    let input: Input;
    let list: Entity;
    let panel: Entity;
    let rows: Entity[];

    function frame(...events: InputEvent[]): string[] {
        for (const event of events) input.enqueue(event);
        world.step();
        return world.resources.get(UiEvents).events
            .filter(event => BUTTON_EVENTS.has(event.type))
            .map(event => `${event.type} ${entityManager.nameOf(event.target)}`);
    }

    function scrollY(): number {
        return component(entityManager, list, UiScroll).scrollY;
    }

    function rowsIn(parent: Entity, count: number, prefix: string): Entity[] {
        const created: Entity[] = [];
        for (let i = 0; i < count; i++) created.push(entityManager.createEntity(`${prefix}${i}`, [label(`item ${i}`)]));
        attach(entityManager, parent, created);
        return created;
    }

    function root(children: readonly Entity[]): void {
        const rootEntity = entityManager.createEntity("root", [new UiRoot(), startAligned()]);
        attach(entityManager, rootEntity, children);
        world.step();
    }

    function buildList(scroll: UiScroll = scrolling()): void {
        list = entityManager.createEntity("list", [scroll, fixedSize(LIST_WIDTH, LIST_HEIGHT), new UiLayout()]);
        rows = rowsIn(list, ROWS, "row");
        panel = entityManager.createEntity("panel", [clickable(), startAligned()]);
        attach(entityManager, panel, [list]);
        root([panel]);
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

    test("the pointer system brings the scroll system, which runs right after it in the UI input group", () => {
        const systems = world.getOrCreateSystem(UiInputSystemGroup).systems;
        expect(systems.map(system => system.constructor)).toEqual([UiPointerSystem, UiScrollSystem]);
        expect(UI_SCROLL_PRIORITY).toBeGreaterThan(UI_POINTER_PRIORITY);
        expect(POINTER_SCROLLBAR_ACCEPTS).toBe(POINTER_NODE_DECLARES_PRESS | POINTER_NODE_DECLARES_DRAG | POINTER_NODE_DECLARES_WHEEL);
    });

    test("a wheel notch down scrolls toward the end by the step, laid out the same frame, and up scrolls back", () => {
        buildList();
        frame(wheel(1, 1, NOTCH_DOWN));
        expect(scrollY()).toBe(3);
        expect(component(entityManager, rows[3], UiRect).y).toBe(0);
        frame(wheel(1, 1, NOTCH_UP));
        expect(scrollY()).toBe(0);
    });

    test("wheeling past the end clamps at once, so the overshoot does not have to be wheeled back", () => {
        buildList();
        frame(wheel(1, 1, NOTCH_DOWN), wheel(1, 1, NOTCH_DOWN), wheel(1, 1, NOTCH_DOWN), wheel(1, 1, NOTCH_DOWN));
        expect(scrollY()).toBe(MAX_SCROLL);
        frame(wheel(1, 1, NOTCH_UP));
        expect(scrollY()).toBe(MAX_SCROLL - 3);
    });

    test("the wheel step is per scroll node, and a horizontal-only node scrolls along x", () => {
        const scroll = scrolling("horizontal");
        scroll.wheelStepUnits = 2;
        list = entityManager.createEntity("strip", [scroll, fixedSize(5, 2), startAligned("row")]);
        attach(entityManager, list, [entityManager.createEntity("wide", [label("abcdefghijkl")])]);
        root([list]);
        frame(wheel(1, 0, NOTCH_DOWN));
        expect([component(entityManager, list, UiScroll).scrollX, scrollY()]).toEqual([2, 0]);
    });

    test("dragging the thumb scrolls in proportion, clamped at both ends, and the release ends the drag", () => {
        buildList();
        expect(frame(down(BAR_X, 0))).toEqual(["press list"]);
        expect(frame(move(BAR_X, 1))).toEqual(["drag list"]);
        expect(scrollY()).toBe(MAX_SCROLL / 2);
        frame(move(BAR_X, 2));
        expect(scrollY()).toBe(MAX_SCROLL);
        frame(move(BAR_X, SCREEN_HEIGHT - 1));
        expect(scrollY()).toBe(MAX_SCROLL);
        frame(move(BAR_X, 0));
        expect(scrollY()).toBe(0);
        expect(frame(up(BAR_X, 0))).toEqual(["release list"]);
        frame(move(BAR_X, 2));
        expect(scrollY()).toBe(0);
    });

    test("pressing the track beside the thumb pages one viewport toward the pointer", () => {
        buildList();
        frame(down(BAR_X, 3), up(BAR_X, 3));
        expect(scrollY()).toBe(LIST_HEIGHT);
        frame(down(BAR_X, 3), up(BAR_X, 3));
        expect(scrollY()).toBe(LIST_HEIGHT);
        frame(down(BAR_X, 0), up(BAR_X, 0));
        expect(scrollY()).toBe(0);
    });

    test("presses on the scrollbar stay with the scroll node, presses in the content reach the content's acceptors", () => {
        buildList();
        expect(frame(down(BAR_X, 0), up(BAR_X, 0))).toEqual(["press list", "release list"]);
        expect(frame(down(1, 1), up(1, 1))).toEqual(["click panel"]);
        frame(down(1, 1), move(1, 3), up(1, 3));
        expect(scrollY()).toBe(0);
    });

    test("scrollIntoView moves the scroll offset the least distance that shows the node, and leaves visible nodes alone", () => {
        buildList();
        scrollIntoView(world, rows[7]);
        expect(scrollY()).toBe(4);
        world.step();
        expect(component(entityManager, rows[7], UiRect).y).toBe(3);
        scrollIntoView(world, rows[1]);
        expect(scrollY()).toBe(1);
        world.step();
        scrollIntoView(world, rows[2]);
        expect(scrollY()).toBe(1);
    });

    test("scrollIntoView scrolls every scrolling ancestor, inner first", () => {
        list = entityManager.createEntity("outer", [scrolling(), fixedSize(LIST_WIDTH, LIST_HEIGHT), new UiLayout()]);
        const inner = entityManager.createEntity("inner", [scrolling(), fixedSize(8, 3), new UiLayout()]);
        attach(entityManager, list, [entityManager.createEntity("spacer", [fixedSize(1, 5)]), inner]);
        const innerRows = rowsIn(inner, 6, "inner");
        root([list]);
        scrollIntoView(world, innerRows[5]);
        expect([component(entityManager, inner, UiScroll).scrollY, scrollY()]).toEqual([3, 4]);
        world.step();
        expect(component(entityManager, innerRows[5], UiRect).y).toBe(3);
    });
});
