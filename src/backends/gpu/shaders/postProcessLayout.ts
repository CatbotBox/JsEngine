import {GPU_SHADER_STAGE} from "../gpuTypes";

export const POST_PROCESS_BIND_GROUP = 0;
export const POST_SAMPLER_BINDING = 0;
export const POST_SOURCE_BINDING = 1;
export const POST_UNIFORMS_BINDING = 2;
export const POST_BLOOM_BINDING = 3;

const SAMPLER_ENTRY: GPUBindGroupLayoutEntry = {binding: POST_SAMPLER_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, sampler: {type: "filtering"}};
const SOURCE_ENTRY: GPUBindGroupLayoutEntry = {binding: POST_SOURCE_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, texture: {sampleType: "float"}};
const UNIFORMS_ENTRY: GPUBindGroupLayoutEntry = {binding: POST_UNIFORMS_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, buffer: {type: "uniform"}};
const BLOOM_ENTRY: GPUBindGroupLayoutEntry = {binding: POST_BLOOM_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, texture: {sampleType: "float"}};

export const BLOOM_BIND_GROUP_LAYOUT: GPUBindGroupLayoutDescriptor = {
    label: "bloom",
    entries: [SAMPLER_ENTRY, SOURCE_ENTRY, UNIFORMS_ENTRY],
};

export const COMPOSITE_BIND_GROUP_LAYOUT: GPUBindGroupLayoutDescriptor = {
    label: "post composite",
    entries: [SAMPLER_ENTRY, SOURCE_ENTRY, UNIFORMS_ENTRY, BLOOM_ENTRY],
};
