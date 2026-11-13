import {describe, expect, test} from "../../../engine/testing/harness";
import {ScreenBuffer} from "../../../backends/cells/cellGrid";
import type {CellBackgroundStyle} from "../../../backends/cells/cellFrame";
import {ScreenSize} from "../../../engine/rendering/screenSize";
import {TextColor} from "../../../engine/rendering/textColor";
import {AnsiCellEncoder, glyphText} from "./ansiCellEncoder";

const WIDTH = 4, HEIGHT = 1;
const FG = (c: number) => `\x1b[38;2;${(c >> 16) & 255};${(c >> 8) & 255};${c & 255}m`;
const BG = (c: number) => `\x1b[48;2;${(c >> 16) & 255};${(c >> 8) & 255};${c & 255}m`;
const RESET = "\x1b[0m";
const DEFAULT_BG = "\x1b[49m";
const DOT_BACKGROUND: CellBackgroundStyle = {glyph: ".".codePointAt(0)!, foreground: TextColor.DEFAULT, background: TextColor.DEFAULT};

function makeBuffer(background: CellBackgroundStyle = DOT_BACKGROUND, width = WIDTH): ScreenBuffer {
    const screenSize = new ScreenSize();
    screenSize.x = width;
    screenSize.y = HEIGHT;
    const buffer = new ScreenBuffer();
    buffer.beginFrame({screenSize}, background);
    return buffer;
}

