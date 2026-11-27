import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {World} from "../../engine/core/world";
import type {Entity, EntityManager} from "../../engine/core";
import {Camera} from "../../engine/rendering/camera";
import {HudElement} from "../../engine/rendering/hudElement";
import {ScreenAnchor} from "../../engine/rendering/screenAnchor";
import {TextColor} from "../../engine/rendering/textColor";
import {TextSprite} from "../../engine/rendering/textSprite";
import {Children} from "../../engine/translation/children";
import {Parent} from "../../engine/translation/parent";
import type {UiBorderStyle, UiTextAlign, UiTextOverflow} from "../../engine/ui/layout/flexStyle";
import {UiBox} from "../../engine/ui/uiBox";
import {UiLayout} from "../../engine/ui/uiLayout";
import {UiRoot} from "../../engine/ui/uiRoot";
import {UiScaleSnapping} from "../../engine/ui/uiScaleSnapping";
import {UiScroll} from "../../engine/ui/uiScroll";
import {UiSize} from "../../engine/ui/uiSize";
import {UiText} from "../../engine/ui/uiText";
import {CellKind, copyCellFrame} from "./cellFrame";
import type {CellFrame} from "./cellFrame";
import type {CellPresenter, CellPresenterSize} from "./cellPresenter";
import {installCellsBackend} from "./cellsBackend";
import {CELLS_HUD_TEXT_PASSES} from "./cellsHudTextPasses";
import {CELLS_UI_PASSES} from "./cellsUiPasses";

const COLUMNS = 30;
const ROWS = 10;
const PANEL_WIDTH = 10;
const PANEL_HEIGHT = 6;
const BORDER_COLUMNS = 2;
const CONTENT_WIDTH = PANEL_WIDTH - BORDER_COLUMNS;
const HUD_LINE = "Z".repeat(PANEL_WIDTH + BORDER_COLUMNS);
const SETTLE_STEPS = 3;
const REQUESTED_SCALE = 1.5;

interface DrawnCell {
    readonly glyph: string;
    readonly foreground: number;
    readonly background: number;
    readonly kind: number;
}

class FrameKeeper implements CellPresenter {
    public lastFrame: CellFrame | undefined;

    public size(): CellPresenterSize {
        return {columns: COLUMNS, rows: ROWS};
    }

    public onResize(): () => void {
        return () => undefined;
    }

    public start(): void {
    }

    public stop(): void {
    }

    public present(frame: CellFrame): void {
        this.lastFrame = copyCellFrame(frame);
    }
}

function cellAt(frame: CellFrame, x: number, y: number): DrawnCell {
    const index = y * frame.width + x;
    return {glyph: String.fromCodePoint(frame.glyph[index]), foreground: frame.foreground[index], background: frame.background[index], kind: frame.kind[index]};
}

function rowText(frame: CellFrame, y: number, fromX: number, toX: number): string {
    let text = "";
    for (let x = fromX; x < toX; x++) text += cellAt(frame, x, y).glyph;
    return text;
}

function text(value: string, foreground: TextColor, alignX: UiTextAlign = "start", overflow: UiTextOverflow = "clip"): UiText {
    const component = new UiText();
    component.text = value;
    component.foreground = foreground;
    component.alignX = alignX;
    component.overflow = overflow;
    return component;
}

function fixedWidth(width: number): UiSize {
    const size = new UiSize();
    size.widthMode = "fixed";
    size.width = width;
    return size;
}

function box(background: TextColor, border: UiBorderStyle, borderColor: TextColor): UiBox {
    const component = new UiBox();
    component.background = background;
    component.border = border;
    component.borderColor = borderColor;
    return component;
}

function attach(entityManager: EntityManager, parent: Entity, children: readonly Entity[]): void {
    entityManager.addComponent(parent, new Children(...children));
    for (const child of children) entityManager.addComponent(child, new Parent(parent));
}

function topLeft(): ScreenAnchor {
    const anchor = new ScreenAnchor();
    anchor.anchorPosition = "top-left";
    return anchor;
}

