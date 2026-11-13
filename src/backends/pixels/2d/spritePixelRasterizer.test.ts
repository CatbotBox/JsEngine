import {describe, expect, test} from "../../../engine/testing/harness";
import {SpriteImage} from "../../../engine/rendering/2d/spriteImage";
import {PixelFramebuffer} from "../pixelFramebuffer";
import {SpritePixelRasterizer, spriteHeightPx, spriteWidthPx} from "./spritePixelRasterizer";
import type {SpritePixelRasterizerConfig} from "./spritePixelRasterizer";

const BACKGROUND_RGB = 0x000000;
const RED_RGB = 0xFF0000, GREEN_RGB = 0x00FF00, BLUE_RGB = 0x0000FF, WHITE = 0xFFFFFF;
const NEAR = 1, FAR = 5;
const HALF = 0.5;
const NO_FADE: SpritePixelRasterizerConfig = {maxDepthFade: Number.POSITIVE_INFINITY};

const TWO_BY_TWO = SpriteImage.fromPattern(["rg", "b."], {r: RED_RGB, g: GREEN_RGB, b: BLUE_RGB});

function setup(widthPx: number, heightPx: number, config: SpritePixelRasterizerConfig = NO_FADE): {framebuffer: PixelFramebuffer, rasterizer: SpritePixelRasterizer} {
    const framebuffer = new PixelFramebuffer();
    framebuffer.beginFrame({widthPx, heightPx}, BACKGROUND_RGB, 1);
    const rasterizer = new SpritePixelRasterizer();
    rasterizer.beginFrame(framebuffer, config);
    return {framebuffer, rasterizer};
}

function rows(framebuffer: PixelFramebuffer): number[][] {
    return Array.from({length: framebuffer.heightPx}, (_, y) => Array.from({length: framebuffer.widthPx}, (_, x) => framebuffer.rgbAt(x, y)));
}

describe("SpritePixelRasterizer", () => {
    test("nearest-scales each sprite pixel to a square block, transparent pixels left alone", () => {
        const {framebuffer, rasterizer} = setup(4, 4);
        rasterizer.blitSprite(TWO_BY_TWO, 0, 0, 4, 4, NEAR);
        expect(rows(framebuffer)).toEqual([
            [RED_RGB, RED_RGB, GREEN_RGB, GREEN_RGB],
            [RED_RGB, RED_RGB, GREEN_RGB, GREEN_RGB],
            [BLUE_RGB, BLUE_RGB, BACKGROUND_RGB, BACKGROUND_RGB],
            [BLUE_RGB, BLUE_RGB, BACKGROUND_RGB, BACKGROUND_RGB],
        ]);
        expect(framebuffer.depthAt(3, 3)).toBe(Number.POSITIVE_INFINITY);
    });

    test("clips against every edge", () => {
        const {framebuffer, rasterizer} = setup(3, 3);
        rasterizer.blitSprite(TWO_BY_TWO, -2, -2, 4, 4, NEAR);
        rasterizer.blitSprite(TWO_BY_TWO, 2, 2, 4, 4, NEAR);
        expect(rows(framebuffer)).toEqual([
            [BACKGROUND_RGB, BACKGROUND_RGB, BACKGROUND_RGB],
            [BACKGROUND_RGB, BACKGROUND_RGB, BACKGROUND_RGB],
            [BACKGROUND_RGB, BACKGROUND_RGB, RED_RGB],
        ]);
    });

    test("tints, blends opacity over what is already drawn and respects depth", () => {
        const {framebuffer, rasterizer} = setup(2, 1);
        const white = SpriteImage.solid(1, 1, WHITE);
        framebuffer.writeRgb(1, FAR, BLUE_RGB);
        rasterizer.blitSprite(white, 0, 0, 1, 1, NEAR, 0x804020);
        rasterizer.blitSprite(white, 1, 0, 1, 1, NEAR, RED_RGB, HALF);
        expect([framebuffer.rgbAt(0, 0), framebuffer.rgbAt(1, 0)]).toEqual([0x804020, 0x800080]);
        rasterizer.blitSprite(white, 0, 0, 1, 1, FAR, GREEN_RGB);
        expect(framebuffer.rgbAt(0, 0)).toBe(0x804020);
        rasterizer.blitSprite(white, 0, 0, 1, 1, NEAR, GREEN_RGB, 0);
        expect(framebuffer.rgbAt(0, 0)).toBe(0x804020);
    });

    test("fades toward black with depth when a fade distance is set", () => {
        const {framebuffer, rasterizer} = setup(1, 1, {maxDepthFade: 10});
        rasterizer.blitSprite(SpriteImage.solid(1, 1, WHITE), 0, 0, 1, 1, FAR);
        expect(framebuffer.rgbAt(0, 0)).toBe(0x808080);
    });

    test("a sprite pixel is one screen unit wide and half a screen unit tall, so it stays square", () => {
        expect([spriteWidthPx(3, 8), spriteHeightPx(3, 16)]).toEqual([24, 24]);
        expect([spriteWidthPx(1, 1), spriteHeightPx(1, 2)]).toEqual([1, 1]);
    });
});
