import {describe, expect, test} from "../../testing/harness";
import {lineColumns, measureTextExtent} from "./textColumns";
import {wrapTextLines} from "./wrapTextLines";

describe("wrapTextLines", () => {
    test("words fill each line up to the width and move whole to the next line", () => {
        expect(wrapTextLines("the quick brown fox", 10)).toEqual(["the quick", "brown fox"]);
        expect(wrapTextLines("the quick brown fox", 9)).toEqual(["the quick", "brown fox"]);
        expect(wrapTextLines("the quick brown fox", 8)).toEqual(["the", "quick", "brown", "fox"]);
    });

    test("text that fits stays one line", () => {
        expect(wrapTextLines("hello world", 11)).toEqual(["hello world"]);
        expect(wrapTextLines("hello world", 50)).toEqual(["hello world"]);
    });

    test("a word longer than the width is hard-broken and the rest of it starts the next line", () => {
        expect(wrapTextLines("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
        expect(wrapTextLines("ab abcdefgh cd", 4)).toEqual(["ab", "abcd", "efgh", "cd"]);
        expect(wrapTextLines("abcdef x", 4)).toEqual(["abcd", "ef x"]);
    });

    test("line breaks in the text are kept and each paragraph wraps on its own", () => {
        expect(wrapTextLines("one two\nthree four five", 9)).toEqual(["one two", "three", "four five"]);
        expect(wrapTextLines("a\n\nb", 5)).toEqual(["a", "", "b"]);
    });

    test("runs of spaces separate words like one space, and empty text is one empty line", () => {
        expect(wrapTextLines("a   b", 5)).toEqual(["a b"]);
        expect(wrapTextLines("", 5)).toEqual([""]);
        expect(wrapTextLines("   ", 5)).toEqual([""]);
    });

    test("fractional widths round down and widths under one column wrap at one column", () => {
        expect(wrapTextLines("ab cd", 4.9)).toEqual(["ab", "cd"]);
        expect(wrapTextLines("abc", 0)).toEqual(["a", "b", "c"]);
    });

    test("widths count code points, so astral characters take one column each", () => {
        expect(lineColumns("a\u{1F600}b")).toBe(3);
        expect(wrapTextLines("\u{1F600}\u{1F600}\u{1F600}", 2)).toEqual(["\u{1F600}\u{1F600}", "\u{1F600}"]);
    });

    test("the unwrapped extent is the longest line by the line count", () => {
        expect(measureTextExtent("ab\nabcd\nc")).toEqual({columns: 4, lines: 3});
        expect(measureTextExtent("")).toEqual({columns: 0, lines: 1});
    });
});
