import {Component} from "../../../engine/core";
import {clampSupersample, RasterWorkerPool} from "../../../engine/rendering/3d/software";
import type {MeshRasterizerConfig} from "../../../engine/rendering/3d/software";
import {resolveRasterWorkerCount} from "../../../engine/rendering/3d/software/rasterWorkerCount";
import type {RasterWorkerCount, RasterWorkerHost} from "../../../engine/rendering/3d/software/rasterWorkerCount";
import {PACKED_RGB_MASK} from "../../../engine/rendering/packedRgb";

export type FramebufferPixelsPerRasterPixel = number | "fitWorkerPool";

const DEFAULT_SUPERSAMPLE = 2;
const DEFAULT_THREAD_TRIANGLE_THRESHOLD = 2048;
const DEFAULT_THREAD_AREA_THRESHOLD_RASTER_PIXELS = 50_000;
const DEFAULT_LOD_TRIANGLES_PER_PIXEL = 0.25;
const MIN_FRAMEBUFFER_PIXELS_PER_RASTER_PIXEL = 1;
const NO_HALF_BLOCK = false;

function wholeFramebufferPixelsPerRasterPixel(requested: number): number {
    return Number.isFinite(requested) && requested >= MIN_FRAMEBUFFER_PIXELS_PER_RASTER_PIXEL
        ? Math.floor(requested)
        : MIN_FRAMEBUFFER_PIXELS_PER_RASTER_PIXEL;
}

export class MeshPixelPassSettings extends Component {
    public maxDepthFade: number = Number.POSITIVE_INFINITY;
    public supersampleX: number = DEFAULT_SUPERSAMPLE;
    public supersampleY: number = DEFAULT_SUPERSAMPLE;
    public workerCount: RasterWorkerCount = "auto";
    public threadTriangleThreshold: number = DEFAULT_THREAD_TRIANGLE_THRESHOLD;
    public threadAreaThreshold: number = DEFAULT_THREAD_AREA_THRESHOLD_RASTER_PIXELS;
    public textures: boolean = true;
    public lod: boolean = true;
    public lodBias: number = 0;
    public lodTrianglesPerPixel: number = DEFAULT_LOD_TRIANGLES_PER_PIXEL;
    public framebufferPixelsPerRasterPixel: FramebufferPixelsPerRasterPixel = "fitWorkerPool";

    public resolvedWorkerCount(host: RasterWorkerHost): number {
        return resolveRasterWorkerCount(this.workerCount, host);
    }

    public resolvedFramebufferPixelsPerRasterPixel(framebufferWidthPx: number, framebufferHeightPx: number): number {
        if (this.framebufferPixelsPerRasterPixel !== "fitWorkerPool") return wholeFramebufferPixelsPerRasterPixel(this.framebufferPixelsPerRasterPixel);
        const subsamplesPerRasterPixel = clampSupersample(this.supersampleX) * clampSupersample(this.supersampleY);
        let framebufferPixelsPerRasterPixel = MIN_FRAMEBUFFER_PIXELS_PER_RASTER_PIXEL;
        while (Math.ceil(framebufferWidthPx / framebufferPixelsPerRasterPixel) * Math.ceil(framebufferHeightPx / framebufferPixelsPerRasterPixel)
            * subsamplesPerRasterPixel > RasterWorkerPool.MAX_CELLS) {
            framebufferPixelsPerRasterPixel++;
        }
        return framebufferPixelsPerRasterPixel;
    }

    public toRasterizerConfig(host: RasterWorkerHost): MeshRasterizerConfig {
        return {
            maxDepthFade: this.maxDepthFade,
            colorQuantMask: PACKED_RGB_MASK,
            supersample: this.supersampleX,
            supersampleX: this.supersampleX,
            supersampleY: this.supersampleY,
            workerCount: this.resolvedWorkerCount(host),
            threadTriangleThreshold: this.threadTriangleThreshold,
            threadAreaThreshold: this.threadAreaThreshold,
            textures: this.textures,
            halfBlock: NO_HALF_BLOCK,
        };
    }
}
