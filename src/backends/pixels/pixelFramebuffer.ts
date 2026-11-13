import {Resource} from "../../engine/core";
import {CHANNEL_MASK, CHANNEL_MAX, GREEN_SHIFT, RED_SHIFT} from "../../engine/rendering/packedRgb";
import {SCREEN_UNIT_HEIGHT_PER_WIDTH} from "../../engine/rendering/screenUnits";
import {RGBA_BYTES_PER_PIXEL} from "./pixelFrame";
import type {PixelFrame} from "./pixelFrame";
import type {PixelPresenterSize} from "./pixelPresenter";

const PIXEL_RED_SHIFT = 0;
const PIXEL_GREEN_SHIFT = 8;
const PIXEL_BLUE_SHIFT = 16;
const PIXEL_ALPHA_SHIFT = 24;
const OPAQUE_ALPHA_BITS = CHANNEL_MAX << PIXEL_ALPHA_SHIFT;
const ENDIANNESS_PROBE = 1;
const NOT_LITTLE_ENDIAN = "PixelFramebuffer writes RGBA bytes through a Uint32Array view and needs a little-endian platform";

function platformIsLittleEndian(): boolean {
    return new Uint8Array(new Uint32Array([ENDIANNESS_PROBE]).buffer)[0] === ENDIANNESS_PROBE;
}

function clampToByte(value: number): number {
    return value <= 0 ? 0 : value >= CHANNEL_MAX ? CHANNEL_MAX : Math.round(value);
}

export function pixelOfRgb(rgb: number): number {
    return OPAQUE_ALPHA_BITS
        | ((rgb & CHANNEL_MASK) << PIXEL_BLUE_SHIFT)
        | (((rgb >> GREEN_SHIFT) & CHANNEL_MASK) << PIXEL_GREEN_SHIFT)
        | (((rgb >> RED_SHIFT) & CHANNEL_MASK) << PIXEL_RED_SHIFT);
}

export function rgbOfPixel(pixel: number): number {
    return (((pixel >> PIXEL_RED_SHIFT) & CHANNEL_MASK) << RED_SHIFT)
        | (((pixel >> PIXEL_GREEN_SHIFT) & CHANNEL_MASK) << GREEN_SHIFT)
        | ((pixel >> PIXEL_BLUE_SHIFT) & CHANNEL_MASK);
}

export function mixRgb(from: number, to: number, toWeight: number): number {
    const fromR = (from >> RED_SHIFT) & CHANNEL_MASK, fromG = (from >> GREEN_SHIFT) & CHANNEL_MASK, fromB = from & CHANNEL_MASK;
    const r = fromR + (((to >> RED_SHIFT) & CHANNEL_MASK) - fromR) * toWeight;
    const g = fromG + (((to >> GREEN_SHIFT) & CHANNEL_MASK) - fromG) * toWeight;
    const b = fromB + ((to & CHANNEL_MASK) - fromB) * toWeight;
    return (clampToByte(r) << RED_SHIFT) | (clampToByte(g) << GREEN_SHIFT) | clampToByte(b);
}

export class PixelFramebuffer extends Resource {
    private _widthPx = 0;
    private _heightPx = 0;
    private _pixelsPerScreenUnitX = 1;
    private _pixelsPerScreenUnitY = SCREEN_UNIT_HEIGHT_PER_WIDTH;
    private _rgba = new Uint8ClampedArray(0);
    private _pixels = new Uint32Array(0);
    private _depth = new Float32Array(0);

    public constructor() {
        super();
        if (!platformIsLittleEndian()) throw new Error(NOT_LITTLE_ENDIAN);
    }

    public get widthPx(): number {
        return this._widthPx;
    }

    public get heightPx(): number {
        return this._heightPx;
    }

    public get pixelsPerScreenUnitX(): number {
        return this._pixelsPerScreenUnitX;
    }

    public get pixelsPerScreenUnitY(): number {
        return this._pixelsPerScreenUnitY;
    }

    public get pixels(): Uint32Array {
        return this._pixels;
    }

    public get depth(): Float32Array {
        return this._depth;
    }

    public beginFrame(size: PixelPresenterSize, backgroundRgb: number, pixelsPerScreenUnitX: number): void {
        this.resize(Math.max(0, size.widthPx | 0), Math.max(0, size.heightPx | 0));
        this._pixelsPerScreenUnitX = pixelsPerScreenUnitX;
        this._pixelsPerScreenUnitY = pixelsPerScreenUnitX * SCREEN_UNIT_HEIGHT_PER_WIDTH;
        this._pixels.fill(pixelOfRgb(backgroundRgb));
        this._depth.fill(Number.POSITIVE_INFINITY);
    }

    public rgbAt(x: number, y: number): number {
        return rgbOfPixel(this._pixels[y * this._widthPx + x]);
    }

    public depthAt(x: number, y: number): number {
        return this._depth[y * this._widthPx + x];
    }

    public writeRgb(index: number, depth: number, rgb: number): void {
        if (this._depth[index] < depth) return;
        this._depth[index] = depth;
        this._pixels[index] = pixelOfRgb(rgb);
    }

    public blendRgb(index: number, depth: number, rgb: number, alpha: number): void {
        if (alpha <= 0 || this._depth[index] < depth) return;
        this._depth[index] = depth;
        this._pixels[index] = pixelOfRgb(alpha >= 1 ? rgb : mixRgb(rgbOfPixel(this._pixels[index]), rgb, alpha));
    }

    public toPixelFrame(): PixelFrame {
        return {
            widthPx: this._widthPx,
            heightPx: this._heightPx,
            rgba: this._rgba,
            pixelsPerScreenUnitX: this._pixelsPerScreenUnitX,
            pixelsPerScreenUnitY: this._pixelsPerScreenUnitY,
        };
    }

    private resize(widthPx: number, heightPx: number): void {
        if (widthPx === this._widthPx && heightPx === this._heightPx) return;
        this._widthPx = widthPx;
        this._heightPx = heightPx;
        const pixelCount = widthPx * heightPx;
        this._rgba = new Uint8ClampedArray(pixelCount * RGBA_BYTES_PER_PIXEL);
        this._pixels = new Uint32Array(this._rgba.buffer);
        this._depth = new Float32Array(pixelCount);
    }
}
