import {describe, expect, test} from "../../testing/harness";
import {ASCII_PIXEL_FONT, ASCII_PIXEL_FONT_HEIGHT_PX, ASCII_PIXEL_FONT_WIDTH_PX} from "./asciiPixelFont";
import {FULL_COVERAGE} from "./glyphSource";
import {isGlyphColumnLit} from "./pixelFont";
import {PixelFontGlyphSource} from "./pixelFontGlyphSource";

const WHOLE_MULTIPLES = [1, 2, 3];
const FRACTIONAL_WIDTH_PX = 12;
const FRACTIONAL_HEIGHT_PX = 24;
const SHRUNK_WIDTH_PX = 4;
const SHRUNK_HEIGHT_PX = 8;
const UNMAPPED_CODE_POINT = 0xE9;
const ROUNDING_PER_PIXEL = 0.5;
const HALF = 0.5;
const HOLLOW_BOX_SIDE_ROWS = 12;
const LETTER_A = "A".codePointAt(0)!;
const LETTER_B = "B".codePointAt(0)!;
const SAMPLED_CODE_POINTS = ["A", "g", "#", "▒", "…"].map(glyph => glyph.codePointAt(0)!).concat(UNMAPPED_CODE_POINT);

function nearestSampled(codePoint: number, widthPx: number, heightPx: number): Uint8Array {
    const mask = new Uint8Array(widthPx * heightPx);
    for (let y = 0; y < heightPx; y++) {
        const rowBits = ASCII_PIXEL_FONT.glyphRowBits(codePoint, Math.floor(y * ASCII_PIXEL_FONT_HEIGHT_PX / heightPx));
        for (let x = 0; x < widthPx; x++) {
            mask[y * widthPx + x] = isGlyphColumnLit(rowBits, Math.floor(x * ASCII_PIXEL_FONT_WIDTH_PX / widthPx)) ? FULL_COVERAGE : 0;
        }
    }
    return mask;
}

function litFontPixels(codePoint: number): number {
    let lit = 0;
    for (let row = 0; row < ASCII_PIXEL_FONT_HEIGHT_PX; row++) {
        const rowBits = ASCII_PIXEL_FONT.glyphRowBits(codePoint, row);
        for (let column = 0; column < ASCII_PIXEL_FONT_WIDTH_PX; column++) if (isGlyphColumnLit(rowBits, column)) lit++;
    }
    return lit;
}

function coveredArea(mask: Uint8Array): number {
    let sum = 0;
    for (const value of mask) sum += value;
    return sum / FULL_COVERAGE;
}

describe("PixelFontGlyphSource", () => {
    test("at whole multiples of the font's 8x16 cell the coverage equals nearest sampling bit for bit", () => {
        const source = new PixelFontGlyphSource();
        for (const multiple of WHOLE_MULTIPLES) {
            const widthPx = ASCII_PIXEL_FONT_WIDTH_PX * multiple, heightPx = ASCII_PIXEL_FONT_HEIGHT_PX * multiple;
            for (const codePoint of SAMPLED_CODE_POINTS) {
                expect(Array.from(source.coverage(codePoint, widthPx, heightPx))).toEqual(Array.from(nearestSampled(codePoint, widthPx, heightPx)));
            }
        }
    });

    test("at a fractional scale the coverage adds up to the lit area and has partial pixels", () => {
        const source = new PixelFontGlyphSource();
        const areaPerFontPixel = FRACTIONAL_WIDTH_PX * FRACTIONAL_HEIGHT_PX / (ASCII_PIXEL_FONT_WIDTH_PX * ASCII_PIXEL_FONT_HEIGHT_PX);
        const tolerance = FRACTIONAL_WIDTH_PX * FRACTIONAL_HEIGHT_PX * ROUNDING_PER_PIXEL / FULL_COVERAGE;
        for (const codePoint of SAMPLED_CODE_POINTS) {
            const mask = source.coverage(codePoint, FRACTIONAL_WIDTH_PX, FRACTIONAL_HEIGHT_PX);
            expect(mask.length).toBe(FRACTIONAL_WIDTH_PX * FRACTIONAL_HEIGHT_PX);
            expect(Math.abs(coveredArea(mask) - litFontPixels(codePoint) * areaPerFontPixel) <= tolerance).toBe(true);
            expect(Array.from(mask).some(value => value > 0 && value < FULL_COVERAGE)).toBe(true);
        }
    });

    test("shrinking averages the font pixels each output pixel covers", () => {
        const source = new PixelFontGlyphSource();
        const full = source.coverage("█".codePointAt(0)!, SHRUNK_WIDTH_PX, SHRUNK_HEIGHT_PX);
        expect(Array.from(full).every(value => value === FULL_COVERAGE)).toBe(true);
        const shade = source.coverage("▒".codePointAt(0)!, SHRUNK_WIDTH_PX, SHRUNK_HEIGHT_PX);
        expect(Array.from(shade).every(value => value === Math.round(FULL_COVERAGE * HALF))).toBe(true);
    });

    test("a code point without a glyph covers the font's hollow box", () => {
        const source = new PixelFontGlyphSource();
        const mask = source.coverage(UNMAPPED_CODE_POINT, ASCII_PIXEL_FONT_WIDTH_PX, ASCII_PIXEL_FONT_HEIGHT_PX);
        const rows = Array.from({length: ASCII_PIXEL_FONT_HEIGHT_PX}, (_, row) =>
            Array.from(mask.subarray(row * ASCII_PIXEL_FONT_WIDTH_PX, (row + 1) * ASCII_PIXEL_FONT_WIDTH_PX), value => value === FULL_COVERAGE ? "#" : ".").join(""));
        expect(rows).toEqual(["........", ".######.", ...new Array<string>(HOLLOW_BOX_SIDE_ROWS).fill(".#....#."), ".######.", "........"]);
    });

    test("caches one mask per code point and size", () => {
        const source = new PixelFontGlyphSource();
        const first = source.coverage(LETTER_A, FRACTIONAL_WIDTH_PX, FRACTIONAL_HEIGHT_PX);
        expect(source.coverage(LETTER_A, FRACTIONAL_WIDTH_PX, FRACTIONAL_HEIGHT_PX)).toBe(first);
        expect(source.coverage(LETTER_A, FRACTIONAL_HEIGHT_PX, FRACTIONAL_WIDTH_PX)).not.toBe(first);
        expect(source.coverage(LETTER_B, FRACTIONAL_WIDTH_PX, FRACTIONAL_HEIGHT_PX)).not.toBe(first);
    });
});
