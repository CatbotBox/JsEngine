import {ASCII_PIXEL_FONT, BLACK_RGB, GREEN_SHIFT, isGlyphColumnLit, RED_SHIFT} from "../../src/engine/rendering";
import type {PixelFont} from "../../src/engine/rendering";
import {RGBA_BYTES_PER_PIXEL} from "../../src/backends/pixels";
import type {PixelFrame} from "../../src/backends/pixels";

const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
const NOT_FOUND = -1;
const GRID_PHASE_FRACTIONS = [0, 0.5];

export function pixelRgbAt(frame: PixelFrame, x: number, y: number): number {
    const index = (y * frame.widthPx + x) * RGBA_BYTES_PER_PIXEL;
    const rgba = frame.rgba;
    return (rgba[index] << RED_SHIFT) | (rgba[index + GREEN_OFFSET] << GREEN_SHIFT) | rgba[index + BLUE_OFFSET];
}

export function pixelsDifferingFrom(frame: PixelFrame, backgroundRgb: number = BLACK_RGB): number {
    let count = 0;
    for (let y = 0; y < frame.heightPx; y++) {
        for (let x = 0; x < frame.widthPx; x++) if (pixelRgbAt(frame, x, y) !== backgroundRgb) count++;
    }
    return count;
}

function glyphLitAt(frame: PixelFrame, font: PixelFont, codePoint: number, offsetX: number, offsetY: number): boolean {
    const rowBits = font.glyphRowBits(codePoint, Math.floor(offsetY * font.glyphHeightPx / frame.pixelsPerScreenUnitY));
    return isGlyphColumnLit(rowBits, Math.floor(offsetX * font.glyphWidthPx / frame.pixelsPerScreenUnitX));
}

function litRgbOf(frame: PixelFrame, font: PixelFont, codePoints: readonly number[], left: number, top: number): number {
    const unitX = frame.pixelsPerScreenUnitX, unitY = frame.pixelsPerScreenUnitY;
    for (let glyph = 0; glyph < codePoints.length; glyph++) {
        for (let offsetY = 0; offsetY < unitY; offsetY++) {
            for (let offsetX = 0; offsetX < unitX; offsetX++) {
                if (glyphLitAt(frame, font, codePoints[glyph], offsetX, offsetY)) return pixelRgbAt(frame, left + glyph * unitX + offsetX, top + offsetY);
            }
        }
    }
    return NOT_FOUND;
}

function textMatchesAt(frame: PixelFrame, font: PixelFont, codePoints: readonly number[], left: number, top: number): boolean {
    const litRgb = litRgbOf(frame, font, codePoints, left, top);
    if (litRgb === NOT_FOUND) return false;
    const unitX = frame.pixelsPerScreenUnitX, unitY = frame.pixelsPerScreenUnitY;
    for (let glyph = 0; glyph < codePoints.length; glyph++) {
        const boxLeft = left + glyph * unitX;
        for (let offsetY = 0; offsetY < unitY; offsetY++) {
            for (let offsetX = 0; offsetX < unitX; offsetX++) {
                const lit = glyphLitAt(frame, font, codePoints[glyph], offsetX, offsetY);
                if (lit !== (pixelRgbAt(frame, boxLeft + offsetX, top + offsetY) === litRgb)) return false;
            }
        }
    }
    return true;
}

function gridStarts(extentPx: number, unitPx: number, spanPx: number): number[] {
    const starts = new Set<number>();
    for (const phaseFraction of GRID_PHASE_FRACTIONS) {
        for (let start = Math.floor(unitPx * phaseFraction); start + spanPx <= extentPx; start += unitPx) starts.add(start);
    }
    for (let end = extentPx; end - spanPx >= 0; end -= unitPx) starts.add(end - spanPx);
    return [...starts];
}

export function pixelFrameShowsText(frame: PixelFrame, text: string, font: PixelFont = ASCII_PIXEL_FONT): boolean {
    const codePoints = Array.from(text, character => character.codePointAt(0)!);
    const unitX = frame.pixelsPerScreenUnitX, unitY = frame.pixelsPerScreenUnitY;
    if (codePoints.length === 0 || !Number.isInteger(unitX) || !Number.isInteger(unitY)) return false;
    const lefts = gridStarts(frame.widthPx, unitX, codePoints.length * unitX);
    const tops = gridStarts(frame.heightPx, unitY, unitY);
    return tops.some(top => lefts.some(left => textMatchesAt(frame, font, codePoints, left, top)));
}
