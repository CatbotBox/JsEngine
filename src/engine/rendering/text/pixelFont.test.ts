import {describe, expect, test} from "../../testing/harness";
import {
    ASCII_PIXEL_FONT,
    ASCII_PIXEL_FONT_HEIGHT_PX,
    ASCII_PIXEL_FONT_WIDTH_PX,
    FONT8X8_BASIC_FIRST_CODE_POINT,
    FONT8X8_BASIC_GLYPH_SIZE_PX,
    FONT8X8_BASIC_PUBLIC_DOMAIN_ROWS,
} from "./asciiPixelFont";
import {isGlyphColumnLit, PixelFont} from "./pixelFont";

const LIT = "#";
const UNLIT = ".";
const LAST_PRINTABLE_ASCII_CODE_POINT = 0x7E;
const PRINTABLE_ASCII_GLYPHS = LAST_PRINTABLE_ASCII_CODE_POINT - FONT8X8_BASIC_FIRST_CODE_POINT + 1;
const DELETE_CODE_POINT = 0x7F;
const SPACE_CODE_POINT = 0x20;
const BYTE_LIMIT = 0x100;
const GLYPH_AREA_PX = ASCII_PIXEL_FONT_WIDTH_PX * ASCII_PIXEL_FONT_HEIGHT_PX;
const QUARTER = 0.25, HALF = 0.5, THREE_QUARTERS = 0.75;

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

const DIGIT_ZERO_ROWS = [
    ".#####..",
    "##...##.",
    "##..###.",
    "##.####.",
    "####.##.",
    "###..##.",
    ".#####..",
    "........",
];

const LETTER_G_ROWS = [
    "........",
    "........",
    ".###.##.",
    "##..##..",
    "##..##..",
    ".#####..",
    "....##..",
    "#####...",
];

const NUMBER_SIGN_ROWS = [
    ".##.##..",
    ".##.##..",
    "#######.",
    ".##.##..",
    "#######.",
    ".##.##..",
    ".##.##..",
    "........",
];

const HOLLOW_BOX_ROWS = [
    "........",
    ".######.",
    ...new Array<string>(12).fill(".#....#."),
    ".######.",
    "........",
];

function renderedRows(font: PixelFont, codePoint: number): string[] {
    return Array.from({length: font.glyphHeightPx}, (_, row) => {
        const bits = font.glyphRowBits(codePoint, row);
        let text = "";
        for (let column = 0; column < font.glyphWidthPx; column++) text += isGlyphColumnLit(bits, column) ? LIT : UNLIT;
        return text;
    });
}

function doubledRows(rows: readonly string[]): string[] {
    return rows.flatMap(row => [row, row]);
}

function litShare(font: PixelFont, codePoint: number): number {
    const lit = renderedRows(font, codePoint).join("").split("").filter(pixel => pixel === LIT).length;
    return lit / GLYPH_AREA_PX;
}