function hudText(value: string, foreground: TextColor): TextSprite {
    const sprite = new TextSprite();
    sprite.image = [value];
    sprite.foreground = foreground;
    return sprite;
}

function renderPanel(border: UiBorderStyle = "single", requestedScale: number = 1): {frame: CellFrame, world: World} {
    const presenter = new FrameKeeper();
    const world = new World({platform: new MemoryPlatform()});
    installCellsBackend(world, presenter, [...CELLS_HUD_TEXT_PASSES, ...CELLS_UI_PASSES]);
    const em = world.entityManager;
    em.createEntity("camera", [new Camera()]);
    em.createEntity("hud", [hudText(HUD_LINE, TextColor.MAGENTA), new HudElement(), topLeft()]);
    const rootLayout = new UiLayout();
    rootLayout.align = "start";
    const uiRoot = new UiRoot();
    uiRoot.scale = requestedScale;
    const root = em.createEntity("root", [uiRoot, rootLayout]);
    const panelLayout = new UiLayout();
    panelLayout.align = "start";
    panelLayout.clip = true;
    const panel = em.createEntity("panel", [panelLayout, fixedWidth(PANEL_WIDTH), box(TextColor.BLUE, border, TextColor.BRIGHT_WHITE)]);
    attach(em, root, [panel]);
    attach(em, panel, [
        em.createEntity("hello", [text("Hello", TextColor.YELLOW)]),
        em.createEntity("centred", [text("ab", TextColor.GREEN, "center"), fixedWidth(CONTENT_WIDTH)]),
        em.createEntity("ellipsis", [text("abcdefghijkl", TextColor.CYAN, "start", "ellipsis"), fixedWidth(CONTENT_WIDTH)]),
        em.createEntity("wide", [text("0123456789ABCDEF", TextColor.RED)]),
    ]);
    for (let step = 0; step < SETTLE_STEPS; step++) world.step();
    return {frame: presenter.lastFrame!, world};
}

function renderScrollList(): CellFrame {
    const presenter = new FrameKeeper();
    const world = new World({platform: new MemoryPlatform()});
    installCellsBackend(world, presenter, [...CELLS_UI_PASSES]);
    const em = world.entityManager;
    em.createEntity("camera", [new Camera()]);
    const rootLayout = new UiLayout();
    rootLayout.align = "start";
    const root = em.createEntity("root", [new UiRoot(), rootLayout]);
    const size = fixedWidth(PANEL_WIDTH);
    size.heightMode = "fixed";
    size.height = PANEL_HEIGHT;
    const list = em.createEntity("list", [new UiScroll(), size]);
    attach(em, root, [list]);
    const rows: Entity[] = [];
    for (let i = 0; i < PANEL_HEIGHT * 2; i++) rows.push(em.createEntity(`row${i}`, [text(`item ${i}`, TextColor.YELLOW)]));
    attach(em, list, rows);
    for (let step = 0; step < SETTLE_STEPS; step++) world.step();
    return presenter.lastFrame!;
}

