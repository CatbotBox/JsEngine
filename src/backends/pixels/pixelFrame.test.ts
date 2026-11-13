import {describe, expect, test} from "../../engine/testing/harness";
import {copyPixelFrame, isPixelFrame, pixelFrameBuffers, RGBA_BYTES_PER_PIXEL} from "./pixelFrame";
import type {PixelFrame} from "./pixelFrame";

const WIDTH_PX = 3, HEIGHT_PX = 2;
const PIXELS_PER_UNIT_X = 8, PIXELS_PER_UNIT_Y = 16;

function frame(overrides: Partial<Record<keyof PixelFrame, unknown>> = {}): unknown {
    return {
        widthPx: WIDTH_PX,
        heightPx: HEIGHT_PX,
        rgba: new Uint8ClampedArray(WIDTH_PX * HEIGHT_PX * RGBA_BYTES_PER_PIXEL),
        pixelsPerScreenUnitX: PIXELS_PER_UNIT_X,
        pixelsPerScreenUnitY: PIXELS_PER_UNIT_Y,
        ...overrides,
    };
}

describe("PixelFrame", () => {
    test("isPixelFrame accepts a frame whose RGBA bytes match its size, including an empty one", () => {
        expect(isPixelFrame(frame())).toBe(true);
        expect(isPixelFrame(frame({widthPx: 0, heightPx: 0, rgba: new Uint8ClampedArray(0)}))).toBe(true);
    });

    test("isPixelFrame rejects wrong sizes, array types and scales", () => {
        expect(isPixelFrame(undefined)).toBe(false);
        expect(isPixelFrame(frame({widthPx: 2}))).toBe(false);
        expect(isPixelFrame(frame({heightPx: 1.5}))).toBe(false);
        expect(isPixelFrame(frame({widthPx: -1}))).toBe(false);
        expect(isPixelFrame(frame({rgba: new Uint8Array(WIDTH_PX * HEIGHT_PX * RGBA_BYTES_PER_PIXEL)}))).toBe(false);
        expect(isPixelFrame(frame({pixelsPerScreenUnitX: 0}))).toBe(false);
        expect(isPixelFrame(frame({pixelsPerScreenUnitY: Number.NaN}))).toBe(false);
        expect(isPixelFrame(frame({pixelsPerScreenUnitY: "16"}))).toBe(false);
    });

    test("copyPixelFrame copies the bytes, pixelFrameBuffers lists the copy's buffer for transfer", () => {
        const original = frame() as PixelFrame;
        original.rgba[0] = 7;
        const copy = copyPixelFrame(original);
        original.rgba[0] = 9;
        expect(copy.rgba[0]).toBe(7);
        expect([copy.widthPx, copy.heightPx, copy.pixelsPerScreenUnitX, copy.pixelsPerScreenUnitY]).toEqual([WIDTH_PX, HEIGHT_PX, PIXELS_PER_UNIT_X, PIXELS_PER_UNIT_Y]);
        expect(pixelFrameBuffers(copy)).toEqual([copy.rgba.buffer]);
        expect(pixelFrameBuffers(copy)[0] === original.rgba.buffer).toBe(false);
    });
});
