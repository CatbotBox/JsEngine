import {describe, expect, test} from "../../engine/testing/harness";
import {BITMAP_BYTES_PER_PIXEL, bitmapWidthPx, drawnPixelsIn, pixelHashIn, scaledRect} from "./capturedViews";

const WIDTH_PX = 4;
const HEIGHT_PX = 3;
const PAINTED = 200;

function bitmapWithPainted(points: readonly [number, number][]): Uint8Array {
    const bitmap = new Uint8Array(WIDTH_PX * HEIGHT_PX * BITMAP_BYTES_PER_PIXEL);
    for (const [x, y] of points) bitmap[(y * WIDTH_PX + x) * BITMAP_BYTES_PER_PIXEL] = PAINTED;
    return bitmap;
}

describe("captured views", () => {
    test("counts the pixels of a region that differ from the region's dominant colour, clipped to the bitmap", () => {
        const bitmap = bitmapWithPainted([[1, 1], [3, 2], [0, 2]]);
        expect(drawnPixelsIn(bitmap, WIDTH_PX, {left: 0, top: 0, width: WIDTH_PX, height: HEIGHT_PX})).toBe(3);
        expect(drawnPixelsIn(bitmap, WIDTH_PX, {left: 2, top: 0, width: 10, height: 10})).toBe(1);
        expect(drawnPixelsIn(bitmap, WIDTH_PX, {left: 1, top: 1, width: 1, height: 1})).toBe(0);
        expect(drawnPixelsIn(bitmap, WIDTH_PX, {left: 1, top: 1, width: 3, height: 2})).toBe(2);
        expect(drawnPixelsIn(bitmap, WIDTH_PX, {left: 5, top: 0, width: 2, height: 2})).toBe(0);
    });

    test("finds the bitmap's pixel width from its bytes and the captured size, and scales css rects to it", () => {
        expect(bitmapWidthPx(8 * 6 * BITMAP_BYTES_PER_PIXEL, {width: 4, height: 3})).toBe(8);
        expect(bitmapWidthPx(0, {width: 4, height: 3})).toBe(0);
        expect(scaledRect({left: 1, top: 2, width: 3, height: 4}, 2)).toEqual({left: 2, top: 4, width: 6, height: 8});
    });
});

describe("captured view hashes", () => {
    test("a region's hash follows its colours and its clip, so equal regions hash equal and changed ones differ", () => {
        const region = {left: 0, top: 0, width: WIDTH_PX, height: HEIGHT_PX};
        const painted = pixelHashIn(bitmapWithPainted([[1, 1]]), WIDTH_PX, region);
        expect(pixelHashIn(bitmapWithPainted([[1, 1]]), WIDTH_PX, region)).toBe(painted);
        expect(pixelHashIn(bitmapWithPainted([[2, 1]]), WIDTH_PX, region)).not.toBe(painted);
        expect(pixelHashIn(bitmapWithPainted([[1, 1]]), WIDTH_PX, {left: 0, top: 0, width: 2, height: 2})).not.toBe(painted);
        expect(pixelHashIn(bitmapWithPainted([[1, 1]]), WIDTH_PX, {left: 9, top: 9, width: 2, height: 2})).toBe(pixelHashIn(bitmapWithPainted([]), WIDTH_PX, {left: 9, top: 0, width: 1, height: 1}));
    });
});