describe("UiCellPassSystem", () => {
    test("a single border draws box-drawing corners and edges over the box's background", () => {
        const {frame} = renderPanel();
        const right = PANEL_WIDTH - 1, bottom = PANEL_HEIGHT - 1;
        expect([cellAt(frame, 0, 0).glyph, cellAt(frame, right, 0).glyph, cellAt(frame, 0, bottom).glyph, cellAt(frame, right, bottom).glyph]).toEqual(["┌", "┐", "└", "┘"]);
        expect(rowText(frame, 0, 1, right)).toBe("─".repeat(CONTENT_WIDTH));
        expect(rowText(frame, bottom, 1, right)).toBe("─".repeat(CONTENT_WIDTH));
        for (let y = 1; y < bottom; y++) expect([cellAt(frame, 0, y).glyph, cellAt(frame, right, y).glyph]).toEqual(["│", "│"]);
        expect(cellAt(frame, 0, 0)).toEqual({glyph: "┌", foreground: TextColor.BRIGHT_WHITE, background: TextColor.BLUE, kind: CellKind.Text});
    });

    test("double and thick borders use their own box-drawing glyphs", () => {
        const right = PANEL_WIDTH - 1, bottom = PANEL_HEIGHT - 1;
        const corners = (frame: CellFrame) => [cellAt(frame, 0, 0), cellAt(frame, right, 0), cellAt(frame, 0, bottom), cellAt(frame, right, bottom), cellAt(frame, 1, 0), cellAt(frame, 0, 1)]
            .map(cell => cell.glyph).join("");
        expect(corners(renderPanel("double").frame)).toBe("╔╗╚╝═║");
        expect(corners(renderPanel("thick").frame)).toBe("┏┓┗┛━┃");
    });

    test("text writes its glyphs in its foreground and keeps the box's background", () => {
        const {frame} = renderPanel();
        expect(rowText(frame, 1, 1, 6)).toBe("Hello");
        expect(cellAt(frame, 1, 1)).toEqual({glyph: "H", foreground: TextColor.YELLOW, background: TextColor.BLUE, kind: CellKind.Text});
        expect(cellAt(frame, 6, 1)).toEqual({glyph: " ", foreground: TextColor.DEFAULT, background: TextColor.BLUE, kind: CellKind.Text});
    });

    test("alignX center centres the line in the content box", () => {
        const {frame} = renderPanel();
        expect(rowText(frame, 2, 1, PANEL_WIDTH - 1)).toBe("   ab   ");
        expect(cellAt(frame, 4, 2).foreground).toBe(TextColor.GREEN);
    });

    test("an overflowing line ends in an ellipsis in its last visible column", () => {
        const {frame} = renderPanel();
        expect(rowText(frame, 3, 1, PANEL_WIDTH - 1)).toBe("abcdefg…");
    });

    test("text wider than its clipping parent is cut at the parent's border", () => {
        const {frame} = renderPanel();
        expect(rowText(frame, 4, 1, PANEL_WIDTH - 1)).toBe("01234567");
        expect(cellAt(frame, PANEL_WIDTH - 1, 4)).toEqual({glyph: "│", foreground: TextColor.BRIGHT_WHITE, background: TextColor.BLUE, kind: CellKind.Text});
        expect(cellAt(frame, PANEL_WIDTH, 4).kind).toBe(CellKind.Background);
    });

    test("UI draws over HUD text at the same place and leaves the HUD beside it", () => {
        const {frame} = renderPanel();
        expect(cellAt(frame, 0, 0).glyph).toBe("┌");
        expect(cellAt(frame, 3, 0).glyph).toBe("─");
        expect(rowText(frame, 0, PANEL_WIDTH, HUD_LINE.length)).toBe("ZZ");
        expect(cellAt(frame, PANEL_WIDTH, 0).foreground).toBe(TextColor.MAGENTA);
    });

    test("cells lay a UI unit out as one cell whatever the root's scale", () => {
        const {frame, world} = renderPanel("single", REQUESTED_SCALE);
        expect(world.resources.get(UiScaleSnapping).effectiveScale(REQUESTED_SCALE)).toBe(1);
        expect(rowText(frame, 1, 1, 6)).toBe("Hello");
        expect(cellAt(frame, PANEL_WIDTH - 1, 0).glyph).toBe("┐");
    });

    test("an overflowing scroll region draws its thumb over its track in its last column, beside its rows", () => {
        const frame = renderScrollList();
        const barX = PANEL_WIDTH - 1, thumbRows = PANEL_HEIGHT / 2;
        const bar = Array.from({length: PANEL_HEIGHT}, (_, y) => cellAt(frame, barX, y).background);
        expect(bar).toEqual([...Array(thumbRows).fill(TextColor.WHITE), ...Array(PANEL_HEIGHT - thumbRows).fill(TextColor.BRIGHT_BLACK)]);
        expect(rowText(frame, 0, 0, 6)).toBe("item 0");
        expect(rowText(frame, PANEL_HEIGHT - 1, 0, 6)).toBe("item 5");
        expect(cellAt(frame, barX - 1, 0).background).toBe(TextColor.DEFAULT);
    });
});
