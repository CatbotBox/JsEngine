import {describe, expect, test} from "../../engine/testing/harness";
import {RGBA_BYTES_PER_PIXEL} from "../../backends/pixels/pixelFrame";
import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import {PixelFrameBufferPool} from "./pixelFrameBufferPool";

const CAPACITY = 2;
const PIXELS_PER_SCREEN_UNIT_X = 8;
const PIXELS_PER_SCREEN_UNIT_Y = 16;
const FIRST_RED = 9;
const STALE_BYTE = 200;

function frameOf(widthPx: number, heightPx: number): PixelFrame {
    const rgba = new Uint8ClampedArray(widthPx * heightPx * RGBA_BYTES_PER_PIXEL);
    rgba[0] = FIRST_RED;
    return {widthPx, heightPx, rgba, pixelsPerScreenUnitX: PIXELS_PER_SCREEN_UNIT_X, pixelsPerScreenUnitY: PIXELS_PER_SCREEN_UNIT_Y};
}

function bytesOf(widthPx: number, heightPx: number): number {
    return widthPx * heightPx * RGBA_BYTES_PER_PIXEL;
}

describe("PixelFrameBufferPool", () => {
    test("an empty pool copies into a fresh buffer of exactly the frame's size", () => {
        const pool = new PixelFrameBufferPool(CAPACITY);
        const frame = frameOf(4, 2);
        const copy = pool.copy(frame);
        expect(copy).toEqual(frame);
        expect(copy.rgba.buffer).not.toBe(frame.rgba.buffer);
        expect(copy.rgba.buffer.byteLength).toBe(bytesOf(4, 2));
    });

    test("a returned buffer of the frame's size is reused, overwritten with the new frame", () => {
        const pool = new PixelFrameBufferPool(CAPACITY);
        const returned = new ArrayBuffer(bytesOf(4, 2));
        new Uint8ClampedArray(returned).fill(STALE_BYTE);
        pool.give(returned);
        const frame = frameOf(4, 2);
        const copy = pool.copy(frame);
        expect(copy.rgba.buffer).toBe(returned);
        expect(copy).toEqual(frame);
        expect(pool.pooledCount).toBe(0);
        expect(pool.copy(frame).rgba.buffer).not.toBe(returned);
    });

    test("a frame of another size allocates and drops the buffers that no longer fit", () => {
        const pool = new PixelFrameBufferPool(CAPACITY);
        const old = new ArrayBuffer(bytesOf(4, 2));
        pool.give(old);
        const copy = pool.copy(frameOf(8, 4));
        expect(copy.rgba.buffer).not.toBe(old);
        expect(copy.rgba.buffer.byteLength).toBe(bytesOf(8, 4));
        expect(pool.pooledCount).toBe(0);
    });

    test("keeps at most its capacity, dropping the oldest, and ignores detached buffers", () => {
        const pool = new PixelFrameBufferPool(CAPACITY);
        const first = new ArrayBuffer(bytesOf(2, 2));
        const second = new ArrayBuffer(bytesOf(2, 2));
        const third = new ArrayBuffer(bytesOf(2, 2));
        pool.give(first);
        pool.give(second);
        pool.give(third);
        pool.give(new ArrayBuffer(0));
        expect(pool.pooledCount).toBe(CAPACITY);
        expect(pool.take(bytesOf(2, 2))).toBe(second);
        expect(pool.take(bytesOf(2, 2))).toBe(third);
        expect(pool.take(bytesOf(2, 2))).toBeUndefined();
    });

    test("copies only the frame's own bytes when its rgba is a view into a larger buffer", () => {
        const pool = new PixelFrameBufferPool(CAPACITY);
        const larger = new ArrayBuffer(bytesOf(16, 16));
        const rgba = new Uint8ClampedArray(larger, 0, bytesOf(2, 1));
        rgba[0] = FIRST_RED;
        const frame: PixelFrame = {widthPx: 2, heightPx: 1, rgba, pixelsPerScreenUnitX: PIXELS_PER_SCREEN_UNIT_X, pixelsPerScreenUnitY: PIXELS_PER_SCREEN_UNIT_Y};
        const copy = pool.copy(frame);
        expect(copy.rgba.buffer.byteLength).toBe(bytesOf(2, 1));
        expect(copy.rgba[0]).toBe(FIRST_RED);
    });
});
