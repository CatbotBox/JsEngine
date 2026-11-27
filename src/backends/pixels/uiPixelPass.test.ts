import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {World} from "../../engine/core/world";
import type {Entity, EntityManager} from "../../engine/core";
import {Camera} from "../../engine/rendering/camera";
import {HudElement} from "../../engine/rendering/hudElement";
import {ScreenAnchor} from "../../engine/rendering/screenAnchor";
import {TextColor} from "../../engine/rendering/textColor";
import {resolveTextColorRgb} from "../../engine/rendering/textColorPalette";
import {TextSprite} from "../../engine/rendering/textSprite";
import {ASCII_PIXEL_FONT} from "../../engine/rendering/text/asciiPixelFont";
import {isGlyphColumnLit} from "../../engine/rendering/text/pixelFont";
import {Children} from "../../engine/translation/children";
import {Parent} from "../../engine/translation/parent";
import type {UiBorderStyle, UiTextAlign, UiTextOverflow} from "../../engine/ui/layout/flexStyle";
import {UiBox} from "../../engine/ui/uiBox";
import {UiDrawList} from "../../engine/ui/uiDrawList";
import {UiLayout} from "../../engine/ui/uiLayout";
import {UiRoot} from "../../engine/ui/uiRoot";
import {UiScaleSnapping} from "../../engine/ui/uiScaleSnapping";
import {UiScroll} from "../../engine/ui/uiScroll";
import {UiSize} from "../../engine/ui/uiSize";
import {UiText} from "../../engine/ui/uiText";
import {MemoryPixelPresenter} from "./memoryPixelPresenter";
import {RGBA_BYTES_PER_PIXEL} from "./pixelFrame";
import type {PixelFrame} from "./pixelFrame";
import {OPAQUE_ALPHA, PixelFramebuffer, TRANSPARENT_ALPHA} from "./pixelFramebuffer";
import {DRAWN_TILE_SIZE_PX} from "./pixelDrawnTiles";
import {installPixelsBackend} from "./pixelsBackend";
import {PIXELS_HUD_TEXT_PASSES} from "./pixelsHudTextPasses";
import {PIXELS_UI_PASSES} from "./pixelsUiPasses";
import {PixelRenderSettings} from "./pixelRenderSettings";

const SIZE = {widthPx: 240, heightPx: 160};
const UNIT_WIDTH_PX = 8, UNIT_HEIGHT_PX = 16;
const PANEL_WIDTH = 10;
const PANEL_HEIGHT = 6;
const BORDER_COLUMNS = 2;
const CONTENT_WIDTH = PANEL_WIDTH - BORDER_COLUMNS;
const SETTLE_STEPS = 3;
const SCALED = 1.5;
const SCALED_UNIT_WIDTH_PX = 12, SCALED_UNIT_HEIGHT_PX = 24;
const UNSNAPPED_SCALE = 1.4;
const SNAPPED_UNIT_WIDTH_PX = 11;
const PIXELS_PER_SCREEN_UNIT_X = 8;
const SMALLER_PIXELS_PER_SCREEN_UNIT_X = 5;
const SMALLER_SNAPPED_UNIT_WIDTH_PX = 7;
const WIDE_TEXT_ROW = 4;
const ELLIPSIS_ROW = 3;
const LAST_HELLO_COLUMN = 5;
const PROBE_PX = 40;
const RED_SHIFT = 16, GREEN_SHIFT = 8;
const ALPHA_BYTE = 3;
const DRAWN = 1;
const HUD_LINE = "Z".repeat(PANEL_WIDTH + BORDER_COLUMNS);

