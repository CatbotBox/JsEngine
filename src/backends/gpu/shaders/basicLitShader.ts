import {LIGHT_KIND_DIRECTIONAL} from "../../../engine/rendering/3d/lighting/sceneLights";
import {CHANNEL_MAX} from "../../../engine/rendering/packedRgb";
import {GPU_SHADER_STAGE} from "../gpuTypes";
import type {GpuShader} from "../gpuTypes";
import {FLOAT_BYTES, LIGHTS_UNLIT, VEC4_FLOATS} from "../gpuLightPacking";
import {MESH_NORMAL_OFFSET, MESH_POSITION_OFFSET, MESH_UV_OFFSET, MESH_VERTEX_FLOATS} from "../gpuMeshPacking";
import {INSTANCE_FLOATS, INSTANCE_MATRIX_OFFSET, INSTANCE_PARAMS_OFFSET, INSTANCE_TINT_OFFSET} from "../gpuInstanceBatcher";
import {LIT_SURFACE_SHADER, SURFACE_SHADER_PARAMS} from "../gpuSurfaceShader";
import {FULLY_LIT, SHADOW_MAP_FARTHEST_DEPTH, SHADOWS_OFF} from "../gpuShadowPacking";
import {wgslFloat} from "./wgsl";

export const FRAME_BIND_GROUP = 0;
export const MATERIAL_BIND_GROUP = 1;
export const FRAME_UNIFORMS_BINDING = 0;
export const LIGHTS_BINDING = 1;
export const SHADOW_UNIFORMS_BINDING = 2;
export const SHADOW_MAP_BINDING = 3;
export const SHADOW_SAMPLER_BINDING = 4;
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
export const INSTANCE_PARAMS_FIRST_LOCATION = INSTANCE_TINT_LOCATION + 1;
export const INSTANCE_PARAMS_VECTORS = SURFACE_SHADER_PARAMS / VEC4_FLOATS;

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

export const SHADOW_PCF_REACH_TAPS = 1;
const SIDES_PER_AXIS = 2;
const CENTRE_TAP = 1;
const AXES_PER_MAP = 2;
export const SHADOW_PCF_TAPS = (SHADOW_PCF_REACH_TAPS * SIDES_PER_AXIS + CENTRE_TAP) ** AXES_PER_MAP;
export const NDC_TO_UV_SCALE = 0.5;

export const SURFACE_VERTEX_ENTRY_POINT = "vertexMain";
export const SURFACE_FRAGMENT_ENTRY_POINT = "fragmentMain";
export const SURFACE_FUNCTION_SIGNATURE = "fn surface(input: SurfaceInput) -> vec4f";

export const FRAME_BIND_GROUP_LAYOUT: GPUBindGroupLayoutDescriptor = {
    label: "frame",
    entries: [
        {binding: FRAME_UNIFORMS_BINDING, visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT, buffer: {type: "uniform"}},
        {binding: LIGHTS_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, buffer: {type: "read-only-storage"}},
        {binding: SHADOW_UNIFORMS_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, buffer: {type: "uniform"}},
        {binding: SHADOW_MAP_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, texture: {sampleType: "depth"}},
        {binding: SHADOW_SAMPLER_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, sampler: {type: "comparison"}},
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

function instanceVector(shaderLocation: number, floatOffset: number): GPUVertexAttribute {
    return {shaderLocation, offset: floatOffset * FLOAT_BYTES, format: "float32x4"};
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
            ...Array.from({length: INSTANCE_MATRIX_COLUMNS}, (_, column) =>
                instanceVector(INSTANCE_MATRIX_FIRST_LOCATION + column, INSTANCE_MATRIX_OFFSET + column * VEC4_FLOATS)),
            instanceVector(INSTANCE_TINT_LOCATION, INSTANCE_TINT_OFFSET),
            ...Array.from({length: INSTANCE_PARAMS_VECTORS}, (_, vector) =>
                instanceVector(INSTANCE_PARAMS_FIRST_LOCATION + vector, INSTANCE_PARAMS_OFFSET + vector * VEC4_FLOATS)),
        ],
    },
];

