import {describe, expect, test} from "../../engine/testing/harness";
import {mixRgb, PixelFramebuffer, pixelOfRgb, rgbOfPixel} from "./pixelFramebuffer";

const SIZE = {widthPx: 4, heightPx: 3};
const BACKGROUND_RGB = 0x102030;
const PIXELS_PER_UNIT_X = 8;
const RED_RGB = 0xFF0000, BLUE_RGB = 0x0000FF;
const NEAR = 1, FAR = 5;
const HALF = 0.5;

function framebuffer(): PixelFramebuffer {
    const buffer = new PixelFramebuffer();
    buffer.beginFrame(SIZE, BACKGROUND_RGB, PIXELS_PER_UNIT_X);
    return buffer;
}

describe("PixelFramebuffer", () => {
    test("begins a frame filled with the opaque background, at infinite depth, with a 1:2 screen unit", () => {
        const buffer = framebuffer();
        const frame = buffer.toPixelFrame();
        expect([frame.widthPx, frame.heightPx, frame.pixelsPerScreenUnitX, frame.pixelsPerScreenUnitY]).toEqual([4, 3, 8, 16]);
        expect(Array.from(frame.rgba.subarray(0, 4))).toEqual([0x10, 0x20, 0x30, 0xFF]);
        expect(Array.from(frame.rgba.subarray(frame.rgba.length - 4))).toEqual([0x10, 0x20, 0x30, 0xFF]);
        expect(buffer.depthAt(3, 2)).toBe(Number.POSITIVE_INFINITY);
    });

    test("writes pixels as RGBA bytes through the little-endian Uint32 view", () => {
        const buffer = framebuffer();
        buffer.writeRgb(1, NEAR, 0x123456);
        const frame = buffer.toPixelFrame();
        expect(Array.from(frame.rgba.subarray(4, 8))).toEqual([0x12, 0x34, 0x56, 0xFF]);
        expect(buffer.rgbAt(1, 0)).toBe(0x123456);
        expect(rgbOfPixel(pixelOfRgb(0xABCDEF))).toBe(0xABCDEF);
    });

    test("a write keeps the nearer pixel and wins ties", () => {
        const buffer = framebuffer();
        buffer.writeRgb(0, NEAR, RED_RGB);
        buffer.writeRgb(0, FAR, BLUE_RGB);
        expect(buffer.rgbAt(0, 0)).toBe(RED_RGB);
        buffer.writeRgb(0, NEAR, BLUE_RGB);
        expect(buffer.rgbAt(0, 0)).toBe(BLUE_RGB);
        expect(buffer.depthAt(0, 0)).toBe(NEAR);
    });

    test("blending mixes with the colour already there, skips invisible pixels and respects depth", () => {
        const buffer = framebuffer();
        buffer.writeRgb(0, FAR, 0x000000);
        buffer.blendRgb(0, NEAR, 0xFF8000, HALF);
        expect(buffer.rgbAt(0, 0)).toBe(0x804000);
        expect(buffer.depthAt(0, 0)).toBe(NEAR);
        buffer.blendRgb(0, FAR, RED_RGB, 1);
        expect(buffer.rgbAt(0, 0)).toBe(0x804000);
        buffer.blendRgb(1, NEAR, RED_RGB, 0);
        expect([buffer.rgbAt(1, 0), buffer.depthAt(1, 0)]).toEqual([BACKGROUND_RGB, Number.POSITIVE_INFINITY]);
        expect(mixRgb(0x000000, 0xFFFFFF, 1)).toBe(0xFFFFFF);
    });

    test("a new size reallocates, the same size reuses the buffer", () => {
        const buffer = framebuffer();
        const before = buffer.toPixelFrame().rgba;
        buffer.beginFrame(SIZE, BACKGROUND_RGB, PIXELS_PER_UNIT_X);
        expect(buffer.toPixelFrame().rgba).toBe(before);
        buffer.beginFrame({widthPx: 2, heightPx: 5}, BACKGROUND_RGB, 1);
        const resized = buffer.toPixelFrame();
        expect([resized.widthPx, resized.heightPx, resized.rgba.length, resized.pixelsPerScreenUnitY]).toEqual([2, 5, 40, 2]);
    });
});
