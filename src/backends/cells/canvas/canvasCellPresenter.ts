import {TextColor} from "../../../engine/rendering/textColor";
import {CellKind, NO_COLOR} from "../cellFrame";
import type {CellBackgroundStyle, CellFrame} from "../cellFrame";
import type {CellPresenter, CellPresenterSize, CellRepaint} from "../cellPresenter";
import {CssColors, textColorRgb, THEME_BACKGROUND_RGB, THEME_FOREGROUND_RGB} from "./canvasCellColors";
import {CanvasGlyphAtlas} from "./canvasGlyphAtlas";
import type {CanvasCellGeometry} from "./canvasGlyphAtlas";
import type {CanvasCellContext, CanvasCellSurface, CanvasGlyphAtlasCanvas} from "./canvasCellSurface";

export interface CanvasCellFont {
    readonly family: string;
    readonly sizeCssPx: number;
}

export const DEFAULT_CANVAS_CELL_FONT: CanvasCellFont = Object.freeze({
    family: `ui-monospace, "Cascadia Mono", Consolas, monospace`,
    sizeCssPx: 15,
});

export interface CanvasCellPresenterOptions<Image> {
    readonly canvas: CanvasCellSurface;
    readonly context: CanvasCellContext<Image>;
    readonly atlasCanvas: Image & CanvasGlyphAtlasCanvas;
    readonly devicePixelRatio: number;
    readonly font?: CanvasCellFont;
}

const MEASURED_TEXT = "M";
const FALLBACK_WIDTH_PER_EM = 0.6;
const FALLBACK_ASCENT_PER_EM = 0.8;
const FALLBACK_DESCENT_PER_EM = 0.2;
const MIN_CELL_DEVICE_PX = 1;
const HALVES_PER_CELL = 2;

const FILL_STYLE_UNKNOWN = -1;
const NO_GLYPH = -1;
const NO_RUN = -1;
const SPACE_CODE_POINT = 0x20;
const UPPER_HALF_BLOCK_CODE_POINT = 0x2580;
const LOWER_HALF_BLOCK_CODE_POINT = 0x2584;
const FULL_BLOCK_CODE_POINT = 0x2588;
const FIRST_PRINTABLE_CODE_POINT = 0x20;
const DELETE_CODE_POINT = 0x7F;
const FIRST_CODE_POINT_AFTER_C1_CONTROLS = 0xA0;
const MAX_CODE_POINT = 0x10FFFF;
const REPLACEMENT_CHARACTER_CODE_POINT = 0xFFFD;

interface StoredFrame {
    width: number;
    height: number;
    kind: Uint8Array;
    glyph: Uint32Array;
    foreground: Uint32Array;
    background: Uint32Array;
    rgb: Int32Array;
    rgbTop: Int32Array;
    backgroundStyle: {glyph: number, foreground: TextColor, background: TextColor};
}

function positiveOr(value: number | undefined, fallback: number): number {
    return value !== undefined && value > 0 ? value : fallback;
}

function drawableGlyph(codePoint: number): number {
    if (codePoint === SPACE_CODE_POINT) return NO_GLYPH;
    if (codePoint < FIRST_PRINTABLE_CODE_POINT
        || (codePoint >= DELETE_CODE_POINT && codePoint < FIRST_CODE_POINT_AFTER_C1_CONTROLS)
        || codePoint > MAX_CODE_POINT) {
        return REPLACEMENT_CHARACTER_CODE_POINT;
    }
    return codePoint;
}

function sameBackgroundStyle(stored: StoredFrame["backgroundStyle"], style: CellBackgroundStyle): boolean {
    return stored.glyph === style.glyph && stored.foreground === style.foreground && stored.background === style.background;
}

function cellChanged(frame: CellFrame, previous: StoredFrame, index: number): boolean {
    const kind = frame.kind[index];
    if (kind !== previous.kind[index]) return true;
    switch (kind) {
        case CellKind.Background:
            return false;
        case CellKind.Rgb:
            return frame.rgb[index] !== previous.rgb[index];
        case CellKind.RgbSplit:
            return frame.rgb[index] !== previous.rgb[index] || frame.rgbTop[index] !== previous.rgbTop[index];
        default:
            return frame.glyph[index] !== previous.glyph[index]
                || frame.foreground[index] !== previous.foreground[index]
                || frame.background[index] !== previous.background[index];
    }
}

export class CanvasCellPresenter<Image> implements CellPresenter {
    private readonly canvas: CanvasCellSurface;
    private readonly context: CanvasCellContext<Image>;
    private readonly atlasCanvas: Image & CanvasGlyphAtlasCanvas;
    private readonly font: CanvasCellFont;
    private readonly cellWidthCssPx: number;
    private readonly cellAscentCssPx: number;
    private readonly cellDescentCssPx: number;
    private readonly colors = new CssColors();
    private readonly resizeListeners = new Set<() => void>();