describe("ASCII_PIXEL_FONT", () => {
    test("A, 0, g and # render as font8x8_basic with every row doubled", () => {
        expect(renderedRows(ASCII_PIXEL_FONT, "A".codePointAt(0)!)).toEqual(doubledRows(LETTER_A_ROWS));
        expect(renderedRows(ASCII_PIXEL_FONT, "0".codePointAt(0)!)).toEqual(doubledRows(DIGIT_ZERO_ROWS));
        expect(renderedRows(ASCII_PIXEL_FONT, "g".codePointAt(0)!)).toEqual(doubledRows(LETTER_G_ROWS));
        expect(renderedRows(ASCII_PIXEL_FONT, "#".codePointAt(0)!)).toEqual(doubledRows(NUMBER_SIGN_ROWS));
    });

    test("is 8x16 and has a glyph for every printable ASCII code point, the space blank", () => {
        expect([ASCII_PIXEL_FONT.glyphWidthPx, ASCII_PIXEL_FONT.glyphHeightPx]).toEqual([8, 16]);
        for (let codePoint = FONT8X8_BASIC_FIRST_CODE_POINT; codePoint <= LAST_PRINTABLE_ASCII_CODE_POINT; codePoint++) {
            expect(ASCII_PIXEL_FONT.hasGlyph(codePoint)).toBe(true);
        }
        expect(ASCII_PIXEL_FONT.hasGlyph(DELETE_CODE_POINT)).toBe(false);
        expect(litShare(ASCII_PIXEL_FONT, SPACE_CODE_POINT)).toBe(0);
    });

    test("a code point without a glyph draws a hollow box", () => {
        expect(ASCII_PIXEL_FONT.hasGlyph(0xE9)).toBe(false);
        expect(renderedRows(ASCII_PIXEL_FONT, 0xE9)).toEqual(HOLLOW_BOX_ROWS);
        expect(renderedRows(ASCII_PIXEL_FONT, 0x1F600)).toEqual(HOLLOW_BOX_ROWS);
    });

    test("the block glyphs fill their halves and the shades light a quarter, half and three quarters", () => {
        const fullRow = LIT.repeat(ASCII_PIXEL_FONT_WIDTH_PX), emptyRow = UNLIT.repeat(ASCII_PIXEL_FONT_WIDTH_PX);
        const halfHeight = ASCII_PIXEL_FONT_HEIGHT_PX / 2;
        const half = (row: string) => new Array<string>(halfHeight).fill(row);
        expect(renderedRows(ASCII_PIXEL_FONT, "▀".codePointAt(0)!)).toEqual([...half(fullRow), ...half(emptyRow)]);
        expect(renderedRows(ASCII_PIXEL_FONT, "▄".codePointAt(0)!)).toEqual([...half(emptyRow), ...half(fullRow)]);
        expect(litShare(ASCII_PIXEL_FONT, "█".codePointAt(0)!)).toBe(1);
        expect(litShare(ASCII_PIXEL_FONT, "░".codePointAt(0)!)).toBe(QUARTER);
        expect(litShare(ASCII_PIXEL_FONT, "▒".codePointAt(0)!)).toBe(HALF);
        expect(litShare(ASCII_PIXEL_FONT, "▓".codePointAt(0)!)).toBe(THREE_QUARTERS);
    });

    test("rows outside the glyph are blank", () => {
        const full = "█".codePointAt(0)!;
        expect(ASCII_PIXEL_FONT.glyphRowBits(full, -1)).toBe(0);
        expect(ASCII_PIXEL_FONT.glyphRowBits(full, ASCII_PIXEL_FONT_HEIGHT_PX)).toBe(0);
    });

    test("the font8x8_basic table holds the 95 printable ASCII glyphs as 8 one-byte rows each", () => {
        expect(FONT8X8_BASIC_PUBLIC_DOMAIN_ROWS.length).toBe(PRINTABLE_ASCII_GLYPHS);
        for (const rows of FONT8X8_BASIC_PUBLIC_DOMAIN_ROWS) {
            expect(rows.length).toBe(FONT8X8_BASIC_GLYPH_SIZE_PX);
            expect(rows.every(row => Number.isInteger(row) && row >= 0 && row < BYTE_LIMIT)).toBe(true);
        }
    });
});

describe("PixelFont", () => {
    test("masks row bits to the glyph width", () => {
        const font = new PixelFont(3, 1, [[0x41, [0xFF]]]);
        expect(font.glyphRowBits(0x41, 0)).toBe(0b111);
    });

    test("draws a hollow box that fills glyphs too small to inset", () => {
        expect(renderedRows(new PixelFont(2, 2, []), 0x41)).toEqual(["##", "##"]);
    });

    test("rejects glyphs wider than 8 px, empty glyphs and glyphs with the wrong row count", () => {
        expect(() => new PixelFont(9, 16, [])).toThrow("glyph width");
        expect(() => new PixelFont(0, 16, [])).toThrow("glyph width");
        expect(() => new PixelFont(8, 0, [])).toThrow("glyph height");
        expect(() => new PixelFont(8, 2, [[0x41, [0x01]]])).toThrow("U+41 has 1 rows, expected 2");
    });
});
