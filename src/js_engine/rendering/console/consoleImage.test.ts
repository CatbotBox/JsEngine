import {describe, expect, test} from "../../testing/harness";
import {ConsoleImage} from "./consoleImage";
import {Ansi} from "./ansi";

/**
 * recalculatePixels() now fills caller-owned row arrays instead of allocating a
 * fresh one per row per frame. The failure mode that buys is stale glyphs: a
 * reused row must be truncated, or the tail of a longer previous frame shows
 * through. These pin that.
 */
const visible = (row: (string | undefined)[]) =>
    row.map(g => g === undefined ? "." : g.replace(/\x1b\[[0-9;]*m/g, "")).join("");

describe("ConsoleImage glyph grid", () => {
    test("splits into one glyph per visible character", () => {
        const img = new ConsoleImage();
        img.image = ["abc", "de"];
        expect(img.pixels.length).toBe(2);
        expect(visible(img.pixels[0])).toBe("abc");
        expect(visible(img.pixels[1])).toBe("de");
        expect(img.sizeX).toBe(3); // widest row
        expect(img.sizeY).toBe(2);
    });

    test("the transparent char becomes undefined, not a glyph", () => {
        const img = new ConsoleImage();
        img.transparentChar = " ";
        img.image = ["a b"];
        expect(img.pixels[0][0]).toBeDefined();
        expect(img.pixels[0][1]).toBeUndefined();
        expect(img.pixels[0][2]).toBeDefined();
    });

    test("a shorter line leaves no stale glyphs behind (row reuse)", () => {
        const img = new ConsoleImage();
        img.image = ["abcdefgh"];
        expect(img.pixels[0].length).toBe(8);
        const rowRef = img.pixels[0];

        img.image = ["xy"]; // much shorter
        expect(img.pixels[0].length).toBe(2);
        expect(visible(img.pixels[0])).toBe("xy");
        expect(img.sizeX).toBe(2);
        // the point of the change: same array object, not a fresh allocation
        expect(img.pixels[0]).toBe(rowRef);
    });

    test("fewer rows then more rows again rebuilds cleanly", () => {
        const img = new ConsoleImage();
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
        const img = new ConsoleImage();
        const red = Ansi.colors.fg.red;
        img.image = [red + "ab"];
        expect(img.pixels[0].length).toBe(2); // escape is not its own cell
        expect(img.pixels[0][0]!.includes(red)).toBe(true);
        expect(visible(img.pixels[0])).toBe("ab");
    });
});
