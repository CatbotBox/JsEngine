import {ASCII_PIXEL_FONT} from "./asciiPixelFont";
import {FULL_COVERAGE} from "./glyphSource";
import type {GlyphSource} from "./glyphSource";
import {isGlyphColumnLit} from "./pixelFont";
import type {PixelFont} from "./pixelFont";

const SIZE_KEY_HEIGHT_LIMIT = 0x10000;

function overlap(startA: number, endA: number, startB: number, endB: number): number {
    return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

export class PixelFontGlyphSource implements GlyphSource {
    private readonly _masksBySize = new Map<number, Map<number, Uint8Array>>();

    public constructor(private readonly font: PixelFont = ASCII_PIXEL_FONT) {
    }

    public coverage(codePoint: number, widthPx: number, heightPx: number): Uint8Array {
        const sizeKey = widthPx * SIZE_KEY_HEIGHT_LIMIT + heightPx;
        let masks = this._masksBySize.get(sizeKey);
        if (masks === undefined) this._masksBySize.set(sizeKey, masks = new Map());
        let mask = masks.get(codePoint);
        if (mask === undefined) masks.set(codePoint, mask = this.boxFiltered(codePoint, widthPx, heightPx));
        return mask;
    }

    private boxFiltered(codePoint: number, widthPx: number, heightPx: number): Uint8Array {
        const font = this.font;
        const fontWidth = font.glyphWidthPx, fontHeight = font.glyphHeightPx;
        const fullArea = fontWidth * fontHeight;
        const mask = new Uint8Array(widthPx * heightPx);
        for (let y = 0; y < heightPx; y++) {
            const top = y * fontHeight, bottom = top + fontHeight;
            const firstRow = Math.floor(top / heightPx), lastRow = Math.floor((bottom - 1) / heightPx);
            for (let x = 0; x < widthPx; x++) {
                const left = x * fontWidth, right = left + fontWidth;
                const firstColumn = Math.floor(left / widthPx), lastColumn = Math.floor((right - 1) / widthPx);
                let litArea = 0;
                for (let row = firstRow; row <= lastRow; row++) {
                    const rowBits = font.glyphRowBits(codePoint, row);
                    const rowOverlap = overlap(top, bottom, row * heightPx, (row + 1) * heightPx);
                    for (let column = firstColumn; column <= lastColumn; column++) {
                        if (!isGlyphColumnLit(rowBits, column)) continue;
                        litArea += rowOverlap * overlap(left, right, column * widthPx, (column + 1) * widthPx);
                    }
                }
                mask[y * widthPx + x] = Math.round(FULL_COVERAGE * litArea / fullArea);
            }
        }
        return mask;
    }
}