    private ratio: number;
    private geometry: CanvasCellGeometry;
    private atlas: CanvasGlyphAtlas<Image>;
    private columns = 0;
    private rows = 0;
    private fillStyleRgb = FILL_STYLE_UNKNOWN;
    private stored: StoredFrame | undefined;

    private glyphCells = new Int32Array(0);
    private glyphCodePoints = new Int32Array(0);
    private glyphColors = new Int32Array(0);

    private styleBackgroundRgb = THEME_BACKGROUND_RGB;
    private styleTop = THEME_BACKGROUND_RGB;
    private styleBottom = THEME_BACKGROUND_RGB;
    private styleGlyph = NO_GLYPH;
    private styleGlyphRgb = THEME_FOREGROUND_RGB;

    private cellTop = THEME_BACKGROUND_RGB;
    private cellBottom = THEME_BACKGROUND_RGB;
    private cellGlyph = NO_GLYPH;
    private cellGlyphRgb = THEME_FOREGROUND_RGB;

    public constructor(options: CanvasCellPresenterOptions<Image>) {
        this.canvas = options.canvas;
        this.context = options.context;
        this.atlasCanvas = options.atlasCanvas;
        this.font = options.font ?? DEFAULT_CANVAS_CELL_FONT;
        const sizeCssPx = this.font.sizeCssPx;
        this.context.font = `${sizeCssPx}px ${this.font.family}`;
        const metrics = this.context.measureText(MEASURED_TEXT);
        this.cellWidthCssPx = positiveOr(metrics.width, sizeCssPx * FALLBACK_WIDTH_PER_EM);
        this.cellAscentCssPx = positiveOr(metrics.fontBoundingBoxAscent, sizeCssPx * FALLBACK_ASCENT_PER_EM);
        this.cellDescentCssPx = positiveOr(metrics.fontBoundingBoxDescent, sizeCssPx * FALLBACK_DESCENT_PER_EM);
        this.ratio = options.devicePixelRatio;
        this.geometry = this.geometryFor(this.ratio);
        this.atlas = new CanvasGlyphAtlas(this.atlasCanvas, this.geometry, this.colors);
    }

    public get devicePixelRatio(): number {
        return this.ratio;
    }

    public get cellWidthDevicePx(): number {
        return this.geometry.cellWidthDevicePx;
    }

    public get cellHeightDevicePx(): number {
        return this.geometry.cellHeightDevicePx;
    }

    public size(): CellPresenterSize {
        return {columns: this.columns, rows: this.rows};
    }

    public onResize(listener: () => void): () => void {
        const entry = () => listener();
        this.resizeListeners.add(entry);
        return () => {
            this.resizeListeners.delete(entry);
        };
    }

    public start(): void {
    }

    public stop(): void {
    }

    public setDevicePixelRatio(ratio: number): void {
        if (ratio === this.ratio) return;
        this.ratio = ratio;
        this.geometry = this.geometryFor(ratio);
        this.atlas = new CanvasGlyphAtlas(this.atlasCanvas, this.geometry, this.colors);
        this.applyCanvasSize();
    }

    public resize(columns: number, rows: number): void {
        if (columns === this.columns && rows === this.rows) return;
        this.columns = columns;
        this.rows = rows;
        this.applyCanvasSize();
        for (const listener of [...this.resizeListeners]) listener();
    }

    public present(frame: CellFrame, repaint: CellRepaint = "changes"): void {
        if (!this.paint(frame, this.repaintFor(frame, repaint))) {
            this.atlas.reset();
            this.paint(frame, "full");
        }
        this.remember(frame);
    }

    private repaintFor(frame: CellFrame, requested: CellRepaint): CellRepaint {
        const stored = this.stored;
        if (requested === "full" || stored === undefined) return "full";
        if (stored.width !== frame.width || stored.height !== frame.height) return "full";
        return sameBackgroundStyle(stored.backgroundStyle, frame.backgroundStyle) ? "changes" : "full";
    }

    private paint(frame: CellFrame, repaint: CellRepaint): boolean {
        const full = repaint === "full";
        if (full) this.clearCanvas();
        this.useBackgroundStyle(frame.backgroundStyle);
        const glyphCount = this.fillCells(frame, full ? undefined : this.stored);
        if (!this.cacheGlyphs(glyphCount) && !full) return false;
        this.drawGlyphs(frame.width, glyphCount);
        return true;
    }

