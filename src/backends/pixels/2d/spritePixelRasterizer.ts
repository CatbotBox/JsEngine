import {WHITE_RGB, RED_SHIFT, GREEN_SHIFT, CHANNEL_MASK, CHANNEL_MAX} from "../../../engine/rendering/packedRgb";
import {SPRITE_PIXELS_PER_SCREEN_UNIT_X, SPRITE_PIXELS_PER_SCREEN_UNIT_Y} from "../../../engine/rendering/screenUnits";
import {RGBA_BYTES_PER_PIXEL} from "../pixelFrame";
import type {PixelFramebuffer} from "../pixelFramebuffer";

const ALPHA_BYTE_OFFSET = 3;
const GREEN_BYTE_OFFSET = 1;
const BLUE_BYTE_OFFSET = 2;

export interface SpritePixelRasterizerConfig {
    maxDepthFade: number;
}

export interface SpritePixelSource {
    readonly sizeX: number;
    readonly sizeY: number;
    readonly rgba: Uint8Array;
}

export function spriteWidthPx(sizeX: number, unitWidthPx: number): number {
    return Math.round(sizeX * unitWidthPx / SPRITE_PIXELS_PER_SCREEN_UNIT_X);
}

export function spriteHeightPx(sizeY: number, unitHeightPx: number): number {
    return Math.round(sizeY * unitHeightPx / SPRITE_PIXELS_PER_SCREEN_UNIT_Y);
}

function clampToByte(value: number): number {
    return value <= 0 ? 0 : value >= CHANNEL_MAX ? CHANNEL_MAX : Math.round(value);
}

function depthFadeOf(depth: number, maxDepthFade: number): number {
    if (maxDepthFade === Number.POSITIVE_INFINITY) return 1;
    const fade = 1 - depth / maxDepthFade;
    return fade < 0 ? 0 : fade > 1 ? 1 : fade;
}

export class SpritePixelRasterizer {
    private framebuffer!: PixelFramebuffer;
    private config!: SpritePixelRasterizerConfig;

    public beginFrame(framebuffer: PixelFramebuffer, config: SpritePixelRasterizerConfig): void {
        this.framebuffer = framebuffer;
        this.config = config;
    }

    public blitSprite(
        image: SpritePixelSource, xPx: number, yPx: number, destinationWidthPx: number, destinationHeightPx: number,
        depth: number, tint: number = WHITE_RGB, opacity: number = 1,
    ): void {
        if (opacity <= 0) return;
        const {sizeX, sizeY, rgba} = image;
        if (sizeX === 0 || sizeY === 0 || destinationWidthPx <= 0 || destinationHeightPx <= 0) return;

        const framebuffer = this.framebuffer;
        const framebufferWidthPx = framebuffer.widthPx;
        const left = Math.max(0, xPx), right = Math.min(framebufferWidthPx, xPx + destinationWidthPx);
        const top = Math.max(0, yPx), bottom = Math.min(framebuffer.heightPx, yPx + destinationHeightPx);
        if (left >= right || top >= bottom) return;

        const fade = depthFadeOf(depth, this.config.maxDepthFade);
        const tinted = tint !== WHITE_RGB;
        const tintR = ((tint >> RED_SHIFT) & CHANNEL_MASK) / CHANNEL_MAX;
        const tintG = ((tint >> GREEN_SHIFT) & CHANNEL_MASK) / CHANNEL_MAX;
        const tintB = (tint & CHANNEL_MASK) / CHANNEL_MAX;

        for (let y = top; y < bottom; y++) {
            const sourceRow = Math.floor((y - yPx) * sizeY / destinationHeightPx) * sizeX;
            const rowIndex = y * framebufferWidthPx;
            for (let x = left; x < right; x++) {
                const p = (sourceRow + Math.floor((x - xPx) * sizeX / destinationWidthPx)) * RGBA_BYTES_PER_PIXEL;
                const alpha = (rgba[p + ALPHA_BYTE_OFFSET] / CHANNEL_MAX) * opacity;
                if (alpha <= 0) continue;

                let r: number = rgba[p], g: number = rgba[p + GREEN_BYTE_OFFSET], b: number = rgba[p + BLUE_BYTE_OFFSET];
                if (tinted) {
                    r *= tintR;
                    g *= tintG;
                    b *= tintB;
                }
                if (fade < 1) {
                    r *= fade;
                    g *= fade;
                    b *= fade;
                }
                framebuffer.blendRgb(rowIndex + x, depth, (clampToByte(r) << RED_SHIFT) | (clampToByte(g) << GREEN_SHIFT) | clampToByte(b), alpha);
            }
        }
    }
}
