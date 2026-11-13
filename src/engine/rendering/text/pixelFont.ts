export const MAX_GLYPH_WIDTH_PX = 8;

const MIN_GLYPH_HEIGHT_PX = 1;
const COLUMN_BIT = 1;
const REPLACEMENT_BOX_INSET_PX = 1;
const BOX_SIDES_PER_AXIS = 2;
const EMPTY_ROW_BITS = 0;

export type PixelFontGlyph = readonly [codePoint: number, rowBits: ArrayLike<number>];

export function isGlyphColumnLit(rowBits: number, column: number): boolean {
    return ((rowBits >> column) & COLUMN_BIT) !== 0;
}

function rowMaskFor(widthPx: number): number {
    return (1 << widthPx) - 1;
}

function columnSpanBits(firstColumn: number, lastColumn: number): number {
    return rowMaskFor(lastColumn + 1) & ~rowMaskFor(firstColumn);
}

function insetFor(extentPx: number): number {
    return extentPx > BOX_SIDES_PER_AXIS * REPLACEMENT_BOX_INSET_PX ? REPLACEMENT_BOX_INSET_PX : 0;
}

function hollowBoxRows(widthPx: number, heightPx: number): Uint8Array {
    const left = insetFor(widthPx), right = widthPx - 1 - left;
    const top = insetFor(heightPx), bottom = heightPx - 1 - top;
    const edgeRow = columnSpanBits(left, right);
    const sideRow = (COLUMN_BIT << left) | (COLUMN_BIT << right);
    const rows = new Uint8Array(heightPx);
    for (let row = 0; row < heightPx; row++) {
        if (row < top || row > bottom) rows[row] = EMPTY_ROW_BITS;
        else rows[row] = row === top || row === bottom ? edgeRow : sideRow;
    }
    return rows;
}

export class PixelFont {
    public readonly glyphWidthPx: number;
    public readonly glyphHeightPx: number;

    private readonly glyphs = new Map<number, Uint8Array>();
    private readonly replacementRows: Uint8Array;

    public constructor(glyphWidthPx: number, glyphHeightPx: number, glyphs: Iterable<PixelFontGlyph>) {
        if (!Number.isInteger(glyphWidthPx) || glyphWidthPx < 1 || glyphWidthPx > MAX_GLYPH_WIDTH_PX) {
            throw new RangeError(`PixelFont: glyph width must be a whole number in [1, ${MAX_GLYPH_WIDTH_PX}] px, got ${glyphWidthPx}`);
        }
        if (!Number.isInteger(glyphHeightPx) || glyphHeightPx < MIN_GLYPH_HEIGHT_PX) {
            throw new RangeError(`PixelFont: glyph height must be a whole number of at least ${MIN_GLYPH_HEIGHT_PX} px, got ${glyphHeightPx}`);
        }
        this.glyphWidthPx = glyphWidthPx;
        this.glyphHeightPx = glyphHeightPx;
        const rowMask = rowMaskFor(glyphWidthPx);
        for (const [codePoint, rowBits] of glyphs) {
            if (rowBits.length !== glyphHeightPx) {
                throw new RangeError(`PixelFont: glyph U+${codePoint.toString(16).toUpperCase()} has ${rowBits.length} rows, expected ${glyphHeightPx}`);
            }
            const rows = new Uint8Array(glyphHeightPx);
            for (let row = 0; row < glyphHeightPx; row++) rows[row] = rowBits[row] & rowMask;
            this.glyphs.set(codePoint, rows);
        }
        this.replacementRows = hollowBoxRows(glyphWidthPx, glyphHeightPx);
    }

    public hasGlyph(codePoint: number): boolean {
        return this.glyphs.has(codePoint);
    }

    public glyphRowBits(codePoint: number, row: number): number {
        if (row < 0 || row >= this.glyphHeightPx) return EMPTY_ROW_BITS;
        return (this.glyphs.get(codePoint) ?? this.replacementRows)[row];
    }
}
