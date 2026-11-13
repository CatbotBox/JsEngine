import type {CssColors} from "./canvasCellColors";
import type {CanvasGlyphAtlasCanvas, CanvasGlyphContext} from "./canvasCellSurface";

export const GLYPH_ATLAS_SLOT_COLUMNS = 64;
export const GLYPH_ATLAS_SLOT_ROWS = 32;
export const GLYPH_ATLAS_CAPACITY_GLYPHS = GLYPH_ATLAS_SLOT_COLUMNS * GLYPH_ATLAS_SLOT_ROWS;

const KEY_RGB_RANGE = 0x1000000;
const ALPHABETIC_BASELINE = "alphabetic";

export interface CanvasCellGeometry {
    readonly cellWidthDevicePx: number;
    readonly cellHeightDevicePx: number;
    readonly topHalfHeightDevicePx: number;
    readonly baselineDevicePx: number;
    readonly font: string;
}

function keyOf(codePoint: number, rgb: number): number {
    return codePoint * KEY_RGB_RANGE + rgb;
}

export class CanvasGlyphAtlas<Image> {
    private readonly slots = new Map<number, number>();
    private readonly context: CanvasGlyphContext;
    private nextSlot = 0;

    public constructor(
        public readonly canvas: Image & CanvasGlyphAtlasCanvas,
        private readonly geometry: CanvasCellGeometry,
        private readonly colors: CssColors,
    ) {
        canvas.width = GLYPH_ATLAS_SLOT_COLUMNS * geometry.cellWidthDevicePx;
        canvas.height = GLYPH_ATLAS_SLOT_ROWS * geometry.cellHeightDevicePx;
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("CanvasGlyphAtlas: the atlas canvas has no 2D context");
        context.font = geometry.font;
        context.textBaseline = ALPHABETIC_BASELINE;
        this.context = context;
    }

    public full(): boolean {
        return this.nextSlot >= GLYPH_ATLAS_CAPACITY_GLYPHS;
    }

    public tryCache(codePoint: number, rgb: number): boolean {
        const key = keyOf(codePoint, rgb);
        if (this.slots.has(key)) return true;
        if (this.full()) return false;
        this.rasterizeNew(key, codePoint, rgb);
        return true;
    }

    public slotFor(codePoint: number, rgb: number): number {
        const key = keyOf(codePoint, rgb);
        const cached = this.slots.get(key);
        if (cached !== undefined) return cached;
        if (this.full()) this.reset();
        return this.rasterizeNew(key, codePoint, rgb);
    }

    public reset(): void {
        this.slots.clear();
        this.nextSlot = 0;
    }

    public slotX(slot: number): number {
        return (slot % GLYPH_ATLAS_SLOT_COLUMNS) * this.geometry.cellWidthDevicePx;
    }

    public slotY(slot: number): number {
        return Math.floor(slot / GLYPH_ATLAS_SLOT_COLUMNS) * this.geometry.cellHeightDevicePx;
    }

    private rasterizeNew(key: number, codePoint: number, rgb: number): number {
        const slot = this.nextSlot++;
        this.slots.set(key, slot);
        const context = this.context;
        const {cellWidthDevicePx: width, cellHeightDevicePx: height, baselineDevicePx} = this.geometry;
        const x = this.slotX(slot), y = this.slotY(slot);
        context.clearRect(x, y, width, height);
        context.save();
        context.beginPath();
        context.rect(x, y, width, height);
        context.clip();
        context.fillStyle = this.colors.get(rgb);
        context.fillText(String.fromCodePoint(codePoint), x, y + baselineDevicePx);
        context.restore();
        return slot;
    }
}
