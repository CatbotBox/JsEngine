import {Component} from "../../engine/core";

export type GpuSampleCount = 1 | 4;
export type GpuTextureFiltering = "nearest" | "linear";

export const SINGLE_SAMPLE_COUNT: GpuSampleCount = 1;
export const MULTISAMPLE_COUNT: GpuSampleCount = 4;
export const NEAREST_TEXTURE_FILTERING: GpuTextureFiltering = "nearest";
export const LINEAR_TEXTURE_FILTERING: GpuTextureFiltering = "linear";
export const MIN_RENDER_SCALE = 1;
export const MAX_RENDER_TARGET_PX = 8192;
const DEFAULT_ORTHOGRAPHIC_DEPTH_RANGE = 1000;
const DEFAULT_EVICT_UNUSED_AFTER_FRAMES = 600;
const DEFAULT_LOD_TRIANGLES_PER_PIXEL = 0.25;
const DEFAULT_RENDER_SCALE = MIN_RENDER_SCALE;

export class GpuMeshPassSettings extends Component {
    public textureFiltering: GpuTextureFiltering = NEAREST_TEXTURE_FILTERING;
    public sampleCount: GpuSampleCount = MULTISAMPLE_COUNT;
    public orthographicDepthRange: number = DEFAULT_ORTHOGRAPHIC_DEPTH_RANGE;
    public evictUnusedAfterFrames: number = DEFAULT_EVICT_UNUSED_AFTER_FRAMES;
    public lodTrianglesPerPixel: number = DEFAULT_LOD_TRIANGLES_PER_PIXEL;
    public renderScale: number = DEFAULT_RENDER_SCALE;
}

export function effectiveRenderScale(renderScale: number, framebufferWidthPx: number, framebufferHeightPx: number): number {
    if (!Number.isFinite(renderScale) || renderScale <= MIN_RENDER_SCALE) return MIN_RENDER_SCALE;
    const largestScaleThatFits = MAX_RENDER_TARGET_PX / Math.max(framebufferWidthPx, framebufferHeightPx);
    return Math.max(MIN_RENDER_SCALE, Math.min(renderScale, largestScaleThatFits));
}

export function renderTargetPx(framebufferPx: number, renderScale: number): number {
    return Math.round(framebufferPx * renderScale);
}
