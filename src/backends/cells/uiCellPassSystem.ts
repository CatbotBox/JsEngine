import {System} from "../../engine/core";
import type {RenderPassKind} from "../../engine/rendering/renderPasses";
import type {TextColor} from "../../engine/rendering/textColor";
import {glyphColumnsOf} from "../../engine/ui/text/textColumns";
import {
    UI_BORDER_DOUBLE,
    UI_BORDER_SINGLE,
    UI_BORDER_THICK,
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
} from "../../engine/ui/uiDrawList";
import {UiDrawListSystem} from "../../engine/ui/uiDrawListSystem";
import {UiLayoutSystem} from "../../engine/ui/uiLayoutSystem";
import {UiRoot} from "../../engine/ui/uiRoot";
import {UiScaleSnapping} from "../../engine/ui/uiScaleSnapping";
import type {UiScaleRule} from "../../engine/ui/uiScaleSnapping";
import {SnappedUiRect, snappedUiEdge} from "../../engine/ui/uiSnapping";
import {CellGrid} from "./cellGrid";
import type {ScreenBuffer} from "./cellGrid";
import {CellRenderSystemGroup} from "./cellRenderSystemGroup";

const PRIORITY_AFTER_HUD_TEXT = 101;
const UI_DEPTH = -Infinity;
const CELLS_PER_UI_UNIT = 1;

export const CELL_UI_SCALE_RULE: UiScaleRule = {
    effectiveScale: () => CELLS_PER_UI_UNIT,
};

interface BoxGlyphs {
    readonly horizontal: number;
    readonly vertical: number;
    readonly topLeft: number;
    readonly topRight: number;
    readonly bottomLeft: number;
    readonly bottomRight: number;
}

const SINGLE_BOX_GLYPHS: BoxGlyphs = {horizontal: 0x2500, vertical: 0x2502, topLeft: 0x250C, topRight: 0x2510, bottomLeft: 0x2514, bottomRight: 0x2518};
const DOUBLE_BOX_GLYPHS: BoxGlyphs = {horizontal: 0x2550, vertical: 0x2551, topLeft: 0x2554, topRight: 0x2557, bottomLeft: 0x255A, bottomRight: 0x255D};
const THICK_BOX_GLYPHS: BoxGlyphs = {horizontal: 0x2501, vertical: 0x2503, topLeft: 0x250F, topRight: 0x2513, bottomLeft: 0x2517, bottomRight: 0x251B};

function boxGlyphsOf(border: number): BoxGlyphs | undefined {
    switch (border) {
        case UI_BORDER_SINGLE:
            return SINGLE_BOX_GLYPHS;
        case UI_BORDER_DOUBLE:
            return DOUBLE_BOX_GLYPHS;
        case UI_BORDER_THICK:
            return THICK_BOX_GLYPHS;
        default:
            return undefined;
    }
}

export class UiCellPassSystem extends System {
    public static readonly renderPass: RenderPassKind = "ui";

    private readonly _roots = this.createEntityQuery([UiRoot]);
    private readonly _clip = new SnappedUiRect();
    private readonly _rect = new SnappedUiRect();

    override systemGroup() {
        return CellRenderSystemGroup;
    }

    override priority(): number {
        return PRIORITY_AFTER_HUD_TEXT;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._roots);
        this.world.resources.getOrCreate(UiScaleSnapping).use(CELL_UI_SCALE_RULE);
        this.world.ensureSystemExists(UiLayoutSystem);
        this.world.ensureSystemExists(UiDrawListSystem);
    }

    onUpdate() {
        const grid = this.world.resources.tryGet(CellGrid);
        const list = this.world.resources.tryGet(UiDrawList);
        if (grid === undefined || list === undefined) return;
        const screen = grid.screenBuffer;
        const kinds = list.kinds, roots = list.roots, geometry = list.geometry, scales = list.rootScales;
        for (let command = 0; command < list.count; command++) {
            const base = command * UI_DRAW_FLOATS;
            const unit = scales[roots[command]];
            const clip = this._clip.snapEdges(
                geometry[base + UI_DRAW_CLIP_LEFT], geometry[base + UI_DRAW_CLIP_TOP],
                geometry[base + UI_DRAW_CLIP_RIGHT], geometry[base + UI_DRAW_CLIP_BOTTOM], unit, unit,
            ).clampTo(screen.cellWidth, screen.cellHeight);
            if (clip.isEmpty) continue;
            const color = list.colors[command] as TextColor;
            const kind = kinds[command];
            if (kind === UI_DRAW_TEXT) {
                this.drawText(screen, list, command, unit, color);
                continue;
            }
            const rect = this._rect.snapRect(geometry[base + UI_DRAW_X], geometry[base + UI_DRAW_Y], geometry[base + UI_DRAW_WIDTH], geometry[base + UI_DRAW_HEIGHT], unit, unit);
            if (kind === UI_DRAW_FILL) this.fill(screen, rect, color);
            else if (kind === UI_DRAW_BORDER) this.drawBorder(screen, rect, boxGlyphsOf(list.borders[command]), color);
        }
    }

    private fill(screen: ScreenBuffer, rect: SnappedUiRect, color: TextColor): void {
        const area = rect.intersect(this._clip);
        for (let y = area.top; y < area.bottom; y++) {
            for (let x = area.left; x < area.right; x++) screen.fillBackground(x, y, UI_DEPTH, color);
        }
    }

    private drawBorder(screen: ScreenBuffer, rect: SnappedUiRect, glyphs: BoxGlyphs | undefined, color: TextColor): void {
        if (glyphs === undefined || rect.isEmpty) return;
        const clip = this._clip;
        const left = rect.left, top = rect.top, right = rect.right - 1, bottom = rect.bottom - 1;
        const firstX = Math.max(left + 1, clip.left), endX = Math.min(right, clip.right);
        for (let x = firstX; x < endX; x++) {
            this.putGlyph(screen, x, top, glyphs.horizontal, color);
            this.putGlyph(screen, x, bottom, glyphs.horizontal, color);
        }
        const firstY = Math.max(top + 1, clip.top), endY = Math.min(bottom, clip.bottom);
        for (let y = firstY; y < endY; y++) {
            this.putGlyph(screen, left, y, glyphs.vertical, color);
            this.putGlyph(screen, right, y, glyphs.vertical, color);
        }
        this.putGlyph(screen, left, top, glyphs.topLeft, color);
        this.putGlyph(screen, right, top, glyphs.topRight, color);
        this.putGlyph(screen, left, bottom, glyphs.bottomLeft, color);
        this.putGlyph(screen, right, bottom, glyphs.bottomRight, color);
    }

    private drawText(screen: ScreenBuffer, list: UiDrawList, command: number, unit: number, color: TextColor): void {
        const base = command * UI_DRAW_FLOATS, geometry = list.geometry, glyphs = list.glyphs;
        const x = geometry[base + UI_DRAW_X];
        const y = snappedUiEdge(geometry[base + UI_DRAW_Y], unit);
        const start = list.glyphStarts[command], end = start + list.glyphCounts[command];
        let column = 0;
        for (let glyph = start; glyph < end; glyph++) {
            this.putGlyph(screen, snappedUiEdge(x + column, unit), y, glyphs[glyph], color);
            column += glyphColumnsOf(glyphs[glyph]);
        }
    }

    private putGlyph(screen: ScreenBuffer, x: number, y: number, glyph: number, color: TextColor): void {
        const clip = this._clip;
        if (x < clip.left || x >= clip.right || y < clip.top || y >= clip.bottom) return;
        screen.setGlyphOverBackground(x, y, UI_DEPTH, glyph, color);
    }
}
