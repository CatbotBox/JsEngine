import {describe, expect, test} from "../testing/harness";
import {TextSprite, TRANSPARENT_GLYPH} from "./textSprite";
import type {TextCellRow} from "./textSprite";
import {TextColor} from "./textColor";

const TRANSPARENT_MARK = ".";
const ESCAPE_CODE_POINT = 0x1b;

function visible(row: TextCellRow): string {
    let text = "";
    for (let x = 0; x < row.width; x++) {
        const glyph = row.glyphs[x];
        text += glyph === TRANSPARENT_GLYPH ? TRANSPARENT_MARK : String.fromCodePoint(glyph);
    }
    return text;
}

function rowsOf(sprite: TextSprite): string[] {
    return Array.from({length: sprite.sizeY}, (_, y) => visible(sprite.rowAt(y)));
}

function colorsOf(row: TextCellRow, colors: ArrayLike<TextColor>): TextColor[] {
    return Array.from({length: row.width}, (_, x) => colors[x]);
}

describe("TextSprite cells", () => {
    test("splits into one cell per code point", () => {
        const img = new TextSprite();
        img.image = ["abc", "de"];
        expect(rowsOf(img)).toEqual(["abc", "de"]);
        expect(img.sizeX).toBe(3);
        expect(img.sizeY).toBe(2);
    });

    test("an astral character is one cell, not two UTF-16 units", () => {
        const img = new TextSprite();
        img.transparentChar = undefined;
        img.image = ["a😀b"];
        expect(img.sizeX).toBe(3);
        expect(img.rowAt(0).glyphs[1]).toBe(0x1F600);
    });

    test("the transparent char becomes an explicit transparent cell, not a glyph", () => {
        const img = new TextSprite();
        img.transparentChar = " ";
        img.image = ["a b"];
        expect(img.rowAt(0).glyphs[0]).toBe("a".codePointAt(0)!);
        expect(img.rowAt(0).glyphs[1]).toBe(TRANSPARENT_GLYPH);
        expect(img.rowAt(0).glyphs[2]).toBe("b".codePointAt(0)!);
    });

    test("no transparent char, or one that is not a single code point, keeps every character", () => {
        const img = new TextSprite();
        img.transparentChar = undefined;
        img.image = ["a b"];
        expect(rowsOf(img)).toEqual(["a b"]);
        img.transparentChar = "ab";
        expect(rowsOf(img)).toEqual(["a b"]);
        img.transparentChar = "";
        expect(rowsOf(img)).toEqual(["a b"]);
    });

    test("changing the transparent char recalculates the cells", () => {
        const img = new TextSprite();
        img.image = ["a-b c"];
        expect(rowsOf(img)).toEqual(["a-b.c"]);
        img.transparentChar = "-";
        expect(rowsOf(img)).toEqual(["a.b c"]);
    });

    test("escape characters are glyphs; image text is never parsed as escape sequences", () => {
        const escape = String.fromCodePoint(ESCAPE_CODE_POINT);
        const img = new TextSprite();
        img.image = [escape + "[31mab"];
        expect(img.sizeX).toBe(7);
        expect(img.rowAt(0).glyphs[0]).toBe(ESCAPE_CODE_POINT);
    });

    test("a shorter line leaves no stale cells behind and reuses its row", () => {
        const img = new TextSprite();
        img.image = ["abcdefgh"];
        expect(img.rowAt(0).width).toBe(8);
        const rowRef = img.rowAt(0);

        img.image = ["xy"];
        expect(img.rowAt(0).width).toBe(2);
        expect(rowsOf(img)).toEqual(["xy"]);
        expect(img.sizeX).toBe(2);
        expect(img.rowAt(0)).toBe(rowRef);
    });

    test("fewer rows then more rows again rebuilds cleanly and reuses the rows", () => {
        const img = new TextSprite();
        img.image = ["aa", "bb", "cc"];
        const lastRow = img.rowAt(2);
        expect(img.sizeY).toBe(3);
        img.image = ["dd"];
        expect(img.sizeY).toBe(1);
        expect(() => img.rowAt(1)).toThrow("outside");
        img.image = ["ee", "ff", "gg"];
        expect(rowsOf(img)).toEqual(["ee", "ff", "gg"]);
        expect(img.sizeY).toBe(3);
        expect(img.rowAt(2)).toBe(lastRow);
    });

    test("sprite-wide colours apply to every cell of the image text, default colours otherwise", () => {
        const img = new TextSprite();
        img.image = ["ab"];
        expect(colorsOf(img.rowAt(0), img.rowAt(0).foregrounds)).toEqual([TextColor.DEFAULT, TextColor.DEFAULT]);
        img.foreground = TextColor.GREEN;
        img.background = TextColor.rgb(1, 2, 3);
        expect(colorsOf(img.rowAt(0), img.rowAt(0).foregrounds)).toEqual([TextColor.GREEN, TextColor.GREEN]);
        expect(colorsOf(img.rowAt(0), img.rowAt(0).backgrounds)).toEqual([TextColor.rgb(1, 2, 3), TextColor.rgb(1, 2, 3)]);
        img.image = ["xyz"];
        expect(colorsOf(img.rowAt(0), img.rowAt(0).foregrounds)).toEqual([TextColor.GREEN, TextColor.GREEN, TextColor.GREEN]);
    });

    test("styled rows set every cell's glyph and colours; image reads back their text", () => {
        const img = new TextSprite();
        img.setStyledRows([
            {width: 3, glyphs: [0x41, TRANSPARENT_GLYPH, 0x42], foregrounds: [TextColor.RED, TextColor.DEFAULT, TextColor.BLUE], backgrounds: [TextColor.DEFAULT, TextColor.DEFAULT, TextColor.WHITE]},
            {width: 1, glyphs: [0x43], foregrounds: [TextColor.DEFAULT], backgrounds: [TextColor.palette(200)]},
        ]);
        expect(img.sizeX).toBe(3);
        expect(img.sizeY).toBe(2);
        expect(rowsOf(img)).toEqual(["A.B", "C"]);
        expect(colorsOf(img.rowAt(0), img.rowAt(0).foregrounds)).toEqual([TextColor.RED, TextColor.DEFAULT, TextColor.BLUE]);
        expect(colorsOf(img.rowAt(1), img.rowAt(1).backgrounds)).toEqual([TextColor.palette(200)]);
        expect(img.image).toEqual(["A B", "C"]);
    });

    test("sprite-wide colours and the transparent char do not overwrite styled rows; image text does", () => {
        const img = new TextSprite();
        img.setStyledRows([{width: 1, glyphs: [0x41], foregrounds: [TextColor.RED], backgrounds: [TextColor.DEFAULT]}]);
        img.foreground = TextColor.GREEN;
        img.transparentChar = "A";
        expect(rowsOf(img)).toEqual(["A"]);
        expect(img.rowAt(0).foregrounds[0]).toBe(TextColor.RED);

        img.image = ["AB"];
        expect(rowsOf(img)).toEqual([".B"]);
        expect(img.rowAt(0).foregrounds[1]).toBe(TextColor.GREEN);
    });
});