    private geometryFor(ratio: number): CanvasCellGeometry {
        const cellWidthDevicePx = Math.max(MIN_CELL_DEVICE_PX, Math.round(this.cellWidthCssPx * ratio));
        const cellHeightDevicePx = Math.max(MIN_CELL_DEVICE_PX, Math.round((this.cellAscentCssPx + this.cellDescentCssPx) * ratio));
        return {
            cellWidthDevicePx,
            cellHeightDevicePx,
            topHalfHeightDevicePx: Math.floor(cellHeightDevicePx / HALVES_PER_CELL),
            baselineDevicePx: Math.round(this.cellAscentCssPx * ratio),
            font: `${this.font.sizeCssPx * ratio}px ${this.font.family}`,
        };
    }

    private applyCanvasSize(): void {
        this.canvas.width = this.columns * this.geometry.cellWidthDevicePx;
        this.canvas.height = this.rows * this.geometry.cellHeightDevicePx;
        this.fillStyleRgb = FILL_STYLE_UNKNOWN;
        if (this.stored !== undefined) this.present(this.stored, "full");
    }

    private setFill(rgb: number): void {
        if (rgb === this.fillStyleRgb) return;
        this.fillStyleRgb = rgb;
        this.context.fillStyle = this.colors.get(rgb);
    }

