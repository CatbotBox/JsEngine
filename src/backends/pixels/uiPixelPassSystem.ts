import {System} from "../../engine/core";
import type {RenderPassKind} from "../../engine/rendering/renderPasses";
import {SCREEN_UNIT_HEIGHT_PER_WIDTH} from "../../engine/rendering/screenUnits";
import {FULL_COVERAGE} from "../../engine/rendering/text/glyphSource";
import {PixelFontGlyphSource} from "../../engine/rendering/text/pixelFontGlyphSource";
import type {TextColor} from "../../engine/rendering/textColor";
import {DEFAULT_TEXT_BACKGROUND_RGB, DEFAULT_TEXT_FOREGROUND_RGB, resolveTextColorRgb} from "../../engine/rendering/textColorPalette";
import {glyphColumnsOf} from "../../engine/ui/text/textColumns";
import {
    UI_BORDER_DOUBLE,
    UI_BORDER_NONE,
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
import {SnappedUiRect, snappedUiEdge} from "../../engine/ui/uiSnapping";
import {PixelFramebuffer} from "./pixelFramebuffer";
import {PixelRenderSystemGroup} from "./pixelRenderSystemGroup";
import {uiUnitWidthPx, UiPixelScaleSnappingSystem} from "./uiPixelScaleSnappingSystem";

const PRIORITY_AFTER_HUD_TEXT = 101;
const UI_DEPTH = -Infinity;
const UNIT_WIDTH_PX_PER_LINE_PX = 8;
const MIN_LINE_PX = 1;
const THICK_LINE_FACTOR = 2;
const DOUBLE_LINE_SPAN_FACTOR = 4;
const DOUBLE_LINE_SECOND_OFFSET_FACTOR = 3;
const HALF = 0.5;
const NO_COVERAGE = 0;

function lineThicknessPx(unitWidthPx: number): number {
    return Math.max(MIN_LINE_PX, Math.round(unitWidthPx / UNIT_WIDTH_PX_PER_LINE_PX));
}

function centredOffsetPx(unitPx: number, spanPx: number): number {
    return Math.max(0, Math.floor((unitPx - spanPx) * HALF));
}

export class UiPixelPassSystem extends System {
    public static readonly renderPass: RenderPassKind = "ui";

    private readonly _roots = this.createEntityQuery([UiRoot]);
    private readonly _glyphs = new PixelFontGlyphSource();
    private readonly _clip = new SnappedUiRect();
    private readonly _rect = new SnappedUiRect();
    private readonly _area = new SnappedUiRect();

    override systemGroup() {
        return PixelRenderSystemGroup;
    }

    override priority(): number {
        return PRIORITY_AFTER_HUD_TEXT;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._roots);
        this.world.ensureSystemExists(UiPixelScaleSnappingSystem);
        this.world.ensureSystemExists(UiLayoutSystem);
        this.world.ensureSystemExists(UiDrawListSystem);
    }

    onUpdate() {
        const framebuffer = this.world.resources.tryGet(PixelFramebuffer);
        const list = this.world.resources.tryGet(UiDrawList);
        if (framebuffer === undefined || list === undefined) return;
        const kinds = list.kinds, roots = list.roots, geometry = list.geometry, scales = list.rootScales;
        for (let command = 0; command < list.count; command++) {
            const base = command * UI_DRAW_FLOATS;
            const unitWidthPx = uiUnitWidthPx(scales[roots[command]], framebuffer.pixelsPerScreenUnitX);
            const unitHeightPx = unitWidthPx * SCREEN_UNIT_HEIGHT_PER_WIDTH;
            const clip = this._clip.snapEdges(
                geometry[base + UI_DRAW_CLIP_LEFT], geometry[base + UI_DRAW_CLIP_TOP],
                geometry[base + UI_DRAW_CLIP_RIGHT], geometry[base + UI_DRAW_CLIP_BOTTOM], unitWidthPx, unitHeightPx,
            ).clampTo(framebuffer.widthPx, framebuffer.heightPx);
            if (clip.isEmpty) continue;
            const color = list.colors[command] as TextColor;
            const kind = kinds[command];
            if (kind === UI_DRAW_TEXT) {
                this.drawText(framebuffer, list, command, unitWidthPx, unitHeightPx, resolveTextColorRgb(color, DEFAULT_TEXT_FOREGROUND_RGB));
                continue;
            }
            const rect = this._rect.snapRect(geometry[base + UI_DRAW_X], geometry[base + UI_DRAW_Y], geometry[base + UI_DRAW_WIDTH], geometry[base + UI_DRAW_HEIGHT], unitWidthPx, unitHeightPx);
            if (kind === UI_DRAW_FILL) {
                this.fill(framebuffer, rect.left, rect.top, rect.right, rect.bottom, resolveTextColorRgb(color, DEFAULT_TEXT_BACKGROUND_RGB));
            } else if (kind === UI_DRAW_BORDER) {
                this.drawBorder(framebuffer, list.borders[command], unitWidthPx, unitHeightPx, resolveTextColorRgb(color, DEFAULT_TEXT_FOREGROUND_RGB));
            }
        }
    }

    private drawBorder(framebuffer: PixelFramebuffer, border: number, unitWidthPx: number, unitHeightPx: number, rgb: number): void {
        if (border === UI_BORDER_NONE || this._rect.isEmpty) return;
        const line = lineThicknessPx(unitWidthPx);
        if (border === UI_BORDER_DOUBLE) {
            const firstX = centredOffsetPx(unitWidthPx, DOUBLE_LINE_SPAN_FACTOR * line);
            const firstY = centredOffsetPx(unitHeightPx, DOUBLE_LINE_SPAN_FACTOR * line);
            const step = DOUBLE_LINE_SECOND_OFFSET_FACTOR * line;
            this.drawOutline(framebuffer, firstX, firstY, line, rgb);
            this.drawOutline(framebuffer, firstX + step, firstY + step, line, rgb);
            return;
        }
        const thickness = border === UI_BORDER_THICK ? THICK_LINE_FACTOR * line : line;
        this.drawOutline(framebuffer, centredOffsetPx(unitWidthPx, thickness), centredOffsetPx(unitHeightPx, thickness), thickness, rgb);
    }

    private drawOutline(framebuffer: PixelFramebuffer, insetX: number, insetY: number, thickness: number, rgb: number): void {
        const rect = this._rect;
        const left = rect.left + insetX, right = rect.right - insetX;
        const top = rect.top + insetY, bottom = rect.bottom - insetY;
        if (left >= right || top >= bottom) return;
        this.fill(framebuffer, left, top, right, Math.min(bottom, top + thickness), rgb);
        this.fill(framebuffer, left, Math.max(top, bottom - thickness), right, bottom, rgb);
        this.fill(framebuffer, left, top, Math.min(right, left + thickness), bottom, rgb);
        this.fill(framebuffer, Math.max(left, right - thickness), top, right, bottom, rgb);
    }

    private fill(framebuffer: PixelFramebuffer, left: number, top: number, right: number, bottom: number, rgb: number): void {
        const area = this._area.set(left, top, right, bottom).intersect(this._clip);
        if (area.isEmpty) return;
        framebuffer.markDrawn(area.left, area.top, area.right, area.bottom);
        const widthPx = framebuffer.widthPx;
        for (let y = area.top; y < area.bottom; y++) {
            const rowIndex = y * widthPx;
            for (let x = area.left; x < area.right; x++) framebuffer.writeRgb(rowIndex + x, UI_DEPTH, rgb);
        }
    }

    private drawText(framebuffer: PixelFramebuffer, list: UiDrawList, command: number, unitWidthPx: number, unitHeightPx: number, rgb: number): void {
        const base = command * UI_DRAW_FLOATS, geometry = list.geometry, glyphs = list.glyphs;
        const leftPx = snappedUiEdge(geometry[base + UI_DRAW_X], unitWidthPx);
        const topPx = snappedUiEdge(geometry[base + UI_DRAW_Y], unitHeightPx);
        const start = list.glyphStarts[command], end = start + list.glyphCounts[command];
        let column = 0;
        for (let glyph = start; glyph < end; glyph++) {
            const codePoint = glyphs[glyph];
            this.drawGlyph(framebuffer, codePoint, leftPx + column * unitWidthPx, topPx, unitWidthPx, unitHeightPx, rgb);
            column += glyphColumnsOf(codePoint);
        }
    }

    private drawGlyph(framebuffer: PixelFramebuffer, codePoint: number, boxLeftPx: number, boxTopPx: number, unitWidthPx: number, unitHeightPx: number, rgb: number): void {
        const area = this._area.set(boxLeftPx, boxTopPx, boxLeftPx + unitWidthPx, boxTopPx + unitHeightPx).intersect(this._clip);
        if (area.isEmpty) return;
        framebuffer.markDrawn(area.left, area.top, area.right, area.bottom);
        const coverage = this._glyphs.coverage(codePoint, unitWidthPx, unitHeightPx);
        const widthPx = framebuffer.widthPx;
        for (let y = area.top; y < area.bottom; y++) {
            const rowIndex = y * widthPx, maskRow = (y - boxTopPx) * unitWidthPx - boxLeftPx;
            for (let x = area.left; x < area.right; x++) {
                const covered = coverage[maskRow + x];
                if (covered !== NO_COVERAGE) framebuffer.blendRgb(rowIndex + x, UI_DEPTH, rgb, covered / FULL_COVERAGE);
            }
        }
    }
}
