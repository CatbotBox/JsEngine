import {GPU_SHADER_STAGE} from "../gpuTypes";
import type {GpuShader} from "../gpuTypes";

export const OVERLAY_BIND_GROUP = 0;
export const OVERLAY_SAMPLER_BINDING = 0;
export const OVERLAY_TEXTURE_BINDING = 1;
export const FULL_SCREEN_TRIANGLE_VERTICES = 3;

export const OVERLAY_BIND_GROUP_LAYOUT: GPUBindGroupLayoutDescriptor = {
    label: "overlay",
    entries: [
        {binding: OVERLAY_SAMPLER_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, sampler: {type: "filtering"}},
        {binding: OVERLAY_TEXTURE_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, texture: {sampleType: "float"}},
    ],
};

const OVERLAY_WGSL = `
@group(${OVERLAY_BIND_GROUP}) @binding(${OVERLAY_SAMPLER_BINDING}) var overlaySampler: sampler;
@group(${OVERLAY_BIND_GROUP}) @binding(${OVERLAY_TEXTURE_BINDING}) var overlayTexture: texture_2d<f32>;

struct OverlayVertex {
    @builtin(position) clip: vec4f,
    @location(0) uv: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> OverlayVertex {
    let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
    var output: OverlayVertex;
    output.clip = vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
    output.uv = vec2f(corner.x, 1.0 - corner.y);
    return output;
}

@fragment
fn fragmentMain(input: OverlayVertex) -> @location(0) vec4f {
    return textureSample(overlayTexture, overlaySampler, input.uv);
}
`;

export const OVERLAY: GpuShader = {
    name: "overlay",
    code: OVERLAY_WGSL,
    vertexEntryPoint: "vertexMain",
    fragmentEntryPoint: "fragmentMain",
};
