import {describe, expect, test} from "../testing/harness";
import {TextColor} from "./textColor";
import {
    DEFAULT_TEXT_BACKGROUND_RGB,
    DEFAULT_TEXT_FOREGROUND_RGB,
    paletteRgb,
    resolveTextColorRgb,
    TEXT_COLOR_PALETTE_RGB,
} from "./textColorPalette";

const CALLER_DEFAULT_RGB = 0x123456;
const PALETTE_SIZE = 256;

describe("text colour palette", () => {
    test("the default text colours are xterm's theme foreground and background", () => {
        expect(DEFAULT_TEXT_FOREGROUND_RGB).toBe(0xE5E5E5);
        expect(DEFAULT_TEXT_BACKGROUND_RGB).toBe(0x000000);
    });

    test("holds xterm's 16 standard colours, the 6x6x6 cube and 24 greys", () => {
        expect(TEXT_COLOR_PALETTE_RGB.length).toBe(PALETTE_SIZE);
        expect(Object.isFrozen(TEXT_COLOR_PALETTE_RGB)).toBe(true);
        expect([paletteRgb(1), paletteRgb(12), paletteRgb(16), paletteRgb(67), paletteRgb(231), paletteRgb(232), paletteRgb(255)])
            .toEqual([0xCD0000, 0x5C5CFF, 0x000000, 0x5F87AF, 0xFFFFFF, 0x080808, 0xEEEEEE]);
    });

    test("resolves default to the caller's colour, palette through the palette and RGB as itself", () => {
        expect(resolveTextColorRgb(TextColor.DEFAULT, CALLER_DEFAULT_RGB)).toBe(CALLER_DEFAULT_RGB);
        expect(resolveTextColorRgb(TextColor.GREEN, CALLER_DEFAULT_RGB)).toBe(0x00CD00);
        expect(resolveTextColorRgb(TextColor.palette(21), CALLER_DEFAULT_RGB)).toBe(0x0000FF);
        expect(resolveTextColorRgb(TextColor.rgb(1, 2, 3), CALLER_DEFAULT_RGB)).toBe(0x010203);
    });
});
