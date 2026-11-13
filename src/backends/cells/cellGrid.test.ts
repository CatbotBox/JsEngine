import {describe, expect, test} from "../../engine/testing/harness";
import {ScreenBuffer} from "./cellGrid";
import {CellKind, NO_COLOR, copyCellFrame, isCellFrame, cellFrameBuffers} from "./cellFrame";
import type {CellBackgroundStyle} from "./cellFrame";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {TextColor} from "../../engine/rendering/textColor";
import {TextSprite} from "../../engine/rendering/textSprite";

const WIDTH = 4, HEIGHT = 1;
const DOT_BACKGROUND: CellBackgroundStyle = {glyph: ".".codePointAt(0)!, foreground: TextColor.DEFAULT, background: TextColor.DEFAULT};

function makeBuffer(width = WIDTH, height = HEIGHT, background: CellBackgroundStyle = DOT_BACKGROUND): ScreenBuffer {
    const screenSize = new ScreenSize();
    screenSize.x = width;
    screenSize.y = height;
    const buffer = new ScreenBuffer();
    buffer.beginFrame({screenSize}, background);
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
    test("a split cell keeps its top and bottom colours", () => {
        const buffer = makeBuffer();
        const top = layers([0xFF0000, null, null, null]);
        const bottom = layers([0x0000FF, null, null, null]);
        buffer.mergeRgbSplitLayer(top.depth, top.color, bottom.depth, bottom.color);
        expect(buffer.splitRgbAt(0, 0)).toEqual([0xFF0000, 0x0000FF]);
        expect(buffer.rgbAt(0, 0)).toBeUndefined();
    });

    test("an uncovered half is reported as missing, and a black covered half is not mistaken for one", () => {
        const buffer = makeBuffer();
        const top = layers([0x000000, null, null, null]);
        const bottom = layers([null, 0x0000FF, null, null]);
        buffer.mergeRgbSplitLayer(top.depth, top.color, bottom.depth, bottom.color);
        expect(buffer.splitRgbAt(0, 0)).toEqual([0x000000, undefined]);
        expect(buffer.splitRgbAt(1, 0)).toEqual([undefined, 0x0000FF]);
    });

    test("a nearer text cell overrides a split cell and a farther one does not", () => {
        const buffer = makeBuffer();
        const top = layers([0xFF0000, 0xFF0000, null, null]);
        const bottom = layers([0x0000FF, 0x0000FF, null, null]);
        buffer.mergeRgbSplitLayer(top.depth, top.color, bottom.depth, bottom.color);
        buffer.setText(0, 0, 0.5, 0x58, TextColor.DEFAULT, TextColor.DEFAULT);
        buffer.setText(1, 0, 2, 0x59, TextColor.DEFAULT, TextColor.DEFAULT);
        expect(buffer.splitRgbAt(0, 0)).toBeUndefined();
        expect(buffer.glyphAt(0, 0)).toBe(0x58);
        expect(buffer.splitRgbAt(1, 0)).toEqual([0xFF0000, 0x0000FF]);
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

describe("ScreenBuffer cell frame", () => {
    test("exposes every cell kind with its colours and the frame's background style", () => {
        const buffer = makeBuffer();
        const solid = layers([0x123456, null, null, null]);
        buffer.mergeRgbLayer(solid.depth, solid.color);
        const top = layers([null, 0xFF0000, null, null]);
        const bottom = layers([null, null, null, null]);
        buffer.mergeRgbSplitLayer(top.depth, top.color, bottom.depth, bottom.color);
        buffer.setText(2, 0, 0, 0x41, TextColor.GREEN, TextColor.rgb(1, 2, 3));

        const frame = buffer.toCellFrame();
        expect(frame.width).toBe(WIDTH);
        expect(frame.height).toBe(HEIGHT);
        expect(Array.from(frame.kind)).toEqual([CellKind.Rgb, CellKind.RgbSplit, CellKind.Text, CellKind.Background]);
        expect(frame.rgb[0]).toBe(0x123456);
        expect([frame.rgbTop[1], frame.rgb[1]]).toEqual([0xFF0000, NO_COLOR]);
        expect([frame.glyph[2], frame.foreground[2], frame.background[2]]).toEqual([0x41, TextColor.GREEN, TextColor.rgb(1, 2, 3)]);
        expect(frame.backgroundStyle).toEqual(DOT_BACKGROUND);
        expect(isCellFrame(frame)).toBe(true);
    });

    test("a split cell with equal halves is resolved into a plain RGB cell", () => {
        const buffer = makeBuffer();
        const top = layers([0x00FF00, 0x00FF00, null, null]);
        const bottom = layers([0x00FF00, 0x0000FF, null, null]);
        buffer.mergeRgbSplitLayer(top.depth, top.color, bottom.depth, bottom.color);
        const frame = buffer.toCellFrame();
        expect(frame.kind[0]).toBe(CellKind.Rgb);
        expect(frame.rgb[0]).toBe(0x00FF00);
        expect(frame.kind[1]).toBe(CellKind.RgbSplit);
        expect(buffer.rgbAt(0, 0)).toBe(0x00FF00);
        expect(buffer.splitRgbAt(0, 0)).toBeUndefined();
    });

    test("text sprites blit their glyphs and colours and skip transparent cells", () => {
        const buffer = makeBuffer();
        const sprite = new TextSprite();
        sprite.foreground = TextColor.CYAN;
        sprite.image = ["a b😀c"];
        buffer.blit(sprite, 0, 0, 0);
        const frame = buffer.toCellFrame();
        expect(Array.from(frame.kind)).toEqual([CellKind.Text, CellKind.Background, CellKind.Text, CellKind.Text]);
        expect([frame.glyph[0], frame.glyph[2], frame.glyph[3]]).toEqual([0x61, 0x62, 0x1F600]);
        expect(frame.foreground[0]).toBe(TextColor.CYAN);
    });

    test("written text is clipped to the grid", () => {
        const buffer = makeBuffer();
        buffer.writeText("ERROR", 1, 0, Number.NEGATIVE_INFINITY, TextColor.RED, TextColor.DEFAULT);
        buffer.writeText("ignored", 0, 1, Number.NEGATIVE_INFINITY, TextColor.RED, TextColor.DEFAULT);
        expect([buffer.glyphAt(0, 0), buffer.glyphAt(1, 0), buffer.glyphAt(3, 0)]).toEqual([undefined, 0x45, 0x52]);
    });

    test("a copy owns fresh buffers that can be transferred", () => {
        const buffer = makeBuffer();
        const frame = buffer.toCellFrame();
        const copy = copyCellFrame(frame);
        expect(copy).toEqual(frame);
        const originals = new Set(cellFrameBuffers(frame));
        const copies = cellFrameBuffers(copy);
        expect(copies.some(copied => originals.has(copied))).toBe(false);
        expect(new Set(copies).size).toBe(copies.length);
    });

    test("frame validation checks sizes, array types and the background style", () => {
        const frame = makeBuffer().toCellFrame();
        expect(isCellFrame(frame)).toBe(true);
        expect(isCellFrame({...frame, width: WIDTH + 1})).toBe(false);
        expect(isCellFrame({...frame, glyph: new Int32Array(WIDTH)})).toBe(false);
        expect(isCellFrame({...frame, backgroundStyle: {...DOT_BACKGROUND, foreground: -1}})).toBe(false);
        expect(isCellFrame({...frame, width: -1})).toBe(false);
        expect(isCellFrame(null)).toBe(false);
    });
});
