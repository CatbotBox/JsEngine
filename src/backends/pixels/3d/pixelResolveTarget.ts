import type {RasterTarget, SubsampleLayers} from "../../../engine/rendering/3d/software";
import {RED_SHIFT, GREEN_SHIFT, CHANNEL_MASK} from "../../../engine/rendering/packedRgb";
import {pixelOfRgb, rgbOfPixel} from "../pixelFramebuffer";
import type {PixelFramebuffer} from "../pixelFramebuffer";

const MIN_FRAMEBUFFER_PIXELS_PER_RASTER_PIXEL = 1;

export class PixelResolveTarget implements RasterTarget {
    private framebuffer!: PixelFramebuffer;
    private framebufferPixelsPerRasterPixel = MIN_FRAMEBUFFER_PIXELS_PER_RASTER_PIXEL;

    public begin(framebuffer: PixelFramebuffer, framebufferPixelsPerRasterPixel: number): void {
        this.framebuffer = framebuffer;
        this.framebufferPixelsPerRasterPixel = Math.max(MIN_FRAMEBUFFER_PIXELS_PER_RASTER_PIXEL, Math.floor(framebufferPixelsPerRasterPixel));
    }

    public composite(layers: SubsampleLayers): void {
        const {width, height, supersampleX: sx, supersampleY: sy, rowsPerCell, rasterWidth} = layers;
        const subsampleCount = sx * sy;
        const srcDepth = layers.depth;
        const srcColor = layers.color;
        const framebuffer = this.framebuffer;
        const framebufferWidthPx = framebuffer.widthPx, framebufferHeightPx = framebuffer.heightPx;
        const pixels = framebuffer.pixels, depths = framebuffer.depth;
        const blockPx = this.framebufferPixelsPerRasterPixel;

        for (let rasterY = 0; rasterY < height; rasterY++) {
            const top = rasterY * blockPx;
            if (top >= framebufferHeightPx) break;
            const bottom = Math.min(framebufferHeightPx, top + blockPx);
            const rowBase = rasterY * rowsPerCell * rasterWidth;
            for (let rasterX = 0; rasterX < width; rasterX++) {
                const left = rasterX * blockPx;
                if (left >= framebufferWidthPx) break;

                let minDepth = Number.POSITIVE_INFINITY;
                let r = 0, g = 0, b = 0, covered = 0;
                const pixelBase = rowBase + rasterX * sx;
                for (let row = 0; row < sy; row++) {
                    let si = pixelBase + row * rasterWidth;
                    for (let column = 0; column < sx; column++, si++) {
                        const d = srcDepth[si];
                        if (d < Number.POSITIVE_INFINITY) {
                            covered++;
                            if (d < minDepth) minDepth = d;
                            const c = srcColor[si];
                            r += (c >> RED_SHIFT) & CHANNEL_MASK;
                            g += (c >> GREEN_SHIFT) & CHANNEL_MASK;
                            b += c & CHANNEL_MASK;
                        }
                    }
                }
                if (covered === 0) continue;

                const uncovered = subsampleCount - covered;
                const right = Math.min(framebufferWidthPx, left + blockPx);
                for (let y = top; y < bottom; y++) {
                    for (let i = y * framebufferWidthPx + left, end = y * framebufferWidthPx + right; i < end; i++) {
                        if (depths[i] < minDepth) continue;
                        let blendedR = r, blendedG = g, blendedB = b;
                        if (uncovered > 0) {
                            const behind = rgbOfPixel(pixels[i]);
                            blendedR += ((behind >> RED_SHIFT) & CHANNEL_MASK) * uncovered;
                            blendedG += ((behind >> GREEN_SHIFT) & CHANNEL_MASK) * uncovered;
                            blendedB += (behind & CHANNEL_MASK) * uncovered;
                        }
                        depths[i] = minDepth;
                        pixels[i] = pixelOfRgb(
                            (Math.round(blendedR / subsampleCount) << RED_SHIFT)
                            | (Math.round(blendedG / subsampleCount) << GREEN_SHIFT)
                            | Math.round(blendedB / subsampleCount),
                        );
                    }
                }
            }
        }
    }
}
