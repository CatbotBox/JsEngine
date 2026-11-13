import {describe, expect, test} from "../../../engine/testing/harness";
import {ScreenBuffer} from "../cellGrid";
import {ScreenSize} from "../../../engine/rendering/screenSize";
import {CellRenderSettings} from "../cellRenderSettings";
import {BlittableSpriteImage, SpriteCellRasterizer, SpriteCellRasterizerConfig} from "./spriteCellRasterizer";

const WIDTH = 4, HEIGHT = 2;

function makeBuffer(width = WIDTH, height = HEIGHT): ScreenBuffer {
    const screenSize = new ScreenSize();
    screenSize.x = width;
    screenSize.y = height;
    const buffer = new ScreenBuffer();
    buffer.beginFrame({screenSize}, CellRenderSettings.DEFAULT_BACKGROUND_STYLE);
    return buffer;
}

function config(overrides: Partial<SpriteCellRasterizerConfig> = {}): SpriteCellRasterizerConfig {
    return {
        maxDepthFade: Number.POSITIVE_INFINITY,
        colorQuantMask: 0xFFFFFF,
        backgroundColor: 0x000000,
        halfBlock: true,
        ...overrides,
    };
}

function solidSprite(width: number, height: number, color: number, alpha = 255): BlittableSpriteImage {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = (color >> 16) & 255;
        rgba[i + 1] = (color >> 8) & 255;
        rgba[i + 2] = color & 255;
        rgba[i + 3] = alpha;
    }
    return {sizeX: width, sizeY: height, rgba};
}

