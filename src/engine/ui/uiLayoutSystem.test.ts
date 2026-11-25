import {beforeEach, describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {World} from "../core";
import type {Component, Entity, EntityManager} from "../core";
import {Camera} from "../rendering/camera";
import {ScreenSize} from "../rendering/screenSize";
import {Children} from "../translation/children";
import {Parent} from "../translation/parent";
import {UiLayout} from "./uiLayout";
import {UiLayoutSystem} from "./uiLayoutSystem";
import {UiRect} from "./uiRect";
import {UiRoot} from "./uiRoot";
import {UiScroll} from "./uiScroll";
import {UiSize} from "./uiSize";
import {UiText} from "./uiText";
import {UiTreeIndex} from "./uiTreeIndex";

const SCREEN_WIDTH = 40;
const SCREEN_HEIGHT = 12;
const TAMPERED_X = 999;
const ENABLED = true;
const DISABLED = false;

interface RectValues {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

function text(value: string): UiText {
    const component = new UiText();
    component.text = value;
    return component;
}

function row(gap: number): UiLayout {
    const layout = new UiLayout();
    layout.direction = "row";
    layout.gap = gap;
    layout.align = "start";
    return layout;
}

function attach(entityManager: EntityManager, parent: Entity, children: readonly Entity[]): void {
    const ordered = new Children(...children);
    if (entityManager.hasComponent(parent, Children)) entityManager.setComponent(parent, ordered);
    else entityManager.addComponent(parent, ordered);
    for (const child of children) entityManager.addComponent(child, new Parent(parent));
}

function component<T extends Component>(entityManager: EntityManager, entity: Entity, ctor: new () => T): T {
    const found = entityManager.getComponent<T>(entity, ctor);
    if (found === undefined) throw new Error(`entity ${entity} has no ${ctor.name}`);
    return found;
}

function rectOf(entityManager: EntityManager, entity: Entity): RectValues {
    const rect = component(entityManager, entity, UiRect);
    return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
}

describe("UiLayoutSystem", () => {
    let world: World;
    let entityManager: EntityManager;
    let camera: Entity;
    let root: Entity;
    let title: Entity;
    let group: Entity;
    let left: Entity;
    let right: Entity;
    let footer: Entity;

    beforeEach(() => {
        world = new World({platform: new MemoryPlatform()});
        world.getOrCreateSystem(UiLayoutSystem);
        entityManager = world.entityManager;
        camera = entityManager.createEntity("camera", [new Camera()]);
        const screenSize = component(entityManager, camera, ScreenSize);
        screenSize.x = SCREEN_WIDTH;
        screenSize.y = SCREEN_HEIGHT;
        root = entityManager.createEntity("root", [new UiRoot(), new UiLayout()]);
        title = entityManager.createEntity("title", [text("Settings")]);
        group = entityManager.createEntity("group", [row(1)]);
        left = entityManager.createEntity("left", [text("abc")]);
        right = entityManager.createEntity("right", [text("de\nfg")]);
        footer = entityManager.createEntity("footer", [text("ok")]);
        attach(entityManager, root, [title, group, footer]);
        attach(entityManager, group, [left, right]);
    });

    test("UI node components add UiRect", () => {
        const sized = entityManager.createEntity("sized", [new UiSize()]);
        const scrolled = entityManager.createEntity("scrolled", [new UiScroll()]);
        expect(entityManager.hasComponent(sized, UiRect)).toBe(true);
        expect(entityManager.hasComponent(scrolled, UiRect)).toBe(true);
        expect(entityManager.hasComponent(title, UiRect)).toBe(true);
    });

    test("a root covers the camera's screen and lays out its column, nested rows included", () => {
        world.step();
        expect(rectOf(entityManager, root)).toEqual({x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT});
        expect(rectOf(entityManager, title)).toEqual({x: 0, y: 0, width: SCREEN_WIDTH, height: 1});
        expect(rectOf(entityManager, group)).toEqual({x: 0, y: 1, width: SCREEN_WIDTH, height: 2});
        expect(rectOf(entityManager, left)).toEqual({x: 0, y: 1, width: 3, height: 1});
        expect(rectOf(entityManager, right)).toEqual({x: 4, y: 1, width: 2, height: 2});
        expect(rectOf(entityManager, footer)).toEqual({x: 0, y: 3, width: SCREEN_WIDTH, height: 1});
        const clip = component(entityManager, right, UiRect);
        expect([clip.clipLeft, clip.clipTop, clip.clipRight, clip.clipBottom]).toEqual([0, 0, SCREEN_WIDTH, SCREEN_HEIGHT]);
    });

    test("the tree index lists each root's nodes in pre-order with parents, depths and subtree ends", () => {
        world.step();
        const index = world.resources.get(UiTreeIndex);
        expect(index.roots).toEqual([0]);
        expect(index.entities).toEqual([root, title, group, left, right, footer]);
        expect(Array.from(index.parentIndex.subarray(0, index.count))).toEqual([-1, 0, 0, 2, 2, 0]);
        expect(Array.from(index.depth.subarray(0, index.count))).toEqual([0, 1, 1, 2, 2, 1]);
        expect(Array.from(index.subtreeEnd.subarray(0, index.count))).toEqual([6, 2, 5, 4, 5, 6]);
    });

    test("nothing is laid out again while nothing it reads changes, its own writes included", () => {
        const list = entityManager.createEntity("list", [new UiScroll()]);
        attach(entityManager, root, [title, group, footer, list]);
        component(entityManager, list, UiScroll).scrollY = 10;
        world.step();
        expect(component(entityManager, list, UiScroll).scrollY).toBe(0);
        world.step();
        component(entityManager, footer, UiRect).x = TAMPERED_X;
        world.step();
        world.step();
        expect(rectOf(entityManager, footer).x).toBe(TAMPERED_X);
    });

    test("changing a text lays the tree out again", () => {
        world.step();
        component(entityManager, footer, UiRect).x = TAMPERED_X;
        component(entityManager, right, UiText).text = "de\nfg\nhi";
        world.step();
        expect(rectOf(entityManager, footer)).toEqual({x: 0, y: 4, width: SCREEN_WIDTH, height: 1});
    });

    test("changing the camera's screen size lays the tree out again", () => {
        world.step();
        component(entityManager, camera, ScreenSize).x = SCREEN_WIDTH * 2;
        world.step();
        expect(rectOf(entityManager, root).width).toBe(SCREEN_WIDTH * 2);
        expect(rectOf(entityManager, footer).width).toBe(SCREEN_WIDTH * 2);
    });

    test("a root's scale divides the screen into UI units", () => {
        component(entityManager, root, UiRoot).scale = 2;
        world.step();
        expect(rectOf(entityManager, root)).toEqual({x: 0, y: 0, width: SCREEN_WIDTH / 2, height: SCREEN_HEIGHT / 2});
    });

    test("a disabled child is skipped with its subtree and enabling it brings it back", () => {
        world.step();
        entityManager.setEnabledState(group, DISABLED);
        world.step();
        expect(rectOf(entityManager, footer).y).toBe(1);
        expect(world.resources.get(UiTreeIndex).entities).toEqual([root, title, footer]);
        entityManager.setEnabledState(group, ENABLED);
        world.step();
        expect(rectOf(entityManager, footer).y).toBe(3);
    });

    test("a destroyed node lays the tree out again without it", () => {
        world.step();
        entityManager.destroyEntity(title);
        world.step();
        expect(rectOf(entityManager, group).y).toBe(0);
        expect(rectOf(entityManager, footer).y).toBe(2);
    });

    test("children without UiRect are ignored with their subtree", () => {
        const plain = entityManager.createEntity("plain");
        const hidden = entityManager.createEntity("hidden", [text("hidden")]);
        attach(entityManager, root, [title, plain, group, footer]);
        attach(entityManager, plain, [hidden]);
        world.step();
        expect(world.resources.get(UiTreeIndex).indexOf(hidden)).toBe(-1);
        expect(rectOf(entityManager, footer).y).toBe(3);
    });

    test("without exactly one enabled camera the layout waits and runs once there is one", () => {
        entityManager.setEnabledState(camera, DISABLED);
        world.step();
        expect(rectOf(entityManager, root).width).toBe(0);
        entityManager.setEnabledState(camera, ENABLED);
        world.step();
        expect(rectOf(entityManager, root).width).toBe(SCREEN_WIDTH);
        const second = entityManager.createEntity("second camera", [new Camera()]);
        component(entityManager, root, UiRoot).scale = 2;
        world.step();
        expect(rectOf(entityManager, root).width).toBe(SCREEN_WIDTH);
        entityManager.destroyEntity(second);
        world.step();
        expect(rectOf(entityManager, root).width).toBe(SCREEN_WIDTH / 2);
    });

    test("roots lay out in sort order and each covers the screen", () => {
        const overlay = entityManager.createEntity("overlay", [new UiRoot()]);
        component(entityManager, overlay, UiRoot).sortOrder = -1;
        world.step();
        const index = world.resources.get(UiTreeIndex);
        expect(index.roots.map(rootIndex => index.entities[rootIndex])).toEqual([overlay, root]);
        expect(rectOf(entityManager, overlay)).toEqual({x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT});
    });

    test("scroll offsets are clamped and written back with the content size", () => {
        const list = entityManager.createEntity("list", [new UiScroll(), new UiSize()]);
        const size = component(entityManager, list, UiSize);
        size.heightMode = "fixed";
        size.height = 2;
        const items = [text("one"), text("two"), text("three"), text("four")].map(item => entityManager.createEntity("item", [item]));
        attach(entityManager, root, [title, group, footer, list]);
        attach(entityManager, list, items);
        component(entityManager, list, UiScroll).scrollY = 10;
        world.step();
        const scroll = component(entityManager, list, UiScroll);
        expect([scroll.scrollY, scroll.contentWidth, scroll.contentHeight]).toEqual([2, SCREEN_WIDTH, 4]);
        expect(rectOf(entityManager, items[2]).y).toBe(4);
        const clip = component(entityManager, items[0], UiRect);
        expect([clip.clipTop, clip.clipBottom]).toEqual([4, 6]);
    });
});