const BACKGROUND_RGB = 0x000000;
const BLUE_RGB = resolveTextColorRgb(TextColor.BLUE, BACKGROUND_RGB);
const YELLOW_RGB = resolveTextColorRgb(TextColor.YELLOW, BACKGROUND_RGB);
const CYAN_RGB = resolveTextColorRgb(TextColor.CYAN, BACKGROUND_RGB);
const RED_RGB = resolveTextColorRgb(TextColor.RED, BACKGROUND_RGB);
const MAGENTA_RGB = resolveTextColorRgb(TextColor.MAGENTA, BACKGROUND_RGB);
const BORDER_RGB = resolveTextColorRgb(TextColor.BRIGHT_WHITE, BACKGROUND_RGB);
const THUMB_RGB = resolveTextColorRgb(TextColor.WHITE, BACKGROUND_RGB);
const TRACK_RGB = resolveTextColorRgb(TextColor.BRIGHT_BLACK, BACKGROUND_RGB);

interface Rendered {
    readonly frame: PixelFrame;
    readonly world: World;
}

function rgbAt(frame: PixelFrame, x: number, y: number): number {
    const i = (y * frame.widthPx + x) * RGBA_BYTES_PER_PIXEL;
    return (frame.rgba[i] << RED_SHIFT) | (frame.rgba[i + 1] << GREEN_SHIFT) | frame.rgba[i + 2];
}

function alphaAt(frame: PixelFrame, x: number, y: number): number {
    return frame.rgba[(y * frame.widthPx + x) * RGBA_BYTES_PER_PIXEL + ALPHA_BYTE];
}

function glyphMatchesFont(frame: PixelFrame, character: string, left: number, top: number, litRgb: number, unlitRgb: number): boolean {
    const codePoint = character.codePointAt(0)!;
    for (let row = 0; row < UNIT_HEIGHT_PX; row++) {
        const bits = ASCII_PIXEL_FONT.glyphRowBits(codePoint, row);
        for (let column = 0; column < UNIT_WIDTH_PX; column++) {
            const expected = isGlyphColumnLit(bits, column) ? litRgb : unlitRgb;
            if (rgbAt(frame, left + column, top + row) !== expected) return false;
        }
    }
    return true;
}

function rgbsIn(frame: PixelFrame, left: number, top: number, right: number, bottom: number): Set<number> {
    const colours = new Set<number>();
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) colours.add(rgbAt(frame, x, y));
    return colours;
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

function attach(entityManager: EntityManager, parent: Entity, children: readonly Entity[]): void {
    entityManager.addComponent(parent, new Children(...children));
    for (const child of children) entityManager.addComponent(child, new Parent(parent));
}

function topLeftHud(value: string, foreground: TextColor): [TextSprite, HudElement, ScreenAnchor] {
    const sprite = new TextSprite();
    sprite.image = [value];
    sprite.foreground = foreground;
    const anchor = new ScreenAnchor();
    anchor.anchorPosition = "top-left";
    return [sprite, new HudElement(), anchor];
}

function uiRoot(scale: number): UiRoot {
    const root = new UiRoot();
    root.scale = scale;
    return root;
}

function render(build: (entityManager: EntityManager) => void, overlaysScene: boolean = false): Rendered {
    const presenter = Object.assign(new MemoryPixelPresenter(SIZE), {overlaysScene});
    const world = new World({platform: new MemoryPlatform()});
    installPixelsBackend(world, presenter, [...PIXELS_HUD_TEXT_PASSES, ...PIXELS_UI_PASSES]);
    world.entityManager.createEntity("camera", [new Camera()]);
    build(world.entityManager);
    for (let step = 0; step < SETTLE_STEPS; step++) world.step();
    return {frame: presenter.lastFrame!, world};
}

function renderPanel(border: UiBorderStyle = "single", scale: number = 1): Rendered {
    return render(em => {
        em.createEntity("hud", topLeftHud(HUD_LINE, TextColor.MAGENTA));
        const rootLayout = new UiLayout();
        rootLayout.align = "start";
        const root = em.createEntity("root", [uiRoot(scale), rootLayout]);
        const panelLayout = new UiLayout();
        panelLayout.align = "start";
        panelLayout.clip = true;
        const box = new UiBox();
        box.background = TextColor.BLUE;
        box.border = border;
        box.borderColor = TextColor.BRIGHT_WHITE;
        const panel = em.createEntity("panel", [panelLayout, fixedWidth(PANEL_WIDTH), box]);
        attach(em, root, [panel]);
        attach(em, panel, [
            em.createEntity("hello", [text("Hello", TextColor.YELLOW)]),
            em.createEntity("centred", [text("ab", TextColor.GREEN, "center"), fixedWidth(CONTENT_WIDTH)]),
            em.createEntity("ellipsis", [text("abcdefghijkl", TextColor.CYAN, "start", "ellipsis"), fixedWidth(CONTENT_WIDTH)]),
            em.createEntity("wide", [text("0123456789ABCDEF", TextColor.RED)]),
        ]);
    });
}