describe("SpriteCellRasterizer", () => {
    test("a one-pixel sprite at an even half-row covers only the cell's top half", () => {
        const buffer = makeBuffer();
        const raster = new SpriteCellRasterizer();
        raster.beginFrame(buffer, WIDTH, HEIGHT, config());
        raster.blitSprite(solidSprite(1, 1, 0xFF0000), 1, 0, 5);
        raster.endFrame();

        expect(buffer.splitRgbAt(1, 0)).toEqual([0xFF0000, undefined]);
        expect(buffer.rgbAt(0, 0)).toBeUndefined();
    });

    test("an odd half-row lands in the bottom half", () => {
        const buffer = makeBuffer();
        const raster = new SpriteCellRasterizer();
        raster.beginFrame(buffer, WIDTH, HEIGHT, config());
        raster.blitSprite(solidSprite(1, 1, 0x00FF00), 0, 3, 5);
        raster.endFrame();

        expect(buffer.splitRgbAt(0, 1)).toEqual([undefined, 0x00FF00]);
    });

    test("a two-row sprite fills both halves of one cell row", () => {
        const buffer = makeBuffer();
        const raster = new SpriteCellRasterizer();
        raster.beginFrame(buffer, WIDTH, HEIGHT, config());
        raster.blitSprite(solidSprite(1, 2, 0x123456), 2, 0, 5);
        raster.endFrame();

        expect(buffer.rgbAt(2, 0)).toBe(0x123456);
    });

    test("nearer depth wins per half, across separate blits", () => {
        const buffer = makeBuffer();
        const raster = new SpriteCellRasterizer();
        raster.beginFrame(buffer, WIDTH, HEIGHT, config());
        raster.blitSprite(solidSprite(1, 1, 0x0000FF), 0, 0, 10);
        raster.blitSprite(solidSprite(1, 1, 0xFF0000), 0, 0, 5);
        raster.blitSprite(solidSprite(1, 1, 0x00FF00), 0, 1, 20);
        raster.endFrame();

        expect(buffer.splitRgbAt(0, 0)).toEqual([0xFF0000, 0x00FF00]);
    });

    test("farther blit does not overwrite", () => {
        const buffer = makeBuffer();
        const raster = new SpriteCellRasterizer();
        raster.beginFrame(buffer, WIDTH, HEIGHT, config());
        raster.blitSprite(solidSprite(1, 1, 0xFF0000), 0, 0, 5);
        raster.blitSprite(solidSprite(1, 1, 0x0000FF), 0, 0, 10);
        raster.endFrame();

        expect(buffer.splitRgbAt(0, 0)).toEqual([0xFF0000, undefined]);
    });

    test("zero-alpha pixels are transparent", () => {
        const buffer = makeBuffer();
        const raster = new SpriteCellRasterizer();
        raster.beginFrame(buffer, WIDTH, HEIGHT, config());
        raster.blitSprite(solidSprite(1, 1, 0xFF0000, 0), 0, 0, 5);
        raster.endFrame();

        expect(buffer.splitRgbAt(0, 0)).toBeUndefined();
        expect(buffer.rgbAt(0, 0)).toBeUndefined();
    });

    test("translucent pixels blend toward the background color", () => {
        const buffer = makeBuffer();
        const raster = new SpriteCellRasterizer();
        raster.beginFrame(buffer, WIDTH, HEIGHT, config({backgroundColor: 0x000000}));
        raster.blitSprite(solidSprite(1, 1, 0xFF0000, 127.5), 0, 0, 5);
        raster.endFrame();

        const [top] = buffer.splitRgbAt(0, 0)!;
        expect((top! >> 16) & 255).toBeCloseTo(127, -1);
        expect(top! & 0xFFFF).toBe(0);
    });

    test("tint multiplies pixel colors", () => {
        const buffer = makeBuffer();
        const raster = new SpriteCellRasterizer();
        raster.beginFrame(buffer, WIDTH, HEIGHT, config());
        raster.blitSprite(solidSprite(1, 1, 0xFFFFFF), 0, 0, 5, 0x336699);
        raster.endFrame();

        expect(buffer.splitRgbAt(0, 0)).toEqual([0x336699, undefined]);
    });

    test("depth fade multiplies toward black like the 3D kernel", () => {
        const buffer = makeBuffer();
        const raster = new SpriteCellRasterizer();
        raster.beginFrame(buffer, WIDTH, HEIGHT, config({maxDepthFade: 10}));
        raster.blitSprite(solidSprite(1, 1, 0xFF0000), 0, 0, 5);
        raster.endFrame();

        const [top] = buffer.splitRgbAt(0, 0)!;
        expect((top! >> 16) & 255).toBeCloseTo(128, -1);
    });

    test("colorQuantMask is applied to the written color", () => {
        const buffer = makeBuffer();
        const raster = new SpriteCellRasterizer();
        raster.beginFrame(buffer, WIDTH, HEIGHT, config({colorQuantMask: 0xFCFCFC}));
        raster.blitSprite(solidSprite(1, 1, 0xFFFFFF), 0, 0, 5);
        raster.endFrame();

        expect(buffer.splitRgbAt(0, 0)).toEqual([0xFCFCFC, undefined]);
    });

    test("blits clip against all four frame edges", () => {
        const buffer = makeBuffer();
        const raster = new SpriteCellRasterizer();
        raster.beginFrame(buffer, WIDTH, HEIGHT, config());
        raster.blitSprite(solidSprite(3, 4, 0xAABBCC), -1, -2, 5);
        raster.blitSprite(solidSprite(2, 2, 0x112233), WIDTH - 1, HEIGHT * 2 - 1, 5);
        raster.endFrame();

        expect(buffer.rgbAt(0, 0)).toBe(0xAABBCC);
        expect(buffer.rgbAt(1, 0)).toBe(0xAABBCC);
        expect(buffer.rgbAt(2, 0)).toBeUndefined();
        expect(buffer.splitRgbAt(3, 1)).toEqual([undefined, 0x112233]);
    });

    test("halfBlock off: both halves covered average into one solid cell", () => {
        const buffer = makeBuffer();
        const raster = new SpriteCellRasterizer();
        raster.beginFrame(buffer, WIDTH, HEIGHT, config({halfBlock: false}));
        raster.blitSprite(solidSprite(1, 1, 0xFF0000), 0, 0, 5);
        raster.blitSprite(solidSprite(1, 1, 0x0000FF), 0, 1, 7);
        raster.endFrame();

        expect(buffer.rgbAt(0, 0)).toBe(0x7F007F);
        expect(buffer.splitRgbAt(0, 0)).toBeUndefined();
    });

    test("halfBlock off: an uncovered half averages toward the background color", () => {
        const buffer = makeBuffer();
        const raster = new SpriteCellRasterizer();
        raster.beginFrame(buffer, WIDTH, HEIGHT, config({halfBlock: false, backgroundColor: 0x000000}));
        raster.blitSprite(solidSprite(1, 1, 0xFF0000), 0, 0, 5);
        raster.endFrame();

        expect(buffer.rgbAt(0, 0)).toBe(0x7F0000);
    });

    test("sprites depth-composite against an RGB layer already in the buffer", () => {
        const buffer = makeBuffer();
        const cellCount = WIDTH * HEIGHT;
        const depth = new Float32Array(cellCount).fill(Number.POSITIVE_INFINITY);
        const color = new Int32Array(cellCount);
        depth[0] = 3;
        color[0] = 0x00FF00;
        buffer.mergeRgbLayer(depth, color);

        const raster = new SpriteCellRasterizer();
        raster.beginFrame(buffer, WIDTH, HEIGHT, config());
        raster.blitSprite(solidSprite(2, 2, 0xFF0000), 0, 0, 5);
        raster.endFrame();

        expect(buffer.rgbAt(0, 0)).toBe(0x00FF00);
        expect(buffer.rgbAt(1, 0)).toBe(0xFF0000);
    });
});
