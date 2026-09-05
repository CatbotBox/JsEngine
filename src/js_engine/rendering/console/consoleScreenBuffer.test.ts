import {describe, expect, test} from "../../testing/harness";
import {ScreenBuffer} from "./consoleScreenBuffer";
import {ScreenSize} from "../screenSize";

const WIDTH = 4, HEIGHT = 1;
const FG = (c: number) => `\x1b[38;2;${(c >> 16) & 255};${(c >> 8) & 255};${c & 255}m`;
const BG = (c: number) => `\x1b[48;2;${(c >> 16) & 255};${(c >> 8) & 255};${c & 255}m`;
const RESET = "\x1b[0m";
const DEFAULT_BG = "\x1b[49m";

function makeBuffer(): ScreenBuffer {
    const screenSize = new ScreenSize();
    screenSize.x = WIDTH;
    screenSize.y = HEIGHT;
    const buffer = new ScreenBuffer();
    buffer.beginFrame({screenSize}, ".");
    return buffer;
}

function layers(values: (number | null)[]): { depth: Float32Array, color: Int32Array } {
    const depth = new Float32Array(values.length).fill(Number.POSITIVE_INFINITY);
    const color = new Int32Array(values.length);
    values.forEach((v, i) => {
        if (v !== null) {
            depth[i] = 1;
            color[i] = v;
        }
    });
    return {depth, color};
}

describe("ScreenBuffer half-block cells", () => {
    test("a split cell flushes as foreground top, background bottom and the upper half block", () => {
        const buffer = makeBuffer();
        const top = layers([0xFF0000, null, null, null]);
        const bottom = layers([0x0000FF, null, null, null]);
        buffer.mergeRgbSplitLayer(top.depth, top.color, bottom.depth, bottom.color);
        expect(buffer.splitRgbAt(0, 0)).toEqual([0xFF0000, 0x0000FF]);
        expect(buffer.rgbAt(0, 0)).toBeUndefined();
        expect(buffer.flush()).toBe(FG(0xFF0000) + BG(0x0000FF) + "▀" + "..." + RESET);
    });

    test("an uncovered bottom half shows the console background under the upper half block", () => {
        const buffer = makeBuffer();
        const top = layers([0xFF0000, null, null, null]);
        const bottom = layers([null, null, null, null]);
        buffer.mergeRgbSplitLayer(top.depth, top.color, bottom.depth, bottom.color);
        expect(buffer.splitRgbAt(0, 0)).toEqual([0xFF0000, undefined]);
        expect(buffer.rgbAt(0, 0)).toBeUndefined();
        expect(buffer.flush()).toBe(DEFAULT_BG + FG(0xFF0000) + "▀" + "..." + RESET);
    });

    test("an uncovered top half shows the console background above the lower half block", () => {
        const buffer = makeBuffer();
        const top = layers([null, null, null, null]);
        const bottom = layers([0x0000FF, null, null, null]);
        buffer.mergeRgbSplitLayer(top.depth, top.color, bottom.depth, bottom.color);
        expect(buffer.splitRgbAt(0, 0)).toEqual([undefined, 0x0000FF]);
        expect(buffer.flush()).toBe(DEFAULT_BG + FG(0x0000FF) + "▄" + "..." + RESET);
    });

    test("an uncovered half reuses a colored console background's own escapes", () => {
        const screenSize = new ScreenSize();
        screenSize.x = WIDTH;
        screenSize.y = HEIGHT;
        const buffer = new ScreenBuffer();
        const consoleBackground = "\x1b[44m\x1b[30m ";
        buffer.beginFrame({screenSize}, consoleBackground);
        const top = layers([0xFF0000, 0xFF0000, null, null]);
        const bottom = layers([null, 0x00FF00, null, null]);
        buffer.mergeRgbSplitLayer(top.depth, top.color, bottom.depth, bottom.color);
        expect(buffer.flush()).toBe("\x1b[44m\x1b[30m" + FG(0xFF0000) + "▀" + BG(0x00FF00) + "▀" + consoleBackground + " " + RESET);
    });

    test("a black covered half is not mistaken for an uncovered one", () => {
        const buffer = makeBuffer();
        const top = layers([0x000000, null, null, null]);
        const bottom = layers([null, null, null, null]);
        buffer.mergeRgbSplitLayer(top.depth, top.color, bottom.depth, bottom.color);
        expect(buffer.splitRgbAt(0, 0)).toEqual([0x000000, undefined]);
        expect(buffer.flush()).toBe(DEFAULT_BG + FG(0x000000) + "▀" + "..." + RESET);
    });

    test("equal halves collapse to a plain color cell and share runs with neighbours", () => {
        const buffer = makeBuffer();
        const top = layers([0x00FF00, 0x00FF00, null, null]);
        const bottom = layers([0x00FF00, 0x00FF00, null, null]);
        buffer.mergeRgbSplitLayer(top.depth, top.color, bottom.depth, bottom.color);
        expect(buffer.flush()).toBe(BG(0x00FF00) + "  " + ".." + RESET);
    });

    test("identical split cells continue the run with just the glyph, and only changed colors re-escape", () => {
        const buffer = makeBuffer();
        const top = layers([0xFF0000, 0xFF0000, 0xFF0000, 0xFF0000]);
        const bottom = layers([0x0000FF, 0x0000FF, 0x00FF00, 0x00FF00]);
        buffer.mergeRgbSplitLayer(top.depth, top.color, bottom.depth, bottom.color);
        expect(buffer.flush()).toBe(FG(0xFF0000) + BG(0x0000FF) + "▀▀" + BG(0x00FF00) + "▀▀" + RESET);
    });

    test("a solid cell after a split cell with the same bottom color needs no new escape", () => {
        const buffer = makeBuffer();
        const top = layers([0xFF0000, 0x0000FF, null, null]);
        const bottom = layers([0x0000FF, 0x0000FF, null, null]);
        buffer.mergeRgbSplitLayer(top.depth, top.color, bottom.depth, bottom.color);
        expect(buffer.flush()).toBe(FG(0xFF0000) + BG(0x0000FF) + "▀" + " " + ".." + RESET);
    });

    test("a nearer text cell overrides a split cell and a farther one does not", () => {
        const buffer = makeBuffer();
        const top = layers([0xFF0000, 0xFF0000, null, null]);
        const bottom = layers([0x0000FF, 0x0000FF, null, null]);
        buffer.mergeRgbSplitLayer(top.depth, top.color, bottom.depth, bottom.color);
        buffer.setPixel("X", 0, 0, 0.5);
        buffer.setPixel("Y", 1, 0, 2);
        expect(buffer.splitRgbAt(0, 0)).toBeUndefined();
        expect(buffer.splitRgbAt(1, 0)).toEqual([0xFF0000, 0x0000FF]);
        expect(buffer.flush().startsWith("X")).toBe(true);
    });

    test("the cell depth is the nearer half, so a farther split layer loses to an existing cell", () => {
        const buffer = makeBuffer();
        const near = layers([0x111111, null, null, null]);
        buffer.mergeRgbLayer(near.depth, near.color);
        const top = layers([0xFF0000, null, null, null]);
        top.depth[0] = 5;
        const bottom = layers([null, null, null, null]);
        buffer.mergeRgbSplitLayer(top.depth, top.color, bottom.depth, bottom.color);
        expect(buffer.rgbAt(0, 0)).toBe(0x111111);
    });
});
