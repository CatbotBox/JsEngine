import {describe, expect, test} from "../../../engine/testing/harness";
import type {SubsampleLayers} from "../../../engine/rendering/3d/software";
import {PixelFramebuffer} from "../pixelFramebuffer";
import {PixelResolveTarget} from "./pixelResolveTarget";

const BACKGROUND_RGB = 0x000000;
const INF = Number.POSITIVE_INFINITY;
const RED_RGB = 0xFF0000, BLUE_RGB = 0x0000FF, WHITE_RGB = 0xFFFFFF;
const NEAR = 1, MIDDLE = 2, FAR = 5;

function layers(width: number, height: number, supersampleX: number, supersampleY: number, depth: number[], color: number[]): SubsampleLayers {
    return {
        depth: new Float32Array(depth),
        color: new Int32Array(color),
        width,
        height,
        supersampleX,
        supersampleY,
        rowsPerCell: supersampleY,
        rasterWidth: width * supersampleX,
        rasterHeight: height * supersampleY,
        halfBlock: false,
    };
}

function framebuffer(widthPx: number, heightPx: number): PixelFramebuffer {
    const buffer = new PixelFramebuffer();
    buffer.beginFrame({widthPx, heightPx}, BACKGROUND_RGB, 1);
    return buffer;
}

describe("PixelResolveTarget", () => {
    test("box-filters the subsamples of a raster pixel and keeps the nearest depth", () => {
        const buffer = framebuffer(1, 1);
        const target = new PixelResolveTarget();
        target.begin(buffer, 1);
        target.composite(layers(1, 1, 2, 1, [MIDDLE, NEAR], [RED_RGB, BLUE_RGB]));
        expect(buffer.rgbAt(0, 0)).toBe(0x800080);
        expect(buffer.depthAt(0, 0)).toBe(NEAR);
    });

    test("blends uncovered subsamples with the colour already in the framebuffer", () => {
        const buffer = framebuffer(1, 1);
        buffer.writeRgb(0, FAR, BLUE_RGB);
        const target = new PixelResolveTarget();
        target.begin(buffer, 1);
        target.composite(layers(1, 1, 2, 2, [NEAR, INF, INF, INF], [WHITE_RGB, 0, 0, 0]));
        expect(buffer.rgbAt(0, 0)).toBe(0x4040FF);
    });

    test("upscales each raster pixel to a block, clipped at the framebuffer edge", () => {
        const buffer = framebuffer(3, 3);
        const target = new PixelResolveTarget();
        target.begin(buffer, 2);
        target.composite(layers(2, 2, 1, 1, [NEAR, NEAR, NEAR, INF], [RED_RGB, BLUE_RGB, WHITE_RGB, 0]));
        const rows = Array.from({length: 3}, (_, y) => Array.from({length: 3}, (_, x) => buffer.rgbAt(x, y)));
        expect(rows).toEqual([
            [RED_RGB, RED_RGB, BLUE_RGB],
            [RED_RGB, RED_RGB, BLUE_RGB],
            [WHITE_RGB, WHITE_RGB, BACKGROUND_RGB],
        ]);
    });

    test("merges flushes: a later batch only wins where it is nearer or ties", () => {
        const buffer = framebuffer(2, 1);
        const target = new PixelResolveTarget();
        target.begin(buffer, 1);
        target.composite(layers(2, 1, 1, 1, [NEAR, FAR], [RED_RGB, RED_RGB]));
        target.composite(layers(2, 1, 1, 1, [MIDDLE, MIDDLE], [BLUE_RGB, BLUE_RGB]));
        expect([buffer.rgbAt(0, 0), buffer.rgbAt(1, 0)]).toEqual([RED_RGB, BLUE_RGB]);
        target.composite(layers(2, 1, 1, 1, [NEAR, INF], [WHITE_RGB, 0]));
        expect([buffer.rgbAt(0, 0), buffer.rgbAt(1, 0)]).toEqual([WHITE_RGB, BLUE_RGB]);
    });
});
