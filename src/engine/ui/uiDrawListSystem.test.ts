import {beforeEach, describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {World} from "../core";
import type {Component, Entity, EntityManager} from "../core";
import {Input} from "../input/input";
import {NO_MODIFIERS} from "../input/inputEvent";
import {PointerButton} from "../input/pointerButton";
import {Camera} from "../rendering/camera";
import {ScreenSize} from "../rendering/screenSize";
import {TextColor} from "../rendering/textColor";
import {Children} from "../translation/children";
import {Parent} from "../translation/parent";
import type {UiBorderStyle, UiTextAlign, UiTextOverflow, UiTextWrap} from "./layout/flexStyle";
import {UiBox} from "./uiBox";
import {
    UI_BORDER_SINGLE,
    UI_DRAW_BORDER,
    UI_DRAW_CLIP_BOTTOM,
    UI_DRAW_CLIP_LEFT,
    UI_DRAW_CLIP_RIGHT,
    UI_DRAW_CLIP_TOP,
    UI_DRAW_FILL,
    UI_DRAW_FLOATS,
    UI_DRAW_HEIGHT,
    UI_DRAW_TEXT,
    UI_DRAW_WIDTH,
    UI_DRAW_X,
    UI_DRAW_Y,
    UiDrawList,
} from "./uiDrawList";
import {ELLIPSIS_CODE_POINT, UiDrawListSystem} from "./uiDrawListSystem";
import {UiInteractable} from "./uiInteractable";
import {UiLayout} from "./uiLayout";
import {UiRoot} from "./uiRoot";
import {REQUESTED_UI_SCALE_RULE, UiScaleSnapping} from "./uiScaleSnapping";
import {UiScroll} from "./uiScroll";
import {UiSize} from "./uiSize";
import {UiText} from "./uiText";

const SCREEN_WIDTH = 40;
const SCREEN_HEIGHT = 12;
const PANEL_WIDTH = 12;
const PANEL_HEIGHT = 4;
const DOUBLE_SCALE = 2;

interface TextOptions {
    readonly foreground?: TextColor;
    readonly wrap?: UiTextWrap;
    readonly overflow?: UiTextOverflow;
    readonly alignX?: UiTextAlign;
}

interface DrawnCommand {
    readonly kind: number;
    readonly root: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly color: number;
    readonly clip: readonly number[];
    readonly text: string;
}

function uiText(value: string, options: TextOptions = {}): UiText {
    const text = new UiText();
    text.text = value;
    text.foreground = options.foreground ?? TextColor.DEFAULT;
    text.wrap = options.wrap ?? "none";
    text.overflow = options.overflow ?? "clip";
    text.alignX = options.alignX ?? "start";
    return text;
}

function uiBox(background: TextColor, border: UiBorderStyle, borderColor: TextColor = TextColor.DEFAULT): UiBox {
    const box = new UiBox();
    box.background = background;
    box.border = border;
    box.borderColor = borderColor;
    return box;
}

function fixedWidth(width: number): UiSize {
    const size = new UiSize();
    size.widthMode = "fixed";
    size.width = width;
    return size;
}

function attach(entityManager: EntityManager, parent: Entity, children: readonly Entity[]): void {
    entityManager.addComponent(parent, new Children(...children));
    for (const child of children) entityManager.addComponent(child, new Parent(parent));
}

function component<T extends Component>(entityManager: EntityManager, entity: Entity, ctor: new () => T): T {
    const found = entityManager.getComponent<T>(entity, ctor);
    if (found === undefined) throw new Error(`entity ${entity} has no ${ctor.name}`);
    return found;
}

function commandsOf(list: UiDrawList): DrawnCommand[] {
    const commands: DrawnCommand[] = [];
    for (let command = 0; command < list.count; command++) {
        const base = command * UI_DRAW_FLOATS, geometry = list.geometry;
        const start = list.glyphStarts[command];
        const glyphs = Array.from(list.glyphs.subarray(start, start + list.glyphCounts[command]));
        commands.push({
            kind: list.kinds[command],
            root: list.roots[command],
            x: geometry[base + UI_DRAW_X],
            y: geometry[base + UI_DRAW_Y],
            width: geometry[base + UI_DRAW_WIDTH],
            height: geometry[base + UI_DRAW_HEIGHT],
            color: list.colors[command],
            clip: [geometry[base + UI_DRAW_CLIP_LEFT], geometry[base + UI_DRAW_CLIP_TOP], geometry[base + UI_DRAW_CLIP_RIGHT], geometry[base + UI_DRAW_CLIP_BOTTOM]],
            text: String.fromCodePoint(...glyphs),
        });
    }
    return commands;
}

describe("UiDrawListSystem", () => {
    let world: World;
    let entityManager: EntityManager;
    let root: Entity;

    function drawn(): DrawnCommand[] {
        world.step();
        return commandsOf(world.resources.get(UiDrawList));
    }

    function texts(): DrawnCommand[] {
        return drawn().filter(command => command.kind === UI_DRAW_TEXT);
    }

    function panelWith(children: readonly Entity[], box: UiBox = uiBox(TextColor.BLUE, "single", TextColor.WHITE)): Entity {
        const layout = new UiLayout();
        layout.align = "start";
        const panel = entityManager.createEntity("panel", [layout, box, fixedWidth(PANEL_WIDTH)]);
        attach(entityManager, panel, children);
        attach(entityManager, root, [panel]);
        return panel;
    }

    beforeEach(() => {
        world = new World({platform: new MemoryPlatform()});
        world.getOrCreateSystem(UiDrawListSystem);
        entityManager = world.entityManager;
        const camera = entityManager.createEntity("camera", [new Camera()]);
        const screenSize = component(entityManager, camera, ScreenSize);
        screenSize.x = SCREEN_WIDTH;
        screenSize.y = SCREEN_HEIGHT;
        const rootLayout = new UiLayout();
        rootLayout.align = "start";
        root = entityManager.createEntity("root", [new UiRoot(), rootLayout]);
    });

    test("a box emits its fill then its border, then its children's text inside the border, in tree order", () => {
        panelWith([
            entityManager.createEntity("title", [uiText("Title", {foreground: TextColor.YELLOW})]),
            entityManager.createEntity("body", [uiText("Body")]),
        ]);
        const commands = drawn();
        expect(commands.map(command => command.kind)).toEqual([UI_DRAW_FILL, UI_DRAW_BORDER, UI_DRAW_TEXT, UI_DRAW_TEXT]);
        const [fill, border, title, body] = commands;
        expect([fill.x, fill.y, fill.width, fill.height, fill.color]).toEqual([0, 0, PANEL_WIDTH, PANEL_HEIGHT, TextColor.BLUE]);
        expect([border.x, border.y, border.width, border.height, border.color]).toEqual([0, 0, PANEL_WIDTH, PANEL_HEIGHT, TextColor.WHITE]);
        expect(world.resources.get(UiDrawList).borders[1]).toBe(UI_BORDER_SINGLE);
        expect([title.x, title.y, title.width, title.height, title.color, title.text]).toEqual([1, 1, 5, 1, TextColor.YELLOW, "Title"]);
        expect([body.x, body.y, body.width, body.text]).toEqual([1, 2, 4, "Body"]);
        expect(commands.every(command => command.root === 0)).toBe(true);
    });

    test("a box with the default background and no border emits nothing", () => {
        panelWith([entityManager.createEntity("label", [uiText("x")])], uiBox(TextColor.DEFAULT, "none"));
        expect(drawn().map(command => command.kind)).toEqual([UI_DRAW_TEXT]);
    });

    test("alignX places each line at the start, centre or end of the content box", () => {
        const stretched = (value: string, alignX: UiTextAlign) => {
            const text = uiText(value, {alignX});
            return entityManager.createEntity(value, [text, fixedWidth(10)]);
        };
        panelWith([stretched("ab", "start"), stretched("cd", "center"), stretched("ef", "end")], uiBox(TextColor.DEFAULT, "none"));
        expect(texts().map(command => [command.text, command.x])).toEqual([["ab", 0], ["cd", 4], ["ef", 8]]);
    });

    test("word wrap breaks lines at the content width, one command per line", () => {
        const text = uiText("one two three", {wrap: "word"});
        panelWith([entityManager.createEntity("wrapped", [text, fixedWidth(9)])], uiBox(TextColor.DEFAULT, "none"));
        expect(texts().map(command => [command.text, command.y])).toEqual([["one two", 0], ["three", 1]]);
    });

    test("a line wider than its box is cut at the content width, with an ellipsis in the last column when asked", () => {
        const layout = new UiLayout();
        layout.paddingLeft = 1;
        panelWith([
            entityManager.createEntity("clipped", [uiText("abcdefgh"), fixedWidth(5)]),
            entityManager.createEntity("ellipsis", [uiText("abcdefgh", {overflow: "ellipsis"}), fixedWidth(5), layout]),
            entityManager.createEntity("fits", [uiText("abc", {overflow: "ellipsis"}), fixedWidth(5)]),
        ], uiBox(TextColor.DEFAULT, "none"));
        const [clipped, ellipsis, fits] = texts();
        expect([clipped.text, clipped.width]).toEqual(["abcde", 5]);
        expect([ellipsis.text, ellipsis.x, ellipsis.width]).toEqual(["abc" + String.fromCodePoint(ELLIPSIS_CODE_POINT), 1, 4]);
        expect(fits.text).toBe("abc");
    });

    test("text carries the intersection of its clip and its content box, boxes carry their ancestors' clip", () => {
        const layout = new UiLayout();
        layout.clip = true;
        layout.align = "start";
        const size = new UiSize();
        size.widthMode = "fixed";
        size.width = 6;
        size.heightMode = "fixed";
        size.height = 3;
        const clipper = entityManager.createEntity("clipper", [layout, size, uiBox(TextColor.RED, "single")]);
        const wide = entityManager.createEntity("wide", [uiText("0123456789")]);
        attach(entityManager, clipper, [wide]);
        attach(entityManager, root, [clipper]);
        const [fill, border, text] = drawn();
        expect(fill.clip).toEqual([0, 0, SCREEN_WIDTH, SCREEN_HEIGHT]);
        expect(border.clip).toEqual([0, 0, SCREEN_WIDTH, SCREEN_HEIGHT]);
        expect([text.x, text.text]).toEqual([1, "0123456789"]);
        expect(text.clip).toEqual([1, 1, 5, 2]);
    });

    test("roots draw in sort order, each command naming its root, and each root records its effective scale", () => {
        const front = new UiRoot();
        front.sortOrder = 1;
        front.scale = DOUBLE_SCALE;
        entityManager.createEntity("front", [front, uiText("front")]);
        attach(entityManager, root, [entityManager.createEntity("back", [uiText("back")])]);
        const commands = texts();
        expect(commands.map(command => [command.text, command.root])).toEqual([["back", 0], ["front", 1]]);
        expect(world.resources.get(UiDrawList).rootScales).toEqual([1, DOUBLE_SCALE]);
    });

    test("the list keeps its version while nothing changes and rebuilds when a box or text does", () => {
        const label = entityManager.createEntity("label", [uiText("a")]);
        const panel = panelWith([label]);
        world.step();
        const list = world.resources.get(UiDrawList);
        const built = list.version;
        world.step();
        world.step();
        expect(list.version).toBe(built);
        component(entityManager, panel, UiBox).background = TextColor.GREEN;
        world.step();
        expect(list.version).toBe(built + 1);
        expect(commandsOf(list)[0].color).toBe(TextColor.GREEN);
        component(entityManager, label, UiText).text = "b";
        world.step();
        expect(commandsOf(list).at(-1)!.text).toBe("b");
    });

    test("a box takes its disabled, pressed or hovered colours from UiState, and a DEFAULT state colour falls back", () => {
        const box = uiBox(TextColor.BLUE, "single", TextColor.WHITE);
        box.hoveredBackground = TextColor.GREEN;
        box.hoveredBorderColor = TextColor.YELLOW;
        const panel = panelWith([], box);
        entityManager.addComponent(panel, new UiInteractable());
        const input = world.resources.getOrCreate(Input);
        const boxColors = (): number[] => drawn().slice(0, 2).map(command => command.color);
        expect(boxColors()).toEqual([TextColor.BLUE, TextColor.WHITE]);
        input.enqueue({type: "pointerMove", x: 1, y: 1, ...NO_MODIFIERS});
        expect(boxColors()).toEqual([TextColor.GREEN, TextColor.YELLOW]);
        input.enqueue({type: "pointerDown", button: PointerButton.Left, x: 1, y: 1, ...NO_MODIFIERS});
        expect(boxColors()).toEqual([TextColor.GREEN, TextColor.YELLOW]);
        component(entityManager, panel, UiBox).pressedBackground = TextColor.RED;
        expect(boxColors()).toEqual([TextColor.RED, TextColor.YELLOW]);
        component(entityManager, panel, UiInteractable).disabled = true;
        expect(boxColors()).toEqual([TextColor.BLUE, TextColor.WHITE]);
        component(entityManager, panel, UiBox).disabledBackground = TextColor.BRIGHT_BLACK;
        expect(boxColors()).toEqual([TextColor.BRIGHT_BLACK, TextColor.WHITE]);
    });

    test("a new scale rule lays the roots out again at the scale it returns", () => {
        root = entityManager.createEntity("scaled", [new UiRoot(), uiText("x")]);
        world.step();
        world.resources.get(UiScaleSnapping).use({...REQUESTED_UI_SCALE_RULE, effectiveScale: () => DOUBLE_SCALE});
        world.step();
        expect(world.resources.get(UiDrawList).rootScales).toEqual([DOUBLE_SCALE, DOUBLE_SCALE]);
    });

    test("a scroll node's track and thumb are fills in its own clip, and its content is clipped short of the track", () => {
        const size = new UiSize();
        size.widthMode = "fixed";
        size.width = PANEL_WIDTH;
        size.heightMode = "fixed";
        size.height = PANEL_HEIGHT;
        const list = entityManager.createEntity("list", [new UiScroll(), size]);
        const rows: Entity[] = [];
        for (let i = 0; i < PANEL_HEIGHT * 2; i++) rows.push(entityManager.createEntity(`row${i}`, [uiText(`item ${i}`)]));
        attach(entityManager, list, rows);
        attach(entityManager, root, [list]);
        const commands = drawn();
        const fills = commands.filter(command => command.kind === UI_DRAW_FILL);
        const screenClip = [0, 0, SCREEN_WIDTH, SCREEN_HEIGHT];
        const barX = PANEL_WIDTH - 1;
        expect(fills.map(fill => [fill.x, fill.y, fill.width, fill.height, fill.color, fill.clip])).toEqual([
            [barX, 0, 1, PANEL_HEIGHT, TextColor.BRIGHT_BLACK, screenClip],
            [barX, 0, 1, 2, TextColor.WHITE, screenClip],
        ]);
        expect(commands.indexOf(fills[1])).toBe(1);
        expect(commands.filter(command => command.kind === UI_DRAW_TEXT).every(command => command.clip[2] === barX)).toBe(true);
        component(entityManager, list, UiScroll).scrollY = PANEL_HEIGHT;
        const scrolledThumb = drawn().filter(command => command.kind === UI_DRAW_FILL)[1];
        expect([scrolledThumb.y, scrolledThumb.height]).toEqual([PANEL_HEIGHT - 2, 2]);
    });
});
