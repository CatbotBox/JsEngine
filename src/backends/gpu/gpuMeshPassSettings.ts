import {Component} from "../../engine/core";
import type {MeshRenderSettings} from "../../engine/rendering/3d/meshRenderSettings";

export type GpuSampleCount = 1 | 4;
export type GpuTextureFiltering = "nearest" | "linear";

export const SINGLE_SAMPLE_COUNT: GpuSampleCount = 1;
export const MULTISAMPLE_COUNT: GpuSampleCount = 4;
export const NEAREST_TEXTURE_FILTERING: GpuTextureFiltering = "nearest";
export const LINEAR_TEXTURE_FILTERING: GpuTextureFiltering = "linear";
const DEFAULT_SUPERSAMPLE = 2;
const SINGLE_SAMPLE_PER_PIXEL = 1;
const DEFAULT_ORTHOGRAPHIC_DEPTH_RANGE = 1000;
const DEFAULT_EVICT_UNUSED_MESH_AFTER_FRAMES = 600;
const DEFAULT_LOD_TRIANGLES_PER_PIXEL = 0.25;

export function sampleCountFor(meshes: MeshRenderSettings): GpuSampleCount {
    const samplesPerPixel = (meshes.supersampleX ?? DEFAULT_SUPERSAMPLE) * (meshes.supersampleY ?? DEFAULT_SUPERSAMPLE);
    return samplesPerPixel > SINGLE_SAMPLE_PER_PIXEL ? MULTISAMPLE_COUNT : SINGLE_SAMPLE_COUNT;
}

export class GpuMeshPassSettings extends Component {
    public textureFiltering: GpuTextureFiltering = NEAREST_TEXTURE_FILTERING;
    public orthographicDepthRange: number = DEFAULT_ORTHOGRAPHIC_DEPTH_RANGE;
    public evictUnusedMeshAfterFrames: number = DEFAULT_EVICT_UNUSED_MESH_AFTER_FRAMES;
    public lodTrianglesPerPixel: number = DEFAULT_LOD_TRIANGLES_PER_PIXEL;
}