const SURFACE_PRELUDE_WGSL = `
const LIGHT_KIND_DIRECTIONAL: f32 = ${wgslFloat(LIGHT_KIND_DIRECTIONAL)};
const ALPHA_TEST_THRESHOLD: f32 = ${wgslFloat(ALPHA_TEST_THRESHOLD)};
const SINGULAR_NORMAL_MATRIX_EPSILON: f32 = ${wgslFloat(SINGULAR_NORMAL_MATRIX_EPSILON)};
const MATERIAL_UNTEXTURED: f32 = ${wgslFloat(MATERIAL_UNTEXTURED)};
const HIGHEST_NORMAL_DOT_HALF: f32 = ${wgslFloat(HIGHEST_NORMAL_DOT_HALF)};
const SMALLEST_HIGHLIGHT_BASE: f32 = ${wgslFloat(SMALLEST_HIGHLIGHT_BASE)};
const SPECULAR_TEXTURE_MIP_LEVEL: f32 = ${wgslFloat(SPECULAR_TEXTURE_MIP_LEVEL)};
const LIGHTS_UNLIT: u32 = ${LIGHTS_UNLIT}u;
const SURFACE_SHADER_PARAMS: u32 = ${SURFACE_SHADER_PARAMS}u;
const UNTEXTURED_TEXEL: vec4f = vec4f(1.0);
const SHADOWS_OFF: u32 = ${SHADOWS_OFF}u;
const FULLY_LIT: f32 = ${wgslFloat(FULLY_LIT)};
const SHADOW_MAP_FARTHEST_DEPTH: f32 = ${wgslFloat(SHADOW_MAP_FARTHEST_DEPTH)};
const SHADOW_PCF_REACH_TAPS: i32 = ${SHADOW_PCF_REACH_TAPS};
const SHADOW_PCF_TAPS: f32 = ${wgslFloat(SHADOW_PCF_TAPS)};
const SHADOW_NDC_TO_UV_SCALE: vec2f = vec2f(${wgslFloat(NDC_TO_UV_SCALE)}, ${wgslFloat(-NDC_TO_UV_SCALE)});
const SHADOW_NDC_TO_UV_OFFSET: vec2f = vec2f(${wgslFloat(NDC_TO_UV_SCALE)});

struct Frame {
    view: mat4x4f,
    projection: mat4x4f,
    time: f32,
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

struct Shadow {
    viewToLightClip: mat4x4f,
    lightIndex: u32,
    enabled: u32,
    depthBias: f32,
    normalOffset: f32,
    filterStep: f32,
    strength: f32,
    fadeStart: f32,
    fadeInverseLength: f32,
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
@group(${FRAME_BIND_GROUP}) @binding(${SHADOW_UNIFORMS_BINDING}) var<uniform> sceneShadow: Shadow;
@group(${FRAME_BIND_GROUP}) @binding(${SHADOW_MAP_BINDING}) var sceneShadowMap: texture_depth_2d;
@group(${FRAME_BIND_GROUP}) @binding(${SHADOW_SAMPLER_BINDING}) var sceneShadowSampler: sampler_comparison;
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
    @location(${INSTANCE_PARAMS_FIRST_LOCATION}) params0: vec4f,
    @location(${INSTANCE_PARAMS_FIRST_LOCATION + 1}) params1: vec4f,
}

struct VertexOutput {
    @builtin(position) clip: vec4f,
    @location(0) viewPosition: vec3f,
    @location(1) viewNormal: vec3f,
    @location(2) uv: vec2f,
    @location(3) tint: vec4f,
    @location(4) @interpolate(flat) params0: vec4f,
    @location(5) @interpolate(flat) params1: vec4f,
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
fn ${SURFACE_VERTEX_ENTRY_POINT}(input: VertexInput) -> VertexOutput {
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
    output.params0 = input.params0;
    output.params1 = input.params1;
    return output;
}

fn unitOrZero(v: vec3f) -> vec3f {
    let lengthSquared = dot(v, v);
    if (lengthSquared > 0.0) {
        return v * inverseSqrt(lengthSquared);
    }
    return vec3f(0.0);
}

struct SurfaceInput {
    pixelPosition: vec2f,
    viewPosition: vec3f,
    viewNormal: vec3f,
    toCamera: vec3f,
    uv: vec2f,
    texel: vec4f,
    gloss: vec3f,
    tint: vec4f,
    diffuseColor: vec3f,
    emissiveColor: vec3f,
    specularColor: vec3f,
    shininess: f32,
    lit: vec4f,
    params: array<f32, SURFACE_SHADER_PARAMS>,
    time: f32,
    shadow: f32,
}

struct SurfaceLight {
    toLight: vec3f,
    color: vec3f,
    attenuation: f32,
}

fn sceneIsLit() -> bool {
    return sceneLights.lit != LIGHTS_UNLIT;
}

fn ambientLight() -> vec3f {
    return sceneLights.ambient.rgb;
}

fn sceneLightCount() -> u32 {
    return sceneLights.count;
}

fn sceneLight(index: u32, viewPosition: vec3f) -> SurfaceLight {
    let entry = sceneLights.lights[index];
    if (entry.kindRangeSquared.x == LIGHT_KIND_DIRECTIONAL) {
        return SurfaceLight(entry.vector.xyz, entry.color.rgb, 1.0);
    }
    let offset = entry.vector.xyz - viewPosition;
    let distanceSquared = dot(offset, offset);
    let rangeSquared = entry.kindRangeSquared.y;
    if (distanceSquared >= rangeSquared || distanceSquared == 0.0) {
        return SurfaceLight(vec3f(0.0), entry.color.rgb, 0.0);
    }
    let falloff = 1.0 - distanceSquared / rangeSquared;
    return SurfaceLight(offset * inverseSqrt(distanceSquared), entry.color.rgb, falloff * falloff);
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

fn shadowVisibility(normal: vec3f, viewPosition: vec3f) -> f32 {
    if (sceneShadow.enabled == SHADOWS_OFF) {
        return FULLY_LIT;
    }
    let fade = saturate((viewPosition.z - sceneShadow.fadeStart) * sceneShadow.fadeInverseLength);
    if (fade >= FULLY_LIT) {
        return FULLY_LIT;
    }
    let lightClip = sceneShadow.viewToLightClip * vec4f(viewPosition + normal * sceneShadow.normalOffset, 1.0);
    let uv = lightClip.xy * SHADOW_NDC_TO_UV_SCALE + SHADOW_NDC_TO_UV_OFFSET;
    let depth = lightClip.z - sceneShadow.depthBias;
    if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || depth > SHADOW_MAP_FARTHEST_DEPTH) {
        return FULLY_LIT;
    }
    var lit = 0.0;
    for (var y = -SHADOW_PCF_REACH_TAPS; y <= SHADOW_PCF_REACH_TAPS; y++) {
        for (var x = -SHADOW_PCF_REACH_TAPS; x <= SHADOW_PCF_REACH_TAPS; x++) {
            let tap = uv + vec2f(f32(x), f32(y)) * sceneShadow.filterStep;
            lit += textureSampleCompareLevel(sceneShadowMap, sceneShadowSampler, tap, depth);
        }
    }
    let shadowed = FULLY_LIT - sceneShadow.strength * (FULLY_LIT - lit / SHADOW_PCF_TAPS);
    return mix(shadowed, FULLY_LIT, fade);
}

fn shadowedLightIndex() -> u32 {
    return sceneShadow.lightIndex;
}

fn lightShadow(index: u32, input: SurfaceInput) -> f32 {
    if (index == shadowedLightIndex()) {
        return input.shadow;
    }
    return FULLY_LIT;
}

fn shadowedLightSums(normal: vec3f, viewPosition: vec3f, specular: bool, shadow: f32) -> LightSums {
    var sums = LightSums(ambientLight(), vec3f(0.0));
    var toCamera = vec3f(0.0);
    if (specular) {
        toCamera = unitOrZero(-viewPosition);
    }
    for (var i = 0u; i < sceneLightCount(); i++) {
        let light = sceneLight(i, viewPosition);
        let diffuse = dot(normal, light.toLight) * light.attenuation;
        if (diffuse > 0.0) {
            var color = light.color;
            if (i == shadowedLightIndex()) {
                color *= shadow;
            }
            sums.diffuse += color * diffuse;
            if (specular) {
                sums.specular += color * highlight(normal, light.toLight, toCamera) * light.attenuation;
            }
        }
    }
    return sums;
}

fn lightSums(normal: vec3f, viewPosition: vec3f, specular: bool) -> LightSums {
    return shadowedLightSums(normal, viewPosition, specular, shadowVisibility(normal, viewPosition));
}

fn materialHasSpecular() -> bool {
    return material.specularCutoff <= HIGHEST_NORMAL_DOT_HALF;
}

fn lightDiffuse(input: SurfaceInput) -> vec3f {
    if (!sceneIsLit()) {
        return vec3f(1.0);
    }
    return shadowedLightSums(input.viewNormal, input.viewPosition, false, input.shadow).diffuse;
}

fn lightSpecular(input: SurfaceInput) -> vec3f {
    if (!sceneIsLit() || !materialHasSpecular()) {
        return vec3f(0.0);
    }
    return shadowedLightSums(input.viewNormal, input.viewPosition, true, input.shadow).specular;
}

fn litColor(input: SurfaceInput) -> vec4f {
    let albedo = input.diffuseColor * input.tint.rgb;
    var rgb = albedo;
    var highlightRgb = vec3f(0.0);
    if (sceneIsLit()) {
        let specular = materialHasSpecular();
        let sums = shadowedLightSums(input.viewNormal, input.viewPosition, specular, input.shadow);
        rgb = saturate(sums.diffuse * albedo + input.emissiveColor * input.tint.rgb);
        if (specular) {
            highlightRgb = sums.specular * input.gloss * input.specularColor * input.tint.rgb;
        }
    }
    rgb *= input.texel.rgb;
    return vec4f(rgb + highlightRgb, 1.0);
}

@fragment
fn ${SURFACE_FRAGMENT_ENTRY_POINT}(input: VertexOutput) -> @location(0) vec4f {
    let texel = textureSample(materialTexture, materialSampler, input.uv);
    let textured = material.textured != MATERIAL_UNTEXTURED;
    if (textured && texel.a < ALPHA_TEST_THRESHOLD) {
        discard;
    }
    var surfaceInput: SurfaceInput;
    surfaceInput.pixelPosition = input.clip.xy;
    surfaceInput.viewPosition = input.viewPosition;
    surfaceInput.viewNormal = unitOrZero(input.viewNormal);
    surfaceInput.toCamera = unitOrZero(-input.viewPosition);
    surfaceInput.uv = input.uv;
    surfaceInput.texel = select(UNTEXTURED_TEXEL, texel, textured);
    surfaceInput.gloss = textureSampleLevel(specularTexture, materialSampler, input.uv, SPECULAR_TEXTURE_MIP_LEVEL).rgb;
    surfaceInput.tint = input.tint;
    surfaceInput.diffuseColor = material.diffuse.rgb;
    surfaceInput.emissiveColor = material.emissive.rgb;
    surfaceInput.specularColor = material.specularShininess.rgb;
    surfaceInput.shininess = material.specularShininess.w;
    surfaceInput.params = array<f32, SURFACE_SHADER_PARAMS>(
        input.params0.x, input.params0.y, input.params0.z, input.params0.w,
        input.params1.x, input.params1.y, input.params1.z, input.params1.w
    );
    surfaceInput.time = frame.time;
    surfaceInput.shadow = shadowVisibility(surfaceInput.viewNormal, input.viewPosition);
    surfaceInput.lit = litColor(surfaceInput);
    return surface(surfaceInput);
}
`;

export const LIT_SURFACE_WGSL = `
${SURFACE_FUNCTION_SIGNATURE} {
    return input.lit;
}
`;

export function assembleSurfaceShader(name: string, surfaceSource: string): GpuShader {
    return {
        name,
        code: SURFACE_PRELUDE_WGSL + surfaceSource,
        vertexEntryPoint: SURFACE_VERTEX_ENTRY_POINT,
        fragmentEntryPoint: SURFACE_FRAGMENT_ENTRY_POINT,
    };
}

export const BASIC_LIT: GpuShader = assembleSurfaceShader(LIT_SURFACE_SHADER, LIT_SURFACE_WGSL);