describe("UiPixelPassSystem", () => {
    test("at scale 1 a UI unit is one 8x16 screen unit and glyphs are the font's pixels over the box colour", () => {
        const {frame} = renderPanel();
        expect(glyphMatchesFont(frame, "H", UNIT_WIDTH_PX, UNIT_HEIGHT_PX, YELLOW_RGB, BLUE_RGB)).toBe(true);
        expect(glyphMatchesFont(frame, "o", LAST_HELLO_COLUMN * UNIT_WIDTH_PX, UNIT_HEIGHT_PX, YELLOW_RGB, BLUE_RGB)).toBe(true);
        expect(glyphMatchesFont(frame, "…", CONTENT_WIDTH * UNIT_WIDTH_PX, ELLIPSIS_ROW * UNIT_HEIGHT_PX, CYAN_RGB, BLUE_RGB)).toBe(true);
    });

    test("a single border is a one-pixel line centred in each edge unit", () => {
        const {frame} = renderPanel();
        const lineX = 3, lineY = 7;
        const right = PANEL_WIDTH * UNIT_WIDTH_PX - lineX - 1, bottom = PANEL_HEIGHT * UNIT_HEIGHT_PX - lineY - 1;
        expect([rgbAt(frame, lineX - 1, PROBE_PX), rgbAt(frame, lineX, PROBE_PX), rgbAt(frame, lineX + 1, PROBE_PX)]).toEqual([BLUE_RGB, BORDER_RGB, BLUE_RGB]);
        expect([rgbAt(frame, right, PROBE_PX), rgbAt(frame, right + 1, PROBE_PX)]).toEqual([BORDER_RGB, BLUE_RGB]);
        expect([rgbAt(frame, PROBE_PX, lineY - 1), rgbAt(frame, PROBE_PX, lineY), rgbAt(frame, PROBE_PX, lineY + 1)]).toEqual([BLUE_RGB, BORDER_RGB, BLUE_RGB]);
        expect([rgbAt(frame, PROBE_PX, bottom), rgbAt(frame, PROBE_PX, bottom + 1)]).toEqual([BORDER_RGB, BLUE_RGB]);
        expect([rgbAt(frame, lineX, lineY), rgbAt(frame, lineX - 1, lineY), rgbAt(frame, lineX, lineY - 1)]).toEqual([BORDER_RGB, BLUE_RGB, BLUE_RGB]);
    });

    test("a double border is two lines, a thick border one line twice as wide", () => {
        const double = renderPanel("double").frame;
        expect([2, 3, 4, 5, 6].map(x => rgbAt(double, x, PROBE_PX))).toEqual([BORDER_RGB, BLUE_RGB, BLUE_RGB, BORDER_RGB, BLUE_RGB]);
        expect([6, 7, 8, 9, 10].map(y => rgbAt(double, PROBE_PX, y))).toEqual([BORDER_RGB, BLUE_RGB, BLUE_RGB, BORDER_RGB, BLUE_RGB]);
        const thick = renderPanel("thick").frame;
        expect([2, 3, 4, 5].map(x => rgbAt(thick, x, PROBE_PX))).toEqual([BLUE_RGB, BORDER_RGB, BORDER_RGB, BLUE_RGB]);
    });

    test("text wider than its clipping parent stops at the parent's border", () => {
        const {frame} = renderPanel();
        const top = WIDE_TEXT_ROW * UNIT_HEIGHT_PX, bottom = top + UNIT_HEIGHT_PX;
        const clipRight = (PANEL_WIDTH - 1) * UNIT_WIDTH_PX;
        expect(glyphMatchesFont(frame, "7", clipRight - UNIT_WIDTH_PX, top, RED_RGB, BLUE_RGB)).toBe(true);
        expect([...rgbsIn(frame, clipRight, top, PANEL_WIDTH * UNIT_WIDTH_PX, bottom)].sort()).toEqual([BLUE_RGB, BORDER_RGB].sort());
        expect([...rgbsIn(frame, PANEL_WIDTH * UNIT_WIDTH_PX, top, SIZE.widthPx, bottom)]).toEqual([BACKGROUND_RGB]);
    });

    test("UI draws over HUD text at the same place and leaves the HUD beside it", () => {
        const {frame} = renderPanel();
        expect(rgbAt(frame, 0, 0)).toBe(BLUE_RGB);
        expect(glyphMatchesFont(frame, "Z", PANEL_WIDTH * UNIT_WIDTH_PX, 0, MAGENTA_RGB, BACKGROUND_RGB)).toBe(true);
    });

    test("every pixel the UI touches lies in a tile marked drawn", () => {
        const {world} = renderPanel();
        const tiles = world.resources.get(PixelFramebuffer).drawnTiles;
        const columns = Math.ceil(PANEL_WIDTH * UNIT_WIDTH_PX / DRAWN_TILE_SIZE_PX), rows = Math.ceil(PANEL_HEIGHT * UNIT_HEIGHT_PX / DRAWN_TILE_SIZE_PX);
        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) expect(tiles.drawn[row * tiles.columns + column]).toBe(DRAWN);
        }
        expect(tiles.drawn[(tiles.rows - 1) * tiles.columns + tiles.columns - 1]).not.toBe(DRAWN);
    });

    test("at scale 1.5 a UI unit is 12x24 px, glyphs are antialiased and nothing is written outside the clip", () => {
        const {frame, world} = renderPanel("single", SCALED);
        expect(world.resources.get(UiScaleSnapping).effectiveScale(SCALED) * PIXELS_PER_SCREEN_UNIT_X).toBe(SCALED_UNIT_WIDTH_PX);
        const helloEnd = (1 + "Hello".length) * SCALED_UNIT_WIDTH_PX;
        const glyphColours = rgbsIn(frame, SCALED_UNIT_WIDTH_PX, SCALED_UNIT_HEIGHT_PX, helloEnd, 2 * SCALED_UNIT_HEIGHT_PX);
        expect(glyphColours.has(YELLOW_RGB)).toBe(true);
        expect(glyphColours.has(BLUE_RGB)).toBe(true);
        expect([...glyphColours].some(rgb => rgb !== YELLOW_RGB && rgb !== BLUE_RGB)).toBe(true);
        const top = WIDE_TEXT_ROW * SCALED_UNIT_HEIGHT_PX, bottom = top + SCALED_UNIT_HEIGHT_PX;
        const clipRight = (PANEL_WIDTH - 1) * SCALED_UNIT_WIDTH_PX, panelRight = PANEL_WIDTH * SCALED_UNIT_WIDTH_PX;
        expect([...rgbsIn(frame, clipRight, top, panelRight, bottom)].sort()).toEqual([BLUE_RGB, BORDER_RGB].sort());
        expect([...rgbsIn(frame, panelRight, 0, SIZE.widthPx, PANEL_HEIGHT * SCALED_UNIT_HEIGHT_PX)]).toEqual([BACKGROUND_RGB]);
    });

    test("a requested scale snaps to whole pixels per unit", () => {
        const {world} = renderPanel("single", UNSNAPPED_SCALE);
        expect(world.resources.get(UiScaleSnapping).effectiveScale(UNSNAPPED_SCALE)).toBe(SNAPPED_UNIT_WIDTH_PX / PIXELS_PER_SCREEN_UNIT_X);
    });

    test("a changed pixelsPerScreenUnitX snaps the roots again before the next layout", () => {
        const settings = new PixelRenderSettings();
        const {world} = render(em => {
            em.createEntity("settings", [settings]);
            em.createEntity("root", [uiRoot(UNSNAPPED_SCALE), text("A", TextColor.RED)]);
        });
        expect(world.resources.get(UiDrawList).rootScales).toEqual([SNAPPED_UNIT_WIDTH_PX / PIXELS_PER_SCREEN_UNIT_X]);
        settings.pixelsPerScreenUnitX = SMALLER_PIXELS_PER_SCREEN_UNIT_X;
        world.step();
        expect(world.resources.get(UiDrawList).rootScales).toEqual([SMALLER_SNAPPED_UNIT_WIDTH_PX / SMALLER_PIXELS_PER_SCREEN_UNIT_X]);
    });

    test("on a transparent overlay antialiased text keeps its colour and blends its alpha", () => {
        const overlaysScene = true;
        const {frame} = render(em => {
            em.createEntity("root", [uiRoot(SCALED), text("A", TextColor.RED)]);
        }, overlaysScene);
        const alphas = new Set<number>();
        for (let y = 0; y < SCALED_UNIT_HEIGHT_PX; y++) {
            for (let x = 0; x < SCALED_UNIT_WIDTH_PX; x++) {
                const alpha = alphaAt(frame, x, y);
                alphas.add(alpha);
                if (alpha !== TRANSPARENT_ALPHA) expect(rgbAt(frame, x, y)).toBe(RED_RGB);
            }
        }
        expect(alphas.has(OPAQUE_ALPHA)).toBe(true);
        expect([...alphas].some(alpha => alpha !== TRANSPARENT_ALPHA && alpha !== OPAQUE_ALPHA)).toBe(true);
    });
    test("removing the last root clears the UI in the next frame", () => {
        let root: Entity | undefined;
        const {world} = render(em => {
            const box = new UiBox();
            box.background = TextColor.BLUE;
            root = em.createEntity("root", [uiRoot(1), box]);
        });
        expect(rgbsIn(world.resources.get(PixelFramebuffer).toPixelFrame(), 0, 0, SIZE.widthPx, SIZE.heightPx).has(BLUE_RGB)).toBe(true);
        world.entityManager.destroyEntity(root!);
        world.step();
        expect(rgbsIn(world.resources.get(PixelFramebuffer).toPixelFrame(), 0, 0, SIZE.widthPx, SIZE.heightPx).has(BLUE_RGB)).toBe(false);
    });

    test("an overflowing scroll region fills its thumb and track units in its last column", () => {
        const {frame} = render(em => {
            const rootLayout = new UiLayout();
            rootLayout.align = "start";
            const root = em.createEntity("root", [uiRoot(1), rootLayout]);
            const size = fixedWidth(PANEL_WIDTH);
            size.heightMode = "fixed";
            size.height = PANEL_HEIGHT;
            const list = em.createEntity("list", [new UiScroll(), size]);
            attach(em, root, [list]);
            const rows: Entity[] = [];
            for (let i = 0; i < PANEL_HEIGHT * 2; i++) rows.push(em.createEntity(`row${i}`, [text(`item ${i}`, TextColor.YELLOW)]));
            attach(em, list, rows);
        });
        const barLeft = (PANEL_WIDTH - 1) * UNIT_WIDTH_PX, thumbBottom = PANEL_HEIGHT / 2 * UNIT_HEIGHT_PX;
        const barRight = PANEL_WIDTH * UNIT_WIDTH_PX, trackBottom = PANEL_HEIGHT * UNIT_HEIGHT_PX;
        expect([...rgbsIn(frame, barLeft, 0, barRight, thumbBottom)]).toEqual([THUMB_RGB]);
        expect([...rgbsIn(frame, barLeft, thumbBottom, barRight, trackBottom)]).toEqual([TRACK_RGB]);
        expect([...rgbsIn(frame, barLeft - UNIT_WIDTH_PX, 0, barLeft, trackBottom)]).toEqual([BACKGROUND_RGB]);
        expect(glyphMatchesFont(frame, "i", 0, 0, YELLOW_RGB, BACKGROUND_RGB)).toBe(true);
    });
});
