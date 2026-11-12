import {describe, expect, test} from "../testing/harness";
import {TextSprite} from "./textSprite";
import {Ansi} from "../../backends/cells/ansiEncoding";

const visible = (row: (string | undefined)[]) =>
    row.map(g => g === undefined ? "." : g.replace(/\x1b\[[0-9;]*m/g, "")).join("");

describe("TextSprite glyph grid", () => {
    test("splits into one glyph per visible character", () => {
        const img = new TextSprite();
        img.image = ["abc", "de"];
        expect(img.pixels.length).toBe(2);
        expect(visible(img.pixels[0])).toBe("abc");
        expect(visible(img.pixels[1])).toBe("de");
        expect(img.sizeX).toBe(3);
        expect(img.sizeY).toBe(2);
    });

    test("the transparent char becomes undefined, not a glyph", () => {
        const img = new TextSprite();
        img.transparentChar = " ";
        img.image = ["a b"];
        expect(img.pixels[0][0]).toBeDefined();
        expect(img.pixels[0][1]).toBeUndefined();
        expect(img.pixels[0][2]).toBeDefined();
    });

    test("a shorter line leaves no stale glyphs behind (row reuse)", () => {
        const img = new TextSprite();
        img.image = ["abcdefgh"];
        expect(img.pixels[0].length).toBe(8);
        const rowRef = img.pixels[0];

        img.image = ["xy"];
        expect(img.pixels[0].length).toBe(2);
        expect(visible(img.pixels[0])).toBe("xy");
        expect(img.sizeX).toBe(2);
        expect(img.pixels[0]).toBe(rowRef);
    });

    test("fewer rows then more rows again rebuilds cleanly", () => {
        const img = new TextSprite();
        img.image = ["aa", "bb", "cc"];
        expect(img.pixels.length).toBe(3);
        img.image = ["dd"];
        expect(img.pixels.length).toBe(1);
        img.image = ["ee", "ff", "gg"];
        expect(img.pixels.length).toBe(3);
        expect(visible(img.pixels[2])).toBe("gg");
        expect(img.sizeY).toBe(3);
    });

    test("ANSI colour is carried onto the following visible glyph", () => {
        const img = new TextSprite();
        const red = Ansi.colors.fg.red;
        img.image = [red + "ab"];
        expect(img.pixels[0].length).toBe(2);
        expect(img.pixels[0][0]!.includes(red)).toBe(true);
        expect(visible(img.pixels[0])).toBe("ab");
    });
});
