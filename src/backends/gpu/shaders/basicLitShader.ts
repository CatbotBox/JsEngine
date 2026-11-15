import {LIGHT_KIND_DIRECTIONAL} from "../../../engine/rendering/3d/lighting/sceneLights";
import {CHANNEL_MAX} from "../../../engine/rendering/packedRgb";
import {GPU_SHADER_STAGE} from "../gpuTypes";
import type {GpuShader} from "../gpuTypes";
import {FLOAT_BYTES, LIGHTS_UNLIT, VEC4_FLOATS} from "../gpuLightPacking";
import {MESH_NORMAL_OFFSET, MESH_POSITION_OFFSET, MESH_UV_OFFSET, MESH_VERTEX_FLOATS} from "../gpuMeshPacking";
import {INSTANCE_FLOATS, INSTANCE_MATRIX_OFFSET, INSTANCE_TINT_OFFSET} from "../gpuInstanceBatcher";
import {wgslFloat} from "./wgsl";

export const FRAME_BIND_GROUP = 0;
export const MATERIAL_BIND_GROUP = 1;
export const FRAME_UNIFORMS_BINDING = 0;
export const LIGHTS_BINDING = 1;
export const MATERIAL_UNIFORMS_BINDING = 0;
export const MATERIAL_SAMPLER_BINDING = 1;
export const MATERIAL_TEXTURE_BINDING = 2;
export const MATERIAL_SPECULAR_TEXTURE_BINDING = 3;

export const MESH_VERTEX_BUFFER_SLOT = 0;
export const INSTANCE_VERTEX_BUFFER_SLOT = 1;
export const POSITION_LOCATION = 0;
export const NORMAL_LOCATION = 1;
export const UV_LOCATION = 2;
export const INSTANCE_MATRIX_FIRST_LOCATION = 3;
export const INSTANCE_MATRIX_COLUMNS = 4;
export const INSTANCE_TINT_LOCATION = INSTANCE_MATRIX_FIRST_LOCATION + INSTANCE_MATRIX_COLUMNS;

export const MATERIAL_DIFFUSE_OFFSET = 0;
export const MATERIAL_EMISSIVE_OFFSET = MATERIAL_DIFFUSE_OFFSET + VEC4_FLOATS;
export const MATERIAL_SPECULAR_OFFSET = MATERIAL_EMISSIVE_OFFSET + VEC4_FLOATS;
export const MATERIAL_SHININESS_OFFSET = MATERIAL_SPECULAR_OFFSET + 3;
export const MATERIAL_TEXTURED_OFFSET = MATERIAL_SPECULAR_OFFSET + VEC4_FLOATS;
export const MATERIAL_SPECULAR_CUTOFF_OFFSET = MATERIAL_TEXTURED_OFFSET + 1;
export const MATERIAL_UNIFORM_FLOATS = MATERIAL_TEXTURED_OFFSET + VEC4_FLOATS;
export const MATERIAL_TEXTURED = 1;
export const MATERIAL_UNTEXTURED = 0;

export const ALPHA_TEST_THRESHOLD = 128 / CHANNEL_MAX;
export const HIGHEST_NORMAL_DOT_HALF = 1;
export const SMALLEST_HIGHLIGHT_BASE = 1e-30;
export const SPECULAR_TEXTURE_MIP_LEVEL = 0;
const SINGULAR_NORMAL_MATRIX_EPSILON = 1e-12;

export const FRAME_BIND_GROUP_LAYOUT: GPUBindGroupLayoutDescriptor = {
    label: "frame",
    entries: [
        {binding: FRAME_UNIFORMS_BINDING, visibility: GPU_SHADER_STAGE.VERTEX, buffer: {type: "uniform"}},
        {binding: LIGHTS_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, buffer: {type: "read-only-storage"}},
    ],
};

export const MATERIAL_BIND_GROUP_LAYOUT: GPUBindGroupLayoutDescriptor = {
    label: "material",
    entries: [
        {binding: MATERIAL_UNIFORMS_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, buffer: {type: "uniform"}},
        {binding: MATERIAL_SAMPLER_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, sampler: {type: "filtering"}},
        {binding: MATERIAL_TEXTURE_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, texture: {sampleType: "float"}},
        {binding: MATERIAL_SPECULAR_TEXTURE_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, texture: {sampleType: "float"}},
    ],
};

function instanceMatrixColumn(column: number): GPUVertexAttribute {
    return {
        shaderLocation: INSTANCE_MATRIX_FIRST_LOCATION + column,
        offset: (INSTANCE_MATRIX_OFFSET + column * VEC4_FLOATS) * FLOAT_BYTES,
        format: "float32x4",
    };
}