function encode(buffer: ScreenBuffer): string {
    return new AnsiCellEncoder().encodeRows(buffer.toCellFrame()).join("\n");
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

function split(buffer: ScreenBuffer, topValues: (number | null)[], bottomValues: (number | null)[]): void {
    const top = layers(topValues);
    const bottom = layers(bottomValues);
    buffer.mergeRgbSplitLayer(top.depth, top.color, bottom.depth, bottom.color);
}

describe("AnsiCellEncoder half-block cells", () => {
    test("a split cell encodes as foreground top, background bottom and the upper half block", () => {
        const buffer = makeBuffer();
        split(buffer, [0xFF0000, null, null, null], [0x0000FF, null, null, null]);
        expect(encode(buffer)).toBe(FG(0xFF0000) + BG(0x0000FF) + "▀" + "..." + RESET);
    });

    test("an uncovered bottom half shows the console background under the upper half block", () => {
        const buffer = makeBuffer();
        split(buffer, [0xFF0000, null, null, null], [null, null, null, null]);
        expect(encode(buffer)).toBe(DEFAULT_BG + FG(0xFF0000) + "▀" + "..." + RESET);
    });

    test("an uncovered top half shows the console background above the lower half block", () => {
        const buffer = makeBuffer();
        split(buffer, [null, null, null, null], [0x0000FF, null, null, null]);
        expect(encode(buffer)).toBe(DEFAULT_BG + FG(0x0000FF) + "▄" + "..." + RESET);
    });

    test("an uncovered half reuses a colored console background's own escapes", () => {
        const consoleBackground = "\x1b[44m\x1b[30m ";
        const buffer = makeBuffer({glyph: 0x20, foreground: TextColor.BLACK, background: TextColor.BLUE});
        split(buffer, [0xFF0000, 0xFF0000, null, null], [null, 0x00FF00, null, null]);
        expect(encode(buffer)).toBe("\x1b[44m\x1b[30m" + FG(0xFF0000) + "▀" + BG(0x00FF00) + "▀" + consoleBackground + " " + RESET);
    });

    test("a black covered half is not mistaken for an uncovered one", () => {
        const buffer = makeBuffer();
        split(buffer, [0x000000, null, null, null], [null, null, null, null]);
        expect(encode(buffer)).toBe(DEFAULT_BG + FG(0x000000) + "▀" + "..." + RESET);
    });

    test("equal halves collapse to a plain color cell and share runs with neighbours", () => {
        const buffer = makeBuffer();
        split(buffer, [0x00FF00, 0x00FF00, null, null], [0x00FF00, 0x00FF00, null, null]);
        expect(encode(buffer)).toBe(BG(0x00FF00) + "  " + ".." + RESET);
    });

    test("identical split cells continue the run with just the glyph, and only changed colors re-escape", () => {
        const buffer = makeBuffer();
        split(buffer, [0xFF0000, 0xFF0000, 0xFF0000, 0xFF0000], [0x0000FF, 0x0000FF, 0x00FF00, 0x00FF00]);
        expect(encode(buffer)).toBe(FG(0xFF0000) + BG(0x0000FF) + "▀▀" + BG(0x00FF00) + "▀▀" + RESET);
    });

    test("a solid cell after a split cell with the same bottom color needs no new escape", () => {
        const buffer = makeBuffer();
        split(buffer, [0xFF0000, 0x0000FF, null, null], [0x0000FF, 0x0000FF, null, null]);
        expect(encode(buffer)).toBe(FG(0xFF0000) + BG(0x0000FF) + "▀" + " " + ".." + RESET);
    });

    test("a nearer text cell overrides a split cell", () => {
        const buffer = makeBuffer();
        split(buffer, [0xFF0000, 0xFF0000, null, null], [0x0000FF, 0x0000FF, null, null]);
        buffer.setText(0, 0, 0.5, 0x58, TextColor.DEFAULT, TextColor.DEFAULT);
        expect(encode(buffer).startsWith(RESET + "X" + RESET + FG(0xFF0000))).toBe(true);
    });
});

describe("AnsiCellEncoder background style", () => {
    test("the default cell background is palette black on palette black, never RGB black", () => {
        const buffer = makeBuffer({glyph: 0x20, foreground: TextColor.BLACK, background: TextColor.BLACK}, 2);
        expect(encode(buffer)).toBe("\x1b[40m\x1b[30m" + "  " + RESET);
    });

    test("a style without colours emits only its glyph and uncovered halves fall back to the default background", () => {
        const buffer = makeBuffer({glyph: 0x20, foreground: TextColor.DEFAULT, background: TextColor.DEFAULT});
        split(buffer, [0xFF0000, null, null, null], [null, null, null, null]);
        expect(encode(buffer)).toBe(DEFAULT_BG + FG(0xFF0000) + "▀" + "   " + RESET);
    });

    test("a style change between frames re-encodes the background", () => {
        const encoder = new AnsiCellEncoder();
        const first = makeBuffer({glyph: 0x20, foreground: TextColor.BLACK, background: TextColor.BLACK}, 1);
        const second = makeBuffer({glyph: 0x2E, foreground: TextColor.DEFAULT, background: TextColor.rgb(1, 2, 3)}, 1);
        expect(encoder.encodeRows(first.toCellFrame())).toEqual(["\x1b[40m\x1b[30m " + RESET]);
        expect(encoder.encodeRows(second.toCellFrame())).toEqual([BG(0x010203) + "." + RESET]);
    });
});

describe("AnsiCellEncoder text cells", () => {
    test("a text run starts from a reset, escapes only colour changes and resets before the next non-text cell", () => {
        const buffer = makeBuffer(DOT_BACKGROUND, 5);
        buffer.setText(0, 0, 0, 0x41, TextColor.GREEN, TextColor.DEFAULT);
        buffer.setText(1, 0, 0, 0x42, TextColor.GREEN, TextColor.DEFAULT);
        buffer.setText(2, 0, 0, 0x43, TextColor.DEFAULT, TextColor.BLUE);
        expect(encode(buffer)).toBe(RESET + "\x1b[32mAB" + "\x1b[39m\x1b[44mC" + RESET + ".." + RESET);
    });

    test("palette, bright, 256-colour, RGB and default colours map to their SGR codes", () => {
        const buffer = makeBuffer(DOT_BACKGROUND, 5);
        buffer.setText(0, 0, 0, 0x61, TextColor.RED, TextColor.WHITE);
        buffer.setText(1, 0, 0, 0x62, TextColor.BRIGHT_RED, TextColor.BRIGHT_WHITE);
        buffer.setText(2, 0, 0, 0x63, TextColor.palette(200), TextColor.palette(17));
        buffer.setText(3, 0, 0, 0x64, TextColor.rgb(1, 2, 3), TextColor.rgb(4, 5, 6));
        buffer.setText(4, 0, 0, 0x65, TextColor.DEFAULT, TextColor.DEFAULT);
        expect(encode(buffer)).toBe(RESET
            + "\x1b[31m\x1b[47ma"
            + "\x1b[91m\x1b[107mb"
            + "\x1b[38;5;200m\x1b[48;5;17mc"
            + "\x1b[38;2;1;2;3m\x1b[48;2;4;5;6md"
            + "\x1b[39m\x1b[49me"
            + RESET);
    });

    test("an RGB cell after text re-escapes its colour", () => {
        const buffer = makeBuffer(DOT_BACKGROUND, 2);
        buffer.setText(0, 0, 0, 0x41, TextColor.DEFAULT, TextColor.DEFAULT);
        const solid = layers([null, 0x112233]);
        buffer.mergeRgbLayer(solid.depth, solid.color);
        expect(encode(buffer)).toBe(RESET + "A" + RESET + BG(0x112233) + " " + RESET);
    });

    test("control characters never reach the terminal and astral glyphs stay whole", () => {
        expect(glyphText(0x1b)).toBe("�");
        expect(glyphText(0x0a)).toBe("�");
        expect(glyphText(0x7f)).toBe("�");
        expect(glyphText(0x9b)).toBe("�");
        expect(glyphText(0x110000)).toBe("�");
        expect(glyphText(0x1F600)).toBe("😀");
        expect(glyphText(0xA0)).toBe(" ");
    });

    test("a frame with no columns encodes each row as a lone reset, and no rows as nothing", () => {
        const encodeSized = (x: number, y: number) => {
            const screenSize = new ScreenSize();
            screenSize.x = x;
            screenSize.y = y;
            const buffer = new ScreenBuffer();
            buffer.beginFrame({screenSize}, DOT_BACKGROUND);
            return new AnsiCellEncoder().encodeRows(buffer.toCellFrame());
        };
        expect(encodeSized(0, 2)).toEqual([RESET, RESET]);
        expect(encodeSized(3, 0)).toEqual([]);
    });
});