    private clearCanvas(): void {
        this.setFill(THEME_BACKGROUND_RGB);
        this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    private describeText(codePoint: number, foregroundRgb: number, backgroundRgb: number): void {
        this.cellGlyph = NO_GLYPH;
        this.cellGlyphRgb = foregroundRgb;
        switch (codePoint) {
            case UPPER_HALF_BLOCK_CODE_POINT:
                this.cellTop = foregroundRgb;
                this.cellBottom = backgroundRgb;
                return;
            case LOWER_HALF_BLOCK_CODE_POINT:
                this.cellTop = backgroundRgb;
                this.cellBottom = foregroundRgb;
                return;
            case FULL_BLOCK_CODE_POINT:
                this.cellTop = foregroundRgb;
                this.cellBottom = foregroundRgb;
                return;
            default:
                this.cellTop = backgroundRgb;
                this.cellBottom = backgroundRgb;
                this.cellGlyph = drawableGlyph(codePoint);
        }
    }

    private useBackgroundStyle(style: CellBackgroundStyle): void {
        this.styleBackgroundRgb = textColorRgb(style.background, THEME_BACKGROUND_RGB);
        this.describeText(style.glyph, textColorRgb(style.foreground, THEME_FOREGROUND_RGB), this.styleBackgroundRgb);
        this.styleTop = this.cellTop;
        this.styleBottom = this.cellBottom;
        this.styleGlyph = this.cellGlyph;
        this.styleGlyphRgb = this.cellGlyphRgb;
    }

    private describeCell(frame: CellFrame, index: number): void {
        switch (frame.kind[index]) {
            case CellKind.Background:
                this.cellTop = this.styleTop;
                this.cellBottom = this.styleBottom;
                this.cellGlyph = this.styleGlyph;
                this.cellGlyphRgb = this.styleGlyphRgb;
                return;
            case CellKind.Rgb: {
                const rgb = frame.rgb[index];
                this.cellTop = this.cellBottom = rgb === NO_COLOR ? this.styleBackgroundRgb : rgb;
                this.cellGlyph = NO_GLYPH;
                return;
            }
            case CellKind.RgbSplit: {
                const top = frame.rgbTop[index], bottom = frame.rgb[index];
                this.cellTop = top === NO_COLOR ? this.styleBackgroundRgb : top;
                this.cellBottom = bottom === NO_COLOR ? this.styleBackgroundRgb : bottom;
                this.cellGlyph = NO_GLYPH;
                return;
            }
            default:
                this.describeText(
                    frame.glyph[index],
                    textColorRgb(frame.foreground[index], THEME_FOREGROUND_RGB),
                    textColorRgb(frame.background[index], THEME_BACKGROUND_RGB),
                );
        }
    }

    private ensureGlyphCapacity(cellCount: number): void {
        if (this.glyphCells.length >= cellCount) return;
        this.glyphCells = new Int32Array(cellCount);
        this.glyphCodePoints = new Int32Array(cellCount);
        this.glyphColors = new Int32Array(cellCount);
    }

    private fillCells(frame: CellFrame, previous: StoredFrame | undefined): number {
        const {width, height} = frame;
        this.ensureGlyphCapacity(width * height);
        const glyphCells = this.glyphCells, glyphCodePoints = this.glyphCodePoints, glyphColors = this.glyphColors;
        let glyphCount = 0;
        for (let row = 0; row < height; row++) {
            const rowStart = row * width;
            let runStart = NO_RUN;
            let runTop = 0, runBottom = 0;
            for (let column = 0; column < width; column++) {
                const index = rowStart + column;
                if (previous !== undefined && !cellChanged(frame, previous, index)) {
                    if (runStart !== NO_RUN) this.fillRun(runStart, column, row, runTop, runBottom);
                    runStart = NO_RUN;
                    continue;
                }
                this.describeCell(frame, index);
                const top = this.cellTop, bottom = this.cellBottom;
                if (runStart === NO_RUN || top !== runTop || bottom !== runBottom) {
                    if (runStart !== NO_RUN) this.fillRun(runStart, column, row, runTop, runBottom);
                    runStart = column;
                    runTop = top;
                    runBottom = bottom;
                }
                if (this.cellGlyph !== NO_GLYPH) {
                    glyphCells[glyphCount] = index;
                    glyphCodePoints[glyphCount] = this.cellGlyph;
                    glyphColors[glyphCount] = this.cellGlyphRgb;
                    glyphCount++;
                }
            }
            if (runStart !== NO_RUN) this.fillRun(runStart, width, row, runTop, runBottom);
        }
        return glyphCount;
    }

    private fillRun(fromColumn: number, toColumn: number, row: number, topRgb: number, bottomRgb: number): void {
        const {cellWidthDevicePx, cellHeightDevicePx, topHalfHeightDevicePx} = this.geometry;
        const x = fromColumn * cellWidthDevicePx;
        const y = row * cellHeightDevicePx;
        const width = (toColumn - fromColumn) * cellWidthDevicePx;
        const context = this.context;
        this.setFill(topRgb);
        if (topRgb === bottomRgb) {
            context.fillRect(x, y, width, cellHeightDevicePx);
            return;
        }
        context.fillRect(x, y, width, topHalfHeightDevicePx);
        this.setFill(bottomRgb);
        context.fillRect(x, y + topHalfHeightDevicePx, width, cellHeightDevicePx - topHalfHeightDevicePx);
    }

    private cacheGlyphs(glyphCount: number): boolean {
        const atlas = this.atlas, glyphCodePoints = this.glyphCodePoints, glyphColors = this.glyphColors;
        for (let i = 0; i < glyphCount; i++) {
            if (!atlas.tryCache(glyphCodePoints[i], glyphColors[i])) return false;
        }
        return true;
    }

    private drawGlyphs(frameWidth: number, glyphCount: number): void {
        const atlas = this.atlas, context = this.context;
        const {cellWidthDevicePx: cellWidth, cellHeightDevicePx: cellHeight} = this.geometry;
        const glyphCells = this.glyphCells, glyphCodePoints = this.glyphCodePoints, glyphColors = this.glyphColors;
        for (let i = 0; i < glyphCount; i++) {
            const slot = atlas.slotFor(glyphCodePoints[i], glyphColors[i]);
            const cell = glyphCells[i];
            const column = cell % frameWidth;
            const row = (cell - column) / frameWidth;
            context.drawImage(atlas.canvas, atlas.slotX(slot), atlas.slotY(slot), cellWidth, cellHeight,
                column * cellWidth, row * cellHeight, cellWidth, cellHeight);
        }
    }

    private remember(frame: CellFrame): void {
        if (frame === this.stored) return;
        const cellCount = frame.width * frame.height;
        let stored = this.stored;
        if (stored === undefined || stored.kind.length !== cellCount) {
            stored = {
                width: frame.width,
                height: frame.height,
                kind: new Uint8Array(cellCount),
                glyph: new Uint32Array(cellCount),
                foreground: new Uint32Array(cellCount),
                background: new Uint32Array(cellCount),
                rgb: new Int32Array(cellCount),
                rgbTop: new Int32Array(cellCount),
                backgroundStyle: {glyph: SPACE_CODE_POINT, foreground: TextColor.DEFAULT, background: TextColor.DEFAULT},
            };
            this.stored = stored;
        }
        stored.width = frame.width;
        stored.height = frame.height;
        stored.kind.set(frame.kind.subarray(0, cellCount));
        stored.glyph.set(frame.glyph.subarray(0, cellCount));
        stored.foreground.set(frame.foreground.subarray(0, cellCount));
        stored.background.set(frame.background.subarray(0, cellCount));
        stored.rgb.set(frame.rgb.subarray(0, cellCount));
        stored.rgbTop.set(frame.rgbTop.subarray(0, cellCount));
        stored.backgroundStyle.glyph = frame.backgroundStyle.glyph;
        stored.backgroundStyle.foreground = frame.backgroundStyle.foreground;
        stored.backgroundStyle.background = frame.backgroundStyle.background;
    }
}
