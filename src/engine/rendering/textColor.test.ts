import {describe, expect, test} from "../testing/harness";
import {TextColor} from "./textColor";

describe("TextColor", () => {
    test("default, palette and RGB colours are distinct, including palette black and RGB black", () => {
        const colors = [TextColor.DEFAULT, TextColor.BLACK, TextColor.rgb(0, 0, 0), TextColor.palette(16), TextColor.packedRgb(0xFFFFFF)];
        expect(new Set(colors).size).toBe(colors.length);
        expect(TextColor.isDefault(TextColor.DEFAULT)).toBe(true);
        expect(TextColor.isPalette(TextColor.BLACK)).toBe(true);
        expect(TextColor.isRgb(TextColor.BLACK)).toBe(false);
        expect(TextColor.isRgb(TextColor.rgb(0, 0, 0))).toBe(true);
        expect(TextColor.isDefault(TextColor.rgb(0, 0, 0))).toBe(false);
    });

    test("the sixteen named colours are palette indices 0-15 in SGR order", () => {
        const named = [
            TextColor.BLACK, TextColor.RED, TextColor.GREEN, TextColor.YELLOW,
            TextColor.BLUE, TextColor.MAGENTA, TextColor.CYAN, TextColor.WHITE,
            TextColor.BRIGHT_BLACK, TextColor.BRIGHT_RED, TextColor.BRIGHT_GREEN, TextColor.BRIGHT_YELLOW,
            TextColor.BRIGHT_BLUE, TextColor.BRIGHT_MAGENTA, TextColor.BRIGHT_CYAN, TextColor.BRIGHT_WHITE,
        ];
        expect(named.map(TextColor.paletteIndexOf)).toEqual(Array.from({length: 16}, (_, i) => i));
    });

    test("accessors read back what the constructors packed", () => {
        expect(TextColor.paletteIndexOf(TextColor.palette(231))).toBe(231);
        expect(TextColor.rgbOf(TextColor.rgb(0x12, 0x34, 0x56))).toBe(0x123456);
        expect(TextColor.rgbOf(TextColor.packedRgb(0xAB123456))).toBe(0x123456);
        expect(TextColor.rgb(256 + 1, 2, 3)).toBe(TextColor.rgb(1, 2, 3));
    });

    test("palette indices outside [0, 255] and wrong-kind accessors throw", () => {
        expect(() => TextColor.palette(256)).toThrow("palette");
        expect(() => TextColor.palette(-1)).toThrow("palette");
        expect(() => TextColor.palette(1.5)).toThrow("palette");
        expect(() => TextColor.rgbOf(TextColor.RED)).toThrow("not an RGB colour");
        expect(() => TextColor.paletteIndexOf(TextColor.DEFAULT)).toThrow("not a palette colour");
    });

    test("isTextColor accepts exactly the encodable values", () => {
        expect([TextColor.DEFAULT, TextColor.palette(255), TextColor.packedRgb(0xFFFFFF)].every(TextColor.isTextColor)).toBe(true);
        expect([1, -1, 0.5, TextColor.palette(255) + 1, TextColor.packedRgb(0xFFFFFF) + 1, "0", undefined].some(TextColor.isTextColor)).toBe(false);
    });
});
