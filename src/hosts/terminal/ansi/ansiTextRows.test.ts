import {describe, expect, test} from "../../../engine/testing/harness";
import {TextColor} from "../../../engine/rendering/textColor";
import {TRANSPARENT_GLYPH} from "../../../engine/rendering/textSprite";
import type {TextCellRow} from "../../../engine/rendering/textSprite";
import {Ansi} from "./ansiEncoding";
import {ansiTextRows, ansiTextSprite} from "./ansiTextRows";

const OPAQUE = {transparentChar: undefined};

function glyphs(row: TextCellRow): string {
    return Array.from({length: row.width}, (_, x) => row.glyphs[x] === TRANSPARENT_GLYPH ? "." : String.fromCodePoint(row.glyphs[x])).join("");
}

function foregrounds(row: TextCellRow): TextColor[] {
    return Array.from({length: row.width}, (_, x) => row.foregrounds[x]);
}

function backgrounds(row: TextCellRow): TextColor[] {
    return Array.from({length: row.width}, (_, x) => row.backgrounds[x]);
}

describe("ansiTextRows", () => {
    test("SGR colours stick to every following glyph of the line and never become glyphs", () => {
        const [row] = ansiTextRows([Ansi.colors.fg.red + "ab" + Ansi.colors.bg.blue + "c"], OPAQUE);
        expect(glyphs(row)).toBe("abc");
        expect(foregrounds(row)).toEqual([TextColor.RED, TextColor.RED, TextColor.RED]);
        expect(backgrounds(row)).toEqual([TextColor.DEFAULT, TextColor.DEFAULT, TextColor.BLUE]);
    });

    test("each line starts from the default colours", () => {
        const rows = ansiTextRows([Ansi.colors.fg.green + "a", "b"], OPAQUE);
        expect(foregrounds(rows[0])).toEqual([TextColor.GREEN]);
        expect(foregrounds(rows[1])).toEqual([TextColor.DEFAULT]);
    });

    test("every supported code maps to its colour", () => {
        const cases: [string, TextColor, TextColor][] = [
            ["\x1b[31;42m", TextColor.RED, TextColor.GREEN],
            ["\x1b[97;100m", TextColor.BRIGHT_WHITE, TextColor.BRIGHT_BLACK],
            ["\x1b[38;5;200;48;5;17m", TextColor.palette(200), TextColor.palette(17)],
            ["\x1b[38;2;1;2;3;48;2;4;5;6m", TextColor.rgb(1, 2, 3), TextColor.rgb(4, 5, 6)],
            ["\x1b[31;42m\x1b[39;49m", TextColor.DEFAULT, TextColor.DEFAULT],
            ["\x1b[31;42m\x1b[0m", TextColor.DEFAULT, TextColor.DEFAULT],
            ["\x1b[31;42m\x1b[m", TextColor.DEFAULT, TextColor.DEFAULT],
        ];
        for (const [sequence, foreground, background] of cases) {
            const [row] = ansiTextRows([sequence + "x"], OPAQUE);
            expect([glyphs(row), row.foregrounds[0], row.backgrounds[0]]).toEqual(["x", foreground, background]);
        }
    });

    test("anything that is not a supported SGR colour throws, naming the sequence", () => {
        expect(() => ansiTextRows(["a\x1b[1mb"], OPAQUE)).toThrow(JSON.stringify("\x1b[1m"));
        expect(() => ansiTextRows(["ok", "\x1b[2J"], OPAQUE)).toThrow(`${JSON.stringify("\x1b[2J")} on line 2`);
        expect(() => ansiTextRows(["\x1b[38;5m"], OPAQUE)).toThrow(JSON.stringify("\x1b[38;5m"));
        expect(() => ansiTextRows(["\x1b[48;2;1;2;300m"], OPAQUE)).toThrow("300");
        expect(() => ansiTextRows(["\x1b[38;7;1m"], OPAQUE)).toThrow("extended colour mode 7");
        expect(() => ansiTextRows(["end\x1b"], OPAQUE)).toThrow(JSON.stringify("\x1b"));
    });

    test("the transparent char becomes a transparent cell even when coloured, and astral glyphs are one cell", () => {
        const [row] = ansiTextRows([Ansi.colors.fg.red + "a b😀"], {transparentChar: " "});
        expect(glyphs(row)).toBe("a.b😀");
        expect(row.width).toBe(4);
    });

    test("ansiTextSprite builds a sprite from the styled rows", () => {
        const sprite = ansiTextSprite([Ansi.colors.fg.cyan + "hi", "there"], {transparentChar: " "});
        expect(sprite.sizeX).toBe(5);
        expect(sprite.sizeY).toBe(2);
        expect(sprite.transparentChar).toBe(" ");
        expect(sprite.rowAt(0).foregrounds[0]).toBe(TextColor.CYAN);
        expect(sprite.image).toEqual(["hi", "there"]);
    });
});
