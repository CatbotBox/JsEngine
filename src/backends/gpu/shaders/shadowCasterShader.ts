import {MAT4_FLOATS} from "../../../engine/math/mat4Layout";
import {GPU_SHADER_STAGE} from "../gpuTypes";
import {FLOAT_BYTES, VEC4_FLOATS} from "../gpuLightPacking";
import {MESH_POSITION_OFFSET, MESH_VERTEX_FLOATS} from "../gpuMeshPacking";
import {INSTANCE_FLOATS, INSTANCE_MATRIX_OFFSET} from "../gpuInstanceBatcher";
import {INSTANCE_MATRIX_COLUMNS, INSTANCE_MATRIX_FIRST_LOCATION, POSITION_LOCATION} from "./basicLitShader";

const UNIFORM_BUFFER_OFFSET_ALIGNMENT_BYTES = 256;

export const SHADOW_CASTER_SHADER_NAME = "shadow caster";
export const SHADOW_CASTER_VERTEX_ENTRY_POINT = "casterVertexMain";
export const SHADOW_CASTER_BIND_GROUP = 0;
export const SHADOW_CASTER_UNIFORMS_BINDING = 0;
export const SHADOW_CASTER_UNIFORM_BYTES = MAT4_FLOATS * FLOAT_BYTES;
export const SHADOW_CASTER_UNIFORM_STRIDE_BYTES = UNIFORM_BUFFER_OFFSET_ALIGNMENT_BYTES;

export const SHADOW_CASTER_BIND_GROUP_LAYOUT: GPUBindGroupLayoutDescriptor = {
    label: SHADOW_CASTER_SHADER_NAME,
    entries: [
        {binding: SHADOW_CASTER_UNIFORMS_BINDING, visibility: GPU_SHADER_STAGE.VERTEX, buffer: {type: "uniform", hasDynamicOffset: true, minBindingSize: SHADOW_CASTER_UNIFORM_BYTES}},
    ],
};

export const SHADOW_CASTER_VERTEX_BUFFERS: readonly GPUVertexBufferLayout[] = [
    {
        arrayStride: MESH_VERTEX_FLOATS * FLOAT_BYTES,
        stepMode: "vertex",
        attributes: [
            {shaderLocation: POSITION_LOCATION, offset: MESH_POSITION_OFFSET * FLOAT_BYTES, format: "float32x3"},
        ],
    },
    {
        arrayStride: INSTANCE_FLOATS * FLOAT_BYTES,
        stepMode: "instance",
        attributes: Array.from({length: INSTANCE_MATRIX_COLUMNS}, (_, column): GPUVertexAttribute => ({
            shaderLocation: INSTANCE_MATRIX_FIRST_LOCATION + column,
            offset: (INSTANCE_MATRIX_OFFSET + column * VEC4_FLOATS) * FLOAT_BYTES,
            format: "float32x4",
        })),
    },
];

export const SHADOW_CASTER_WGSL = `
struct ShadowCaster {
    worldToLightClip: mat4x4f,
}

@group(${SHADOW_CASTER_BIND_GROUP}) @binding(${SHADOW_CASTER_UNIFORMS_BINDING}) var<uniform> shadowCaster: ShadowCaster;

struct CasterVertex {
    @location(${POSITION_LOCATION}) position: vec3f,
    @location(${INSTANCE_MATRIX_FIRST_LOCATION}) model0: vec4f,
    @location(${INSTANCE_MATRIX_FIRST_LOCATION + 1}) model1: vec4f,
    @location(${INSTANCE_MATRIX_FIRST_LOCATION + 2}) model2: vec4f,
    @location(${INSTANCE_MATRIX_FIRST_LOCATION + 3}) model3: vec4f,
}

@vertex
fn ${SHADOW_CASTER_VERTEX_ENTRY_POINT}(input: CasterVertex) -> @builtin(position) vec4f {
    let model = mat4x4f(input.model0, input.model1, input.model2, input.model3);
    return shadowCaster.worldToLightClip * (model * vec4f(input.position, 1.0));
}
`;
