import {describe, expect, test} from "../../engine/testing/harness";
import {TextColor} from "../../engine/rendering/textColor";
import {TextSprite} from "../../engine/rendering/textSprite";
import {DEFAULT_TEXT_FOREGROUND_RGB, resolveTextColorRgb} from "../../engine/rendering/textColorPalette";
import {PixelFramebuffer} from "./pixelFramebuffer";
import {PixelTextRasterizer} from "./pixelTextRasterizer";

const BACKGROUND_RGB = 0x000000;
const GREEN_RGB = resolveTextColorRgb(TextColor.GREEN, BACKGROUND_RGB);
const BLUE_RGB = resolveTextColorRgb(TextColor.BLUE, BACKGROUND_RGB);
const LIT = "#", UNLIT = ".", OTHER = "?";
const NEAR = 1, FAR = 5;

const LETTER_A_ROWS = [
    "..##....",
    ".####...",
    "##..##..",
    "##..##..",
    "######..",
    "##..##..",
    "##..##..",
    "........",
];

function framebuffer(widthPx: number, heightPx: number, pixelsPerScreenUnitX: number): PixelFramebuffer {
    const buffer = new PixelFramebuffer();
    buffer.beginFrame({widthPx, heightPx}, BACKGROUND_RGB, pixelsPerScreenUnitX);
    return buffer;
}

function picture(buffer: PixelFramebuffer, left: number, top: number, width: number, height: number, litRgb: number, unlitRgb: number = BACKGROUND_RGB): string[] {
    return Array.from({length: height}, (_, row) => {
        let line = "";
        for (let column = 0; column < width; column++) {
            const rgb = buffer.rgbAt(left + column, top + row);
            line += rgb === litRgb ? LIT : rgb === unlitRgb ? UNLIT : OTHER;
        }
        return line;
    });
}

function scaled(rows: readonly string[], factorX: number, factorY: number): string[] {
    return rows.flatMap(row => {
        const wide = row.split("").map(pixel => pixel.repeat(factorX)).join("");
        return new Array<string>(factorY).fill(wide);
    });
}

function sprite(lines: string[], foreground: TextColor, background: TextColor = TextColor.DEFAULT): TextSprite {
    const text = new TextSprite();
    text.image = lines;
    text.foreground = foreground;
    text.background = background;
    return text;
}

describe("PixelTextRasterizer", () => {
    test("draws A as font8x8_basic in an 8x16 screen unit, doubled rows", () => {
        const buffer = framebuffer(24, 32, 8);
        new PixelTextRasterizer().drawText(buffer, sprite(["A"], TextColor.GREEN), 8, 16, NEAR);
        expect(picture(buffer, 8, 16, 8, 16, GREEN_RGB)).toEqual(scaled(LETTER_A_ROWS, 1, 2));
        expect(picture(buffer, 0, 0, 24, 16, GREEN_RGB).every(row => row === UNLIT.repeat(24))).toBe(true);
    });

    test("nearest-samples the glyph into a larger screen unit", () => {
        const buffer = framebuffer(16, 32, 16);
        new PixelTextRasterizer().drawText(buffer, sprite(["A"], TextColor.GREEN), 0, 0, NEAR);
        expect(picture(buffer, 0, 0, 16, 32, GREEN_RGB)).toEqual(scaled(LETTER_A_ROWS, 2, 4));
    });

    test("a default foreground uses the default text colour and a default background draws nothing", () => {
        const buffer = framebuffer(8, 16, 8);
        buffer.writeRgb(0, FAR, BLUE_RGB);
        new PixelTextRasterizer().drawText(buffer, sprite([" "], TextColor.DEFAULT), 0, 0, NEAR);
        expect(buffer.rgbAt(0, 0)).toBe(BLUE_RGB);
        new PixelTextRasterizer().drawString(buffer, "A", 0, 0, NEAR, TextColor.DEFAULT, TextColor.DEFAULT);
        expect(buffer.rgbAt(2, 0)).toBe(DEFAULT_TEXT_FOREGROUND_RGB);
        expect(buffer.rgbAt(0, 0)).toBe(BLUE_RGB);
    });

    test("a coloured background fills the unlit pixels of the screen unit", () => {
        const buffer = framebuffer(8, 16, 8);
        new PixelTextRasterizer().drawText(buffer, sprite(["A"], TextColor.GREEN, TextColor.BLUE), 0, 0, NEAR);
        expect(picture(buffer, 0, 0, 8, 16, GREEN_RGB, BLUE_RGB)).toEqual(scaled(LETTER_A_ROWS, 1, 2));
    });

    test("a transparent glyph skips its whole screen unit", () => {
        const buffer = framebuffer(16, 16, 8);
        const text = sprite(["xA"], TextColor.GREEN, TextColor.BLUE);
        text.transparentChar = "x";
        new PixelTextRasterizer().drawText(buffer, text, 0, 0, NEAR);
        expect(picture(buffer, 0, 0, 8, 16, GREEN_RGB).every(row => row === UNLIT.repeat(8))).toBe(true);
        expect(picture(buffer, 8, 0, 8, 16, GREEN_RGB, BLUE_RGB)).toEqual(scaled(LETTER_A_ROWS, 1, 2));
    });

    test("clips at every edge and keeps nearer pixels", () => {
        const buffer = framebuffer(8, 16, 8);
        new PixelTextRasterizer().drawText(buffer, sprite(["AA", "AA"], TextColor.GREEN), -4, -8, NEAR);
        const expected = scaled(LETTER_A_ROWS, 1, 2);
        const shown = picture(buffer, 0, 0, 8, 16, GREEN_RGB);
        expect(shown.slice(0, 8)).toEqual(expected.slice(8).map(row => row.slice(4) + row.slice(0, 4)));

        const nearer = framebuffer(8, 16, 8);
        nearer.writeRgb(2, NEAR, BLUE_RGB);
        new PixelTextRasterizer().drawText(nearer, sprite(["A"], TextColor.GREEN), 0, 0, FAR);
        expect(nearer.rgbAt(2, 0)).toBe(BLUE_RGB);
        expect(nearer.rgbAt(3, 0)).toBe(GREEN_RGB);
    });
});