export const BASIC_LIT_VERTEX_BUFFERS: readonly GPUVertexBufferLayout[] = [
    {
        arrayStride: MESH_VERTEX_FLOATS * FLOAT_BYTES,
        stepMode: "vertex",
        attributes: [
            {shaderLocation: POSITION_LOCATION, offset: MESH_POSITION_OFFSET * FLOAT_BYTES, format: "float32x3"},
            {shaderLocation: NORMAL_LOCATION, offset: MESH_NORMAL_OFFSET * FLOAT_BYTES, format: "float32x3"},
            {shaderLocation: UV_LOCATION, offset: MESH_UV_OFFSET * FLOAT_BYTES, format: "float32x2"},
        ],
    },
    {
        arrayStride: INSTANCE_FLOATS * FLOAT_BYTES,
        stepMode: "instance",
        attributes: [
            ...Array.from({length: INSTANCE_MATRIX_COLUMNS}, (_, column) => instanceMatrixColumn(column)),
            {shaderLocation: INSTANCE_TINT_LOCATION, offset: INSTANCE_TINT_OFFSET * FLOAT_BYTES, format: "float32x4"},
        ],
    },
];

const BASIC_LIT_WGSL = `
const LIGHT_KIND_DIRECTIONAL: f32 = ${wgslFloat(LIGHT_KIND_DIRECTIONAL)};
const ALPHA_TEST_THRESHOLD: f32 = ${wgslFloat(ALPHA_TEST_THRESHOLD)};
const SINGULAR_NORMAL_MATRIX_EPSILON: f32 = ${wgslFloat(SINGULAR_NORMAL_MATRIX_EPSILON)};
const MATERIAL_UNTEXTURED: f32 = ${wgslFloat(MATERIAL_UNTEXTURED)};
const HIGHEST_NORMAL_DOT_HALF: f32 = ${wgslFloat(HIGHEST_NORMAL_DOT_HALF)};
const SMALLEST_HIGHLIGHT_BASE: f32 = ${wgslFloat(SMALLEST_HIGHLIGHT_BASE)};
const SPECULAR_TEXTURE_MIP_LEVEL: f32 = ${wgslFloat(SPECULAR_TEXTURE_MIP_LEVEL)};
const LIGHTS_UNLIT: u32 = ${LIGHTS_UNLIT}u;

struct Frame {
    view: mat4x4f,
    projection: mat4x4f,
}

struct Light {
    vector: vec4f,
    color: vec4f,
    kindRangeSquared: vec4f,
}

struct Lights {
    ambient: vec4f,
    count: u32,
    lit: u32,
    reserved0: u32,
    reserved1: u32,
    lights: array<Light>,
}

struct Material {
    diffuse: vec4f,
    emissive: vec4f,
    specularShininess: vec4f,
    textured: f32,
    specularCutoff: f32,
    reserved0: f32,
    reserved1: f32,
}

@group(${FRAME_BIND_GROUP}) @binding(${FRAME_UNIFORMS_BINDING}) var<uniform> frame: Frame;
@group(${FRAME_BIND_GROUP}) @binding(${LIGHTS_BINDING}) var<storage, read> sceneLights: Lights;
@group(${MATERIAL_BIND_GROUP}) @binding(${MATERIAL_UNIFORMS_BINDING}) var<uniform> material: Material;
@group(${MATERIAL_BIND_GROUP}) @binding(${MATERIAL_SAMPLER_BINDING}) var materialSampler: sampler;
@group(${MATERIAL_BIND_GROUP}) @binding(${MATERIAL_TEXTURE_BINDING}) var materialTexture: texture_2d<f32>;
@group(${MATERIAL_BIND_GROUP}) @binding(${MATERIAL_SPECULAR_TEXTURE_BINDING}) var specularTexture: texture_2d<f32>;

struct VertexInput {
    @location(${POSITION_LOCATION}) position: vec3f,
    @location(${NORMAL_LOCATION}) normal: vec3f,
    @location(${UV_LOCATION}) uv: vec2f,
    @location(${INSTANCE_MATRIX_FIRST_LOCATION}) model0: vec4f,
    @location(${INSTANCE_MATRIX_FIRST_LOCATION + 1}) model1: vec4f,
    @location(${INSTANCE_MATRIX_FIRST_LOCATION + 2}) model2: vec4f,
    @location(${INSTANCE_MATRIX_FIRST_LOCATION + 3}) model3: vec4f,
    @location(${INSTANCE_TINT_LOCATION}) tint: vec4f,
}

struct VertexOutput {
    @builtin(position) clip: vec4f,
    @location(0) viewPosition: vec3f,
    @location(1) viewNormal: vec3f,
    @location(2) uv: vec2f,
    @location(3) tint: vec4f,
}

fn inverseTranspose(m: mat3x3f) -> mat3x3f {
    let bc = cross(m[1], m[2]);
    let ca = cross(m[2], m[0]);
    let ab = cross(m[0], m[1]);
    let determinant = dot(m[0], bc);
    if (abs(determinant) < SINGULAR_NORMAL_MATRIX_EPSILON) {
        return mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0));
    }
    return mat3x3f(bc, ca, ab) * (1.0 / determinant);
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    let model = mat4x4f(input.model0, input.model1, input.model2, input.model3);
    let modelView = frame.view * model;
    let viewPosition = modelView * vec4f(input.position, 1.0);
    let normalMatrix = inverseTranspose(mat3x3f(modelView[0].xyz, modelView[1].xyz, modelView[2].xyz));
    var output: VertexOutput;
    output.clip = frame.projection * viewPosition;
    output.viewPosition = viewPosition.xyz;
    output.viewNormal = normalMatrix * input.normal;
    output.uv = input.uv;
    output.tint = input.tint;
    return output;
}

fn unitOrZero(v: vec3f) -> vec3f {
    let lengthSquared = dot(v, v);
    if (lengthSquared > 0.0) {
        return v * inverseSqrt(lengthSquared);
    }
    return vec3f(0.0);
}

struct LightSums {
    diffuse: vec3f,
    specular: vec3f,
}

fn highlight(normal: vec3f, toLight: vec3f, toCamera: vec3f) -> f32 {
    let halfway = toLight + toCamera;
    let halfwayLengthSquared = dot(halfway, halfway);
    if (halfwayLengthSquared == 0.0) {
        return 0.0;
    }
    let normalDotHalf = dot(normal, halfway) * inverseSqrt(halfwayLengthSquared);
    if (normalDotHalf < material.specularCutoff) {
        return 0.0;
    }
    return pow(max(normalDotHalf, SMALLEST_HIGHLIGHT_BASE), material.specularShininess.w);
}

fn lightSums(normal: vec3f, viewPosition: vec3f, specular: bool) -> LightSums {
    var sums = LightSums(sceneLights.ambient.rgb, vec3f(0.0));
    var toCamera = vec3f(0.0);
    if (specular) {
        toCamera = unitOrZero(-viewPosition);
    }
    for (var i = 0u; i < sceneLights.count; i++) {
        let entry = sceneLights.lights[i];
        var toLight: vec3f;
        var attenuation = 1.0;
        if (entry.kindRangeSquared.x == LIGHT_KIND_DIRECTIONAL) {
            toLight = entry.vector.xyz;
        } else {
            let offset = entry.vector.xyz - viewPosition;
            let distanceSquared = dot(offset, offset);
            let rangeSquared = entry.kindRangeSquared.y;
            if (distanceSquared >= rangeSquared || distanceSquared == 0.0) {
                continue;
            }
            let falloff = 1.0 - distanceSquared / rangeSquared;
            toLight = offset * inverseSqrt(distanceSquared);
            attenuation = falloff * falloff;
        }
        let diffuse = dot(normal, toLight) * attenuation;
        if (diffuse > 0.0) {
            sums.diffuse += entry.color.rgb * diffuse;
            if (specular) {
                sums.specular += entry.color.rgb * highlight(normal, toLight, toCamera) * attenuation;
            }
        }
    }
    return sums;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    let texel = textureSample(materialTexture, materialSampler, input.uv);
    let textured = material.textured != MATERIAL_UNTEXTURED;
    if (textured && texel.a < ALPHA_TEST_THRESHOLD) {
        discard;
    }
    let albedo = material.diffuse.rgb * input.tint.rgb;
    var rgb = albedo;
    var highlightRgb = vec3f(0.0);
    if (sceneLights.lit != LIGHTS_UNLIT) {
        let specular = material.specularCutoff <= HIGHEST_NORMAL_DOT_HALF;
        let sums = lightSums(unitOrZero(input.viewNormal), input.viewPosition, specular);
        rgb = saturate(sums.diffuse * albedo + material.emissive.rgb * input.tint.rgb);
        if (specular) {
            let gloss = textureSampleLevel(specularTexture, materialSampler, input.uv, SPECULAR_TEXTURE_MIP_LEVEL).rgb;
            highlightRgb = sums.specular * gloss * material.specularShininess.rgb * input.tint.rgb;
        }
    }
    if (textured) {
        rgb *= texel.rgb;
    }
    return vec4f(rgb + highlightRgb, 1.0);
}
`;

export const BASIC_LIT: GpuShader = {
    name: "basicLit",
    code: BASIC_LIT_WGSL,
    vertexEntryPoint: "vertexMain",
    fragmentEntryPoint: "fragmentMain",
};
