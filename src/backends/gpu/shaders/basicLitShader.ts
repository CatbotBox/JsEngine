import {
    LIGHT_KIND_DIRECTIONAL,
    LIGHT_KIND_RECT,
    LIGHT_KIND_SPHERE,
    LIGHT_KIND_SPOT,
    LIGHT_KIND_TUBE,
} from "../../../engine/rendering/3d/lighting/sceneLights";
import {
    AREA_LIGHT_WIDENING_DIVISOR,
    ROUGHNESS_FROM_SHININESS,
    SMALLEST_LIGHT_DISTANCE,
    SMALLEST_RAY_PLANE_COSINE,
    SMALLEST_ROUGHNESS,
    SMALLEST_SEGMENT_RAY_SPREAD,
} from "../../../engine/rendering/3d/lighting/shapedLights";
import {CHANNEL_MAX} from "../../../engine/rendering/packedRgb";
import {GPU_SHADER_STAGE} from "../gpuTypes";
import type {GpuShader} from "../gpuTypes";
import {FLOAT_BYTES, LIGHTS_UNLIT, NO_SHADOW_MAP_SLOT, VEC4_FLOATS} from "../gpuLightPacking";
import {MESH_NORMAL_OFFSET, MESH_POSITION_OFFSET, MESH_UV_OFFSET, MESH_VERTEX_FLOATS} from "../gpuMeshPacking";
import {INSTANCE_FLOATS, INSTANCE_MATRIX_OFFSET, INSTANCE_PARAMS_OFFSET, INSTANCE_TINT_OFFSET} from "../gpuInstanceBatcher";
import {LIT_SURFACE_SHADER, SURFACE_SHADER_PARAMS} from "../gpuSurfaceShader";
import {
    FULLY_LIT,
    NO_SHADOWED_LIGHT,
    SHADOW_MAP_FARTHEST_DEPTH,
    SHADOW_PROJECTION_CUBE,
    SHADOW_PROJECTION_PERSPECTIVE,
} from "../gpuShadowPacking";
import {LARGEST_HDR_SCENE_VALUE} from "../gpuSceneOutput";
import {COLOR_SPACE_WGSL} from "./colorSpaceShader";
import {wgslFloat} from "./wgsl";

export const FRAME_BIND_GROUP = 0;
export const MATERIAL_BIND_GROUP = 1;
export const FRAME_UNIFORMS_BINDING = 0;
export const LIGHTS_BINDING = 1;
export const SHADOWS_BINDING = 2;
export const DIRECTIONAL_SHADOW_MAPS_BINDING = 3;
export const SHADOW_SAMPLER_BINDING = 4;
export const SPOT_SHADOW_MAPS_BINDING = 5;
export const POINT_SHADOW_MAPS_BINDING = 6;
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
export const HDR_SCENE_OUTPUT_OVERRIDE = "HDR_SCENE_OUTPUT";

export const FRAME_BIND_GROUP_LAYOUT: GPUBindGroupLayoutDescriptor = {
    label: "frame",
    entries: [
        {binding: FRAME_UNIFORMS_BINDING, visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT, buffer: {type: "uniform"}},
        {binding: LIGHTS_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, buffer: {type: "read-only-storage"}},
        {binding: SHADOWS_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, buffer: {type: "read-only-storage"}},
        {binding: DIRECTIONAL_SHADOW_MAPS_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, texture: {sampleType: "depth", viewDimension: "2d-array"}},
        {binding: SHADOW_SAMPLER_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, sampler: {type: "comparison"}},
        {binding: SPOT_SHADOW_MAPS_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, texture: {sampleType: "depth", viewDimension: "2d-array"}},
        {binding: POINT_SHADOW_MAPS_BINDING, visibility: GPU_SHADER_STAGE.FRAGMENT, texture: {sampleType: "depth", viewDimension: "cube-array"}},
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
const LIGHT_KIND_SPOT: f32 = ${wgslFloat(LIGHT_KIND_SPOT)};
const LIGHT_KIND_SPHERE: f32 = ${wgslFloat(LIGHT_KIND_SPHERE)};
const LIGHT_KIND_TUBE: f32 = ${wgslFloat(LIGHT_KIND_TUBE)};
const LIGHT_KIND_RECT: f32 = ${wgslFloat(LIGHT_KIND_RECT)};
const AREA_LIGHT_WIDENING_DIVISOR: f32 = ${wgslFloat(AREA_LIGHT_WIDENING_DIVISOR)};
const ROUGHNESS_FROM_SHININESS: f32 = ${wgslFloat(ROUGHNESS_FROM_SHININESS)};
const SMALLEST_ROUGHNESS: f32 = ${wgslFloat(SMALLEST_ROUGHNESS)};
const SMALLEST_LIGHT_DISTANCE: f32 = ${wgslFloat(SMALLEST_LIGHT_DISTANCE)};
const SMALLEST_SEGMENT_RAY_SPREAD: f32 = ${wgslFloat(SMALLEST_SEGMENT_RAY_SPREAD)};
const SMALLEST_RAY_PLANE_COSINE: f32 = ${wgslFloat(SMALLEST_RAY_PLANE_COSINE)};
const ALPHA_TEST_THRESHOLD: f32 = ${wgslFloat(ALPHA_TEST_THRESHOLD)};
const SINGULAR_NORMAL_MATRIX_EPSILON: f32 = ${wgslFloat(SINGULAR_NORMAL_MATRIX_EPSILON)};
const MATERIAL_UNTEXTURED: f32 = ${wgslFloat(MATERIAL_UNTEXTURED)};
const HIGHEST_NORMAL_DOT_HALF: f32 = ${wgslFloat(HIGHEST_NORMAL_DOT_HALF)};
const SMALLEST_HIGHLIGHT_BASE: f32 = ${wgslFloat(SMALLEST_HIGHLIGHT_BASE)};
const SPECULAR_TEXTURE_MIP_LEVEL: f32 = ${wgslFloat(SPECULAR_TEXTURE_MIP_LEVEL)};
const LIGHTS_UNLIT: u32 = ${LIGHTS_UNLIT}u;
const SURFACE_SHADER_PARAMS: u32 = ${SURFACE_SHADER_PARAMS}u;
const UNTEXTURED_TEXEL: vec4f = vec4f(1.0);
const NO_SHADOWED_LIGHT: u32 = ${NO_SHADOWED_LIGHT}u;
const NO_SHADOW_MAP_SLOT: f32 = ${wgslFloat(NO_SHADOW_MAP_SLOT)};
const SHADOW_PROJECTION_PERSPECTIVE: u32 = ${SHADOW_PROJECTION_PERSPECTIVE}u;
const SHADOW_PROJECTION_CUBE: u32 = ${SHADOW_PROJECTION_CUBE}u;
const FULLY_LIT: f32 = ${wgslFloat(FULLY_LIT)};
const SHADOW_MAP_FARTHEST_DEPTH: f32 = ${wgslFloat(SHADOW_MAP_FARTHEST_DEPTH)};
const SHADOW_PCF_REACH_TAPS: i32 = ${SHADOW_PCF_REACH_TAPS};
const SHADOW_PCF_TAPS: f32 = ${wgslFloat(SHADOW_PCF_TAPS)};
const SHADOW_NDC_TO_UV_SCALE: vec2f = vec2f(${wgslFloat(NDC_TO_UV_SCALE)}, ${wgslFloat(-NDC_TO_UV_SCALE)});
const SHADOW_NDC_TO_UV_OFFSET: vec2f = vec2f(${wgslFloat(NDC_TO_UV_SCALE)});
const LARGEST_HDR_SCENE_VALUE: f32 = ${wgslFloat(LARGEST_HDR_SCENE_VALUE)};

override ${HDR_SCENE_OUTPUT_OVERRIDE}: bool = false;
${COLOR_SPACE_WGSL}
struct Frame {
    view: mat4x4f,
    projection: mat4x4f,
    time: f32,
}

struct Light {
    vector: vec4f,
    color: vec4f,
    kindRangeSquared: vec4f,
    direction: vec4f,
    axisX: vec4f,
    axisY: vec4f,
    shape: vec4f,
}

struct Lights {
    ambient: vec4f,
    count: u32,
    lit: u32,
    reserved0: u32,
    reserved1: u32,
    hemisphereGradient: mat3x3f,
    lights: array<Light>,
}

struct ShadowMap {
    viewToLight: mat4x4f,
    projection: u32,
    layer: u32,
    depthBias: f32,
    normalOffset: f32,
    filterStep: f32,
    strength: f32,
    fadeStart: f32,
    fadeInverseLength: f32,
    depthScale: f32,
    depthOffset: f32,
    reserved0: f32,
    reserved1: f32,
}

struct Shadows {
    primaryLightIndex: u32,
    mapCount: u32,
    reserved0: u32,
    reserved1: u32,
    maps: array<ShadowMap>,
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
@group(${FRAME_BIND_GROUP}) @binding(${SHADOWS_BINDING}) var<storage, read> sceneShadows: Shadows;
@group(${FRAME_BIND_GROUP}) @binding(${DIRECTIONAL_SHADOW_MAPS_BINDING}) var directionalShadowMaps: texture_depth_2d_array;
@group(${FRAME_BIND_GROUP}) @binding(${SHADOW_SAMPLER_BINDING}) var sceneShadowSampler: sampler_comparison;
@group(${FRAME_BIND_GROUP}) @binding(${SPOT_SHADOW_MAPS_BINDING}) var spotShadowMaps: texture_depth_2d_array;
@group(${FRAME_BIND_GROUP}) @binding(${POINT_SHADOW_MAPS_BINDING}) var pointShadowMaps: texture_depth_cube_array;
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

struct SpecularLobe {
    toLight: vec3f,
    attenuation: f32,
}

fn sceneIsLit() -> bool {
    return sceneLights.lit != LIGHTS_UNLIT;
}

fn ambientLight() -> vec3f {
    return sceneLights.ambient.rgb;
}

fn hemisphereLight(normal: vec3f) -> vec3f {
    return sceneLights.hemisphereGradient * normal;
}

fn sceneLightCount() -> u32 {
    return sceneLights.count;
}

fn unlitBy(entry: Light) -> SurfaceLight {
    return SurfaceLight(vec3f(0.0), entry.color.rgb, 0.0);
}

fn rangeFalloff(distanceSquared: f32, rangeSquared: f32) -> f32 {
    if (distanceSquared >= rangeSquared) {
        return 0.0;
    }
    let falloff = 1.0 - distanceSquared / rangeSquared;
    return falloff * falloff;
}

fn pointLight(entry: Light, viewPosition: vec3f) -> SurfaceLight {
    let offset = entry.vector.xyz - viewPosition;
    let distanceSquared = dot(offset, offset);
    let rangeSquared = entry.kindRangeSquared.y;
    if (distanceSquared >= rangeSquared || distanceSquared == 0.0) {
        return unlitBy(entry);
    }
    let falloff = 1.0 - distanceSquared / rangeSquared;
    return SurfaceLight(offset * inverseSqrt(distanceSquared), entry.color.rgb, falloff * falloff);
}

fn spotLight(entry: Light, viewPosition: vec3f) -> SurfaceLight {
    let light = pointLight(entry, viewPosition);
    let alongCone = -dot(light.toLight, entry.direction.xyz);
    let cone = smoothstep(0.0, 1.0, (alongCone - entry.shape.y) * entry.shape.z);
    return SurfaceLight(light.toLight, light.color, light.attenuation * cone);
}

fn capsuleLight(entry: Light, viewPosition: vec3f) -> SurfaceLight {
    let toCentre = entry.vector.xyz - viewPosition;
    let along = clamp(-dot(toCentre, entry.axisX.xyz), -entry.axisX.w, entry.axisX.w);
    let toCore = toCentre + entry.axisX.xyz * along;
    let coreDistanceSquared = dot(toCore, toCore);
    if (coreDistanceSquared == 0.0) {
        return unlitBy(entry);
    }
    let coreDistance = sqrt(coreDistanceSquared);
    let surfaceDistance = max(coreDistance - entry.shape.x, 0.0);
    return SurfaceLight(toCore / coreDistance, entry.color.rgb, rangeFalloff(surfaceDistance * surfaceDistance, entry.kindRangeSquared.y));
}

fn closestRectPoint(entry: Light, fromCentre: vec3f) -> vec3f {
    let across = clamp(dot(fromCentre, entry.axisX.xyz), -entry.axisX.w, entry.axisX.w);
    let up = clamp(dot(fromCentre, entry.axisY.xyz), -entry.axisY.w, entry.axisY.w);
    return entry.axisX.xyz * across + entry.axisY.xyz * up;
}

fn rectLight(entry: Light, viewPosition: vec3f) -> SurfaceLight {
    let fromCentre = viewPosition - entry.vector.xyz;
    if (dot(fromCentre, entry.direction.xyz) <= 0.0) {
        return unlitBy(entry);
    }
    let toClosest = closestRectPoint(entry, fromCentre) - fromCentre;
    let distanceSquared = dot(toClosest, toClosest);
    if (distanceSquared == 0.0) {
        return unlitBy(entry);
    }
    let toLight = toClosest / sqrt(distanceSquared);
    let emitterCosine = max(-dot(toLight, entry.direction.xyz), 0.0);
    return SurfaceLight(toLight, entry.color.rgb, rangeFalloff(distanceSquared, entry.kindRangeSquared.y) * emitterCosine);
}

fn sceneLight(index: u32, viewPosition: vec3f) -> SurfaceLight {
    let entry = sceneLights.lights[index];
    let kind = entry.kindRangeSquared.x;
    if (kind == LIGHT_KIND_DIRECTIONAL) {
        return SurfaceLight(entry.vector.xyz, entry.color.rgb, 1.0);
    }
    if (kind == LIGHT_KIND_SPOT) {
        return spotLight(entry, viewPosition);
    }
    if (kind == LIGHT_KIND_SPHERE || kind == LIGHT_KIND_TUBE) {
        return capsuleLight(entry, viewPosition);
    }
    if (kind == LIGHT_KIND_RECT) {
        return rectLight(entry, viewPosition);
    }
    return pointLight(entry, viewPosition);
}

fn materialRoughness() -> f32 {
    return max(sqrt(ROUGHNESS_FROM_SHININESS / (max(material.specularShininess.w, 0.0) + ROUGHNESS_FROM_SHININESS)), SMALLEST_ROUGHNESS);
}

fn widenedRoughness(roughness: f32, halfExtent: f32, lightDistance: f32) -> f32 {
    return saturate(roughness + halfExtent / (AREA_LIGHT_WIDENING_DIVISOR * max(lightDistance, SMALLEST_LIGHT_DISTANCE)));
}

fn towardOr(offset: vec3f, fallback: vec3f) -> vec3f {
    let lengthSquared = dot(offset, offset);
    if (lengthSquared > 0.0) {
        return offset * inverseSqrt(lengthSquared);
    }
    return fallback;
}

fn capsuleSpecular(entry: Light, viewPosition: vec3f, reflection: vec3f, light: SurfaceLight) -> SpecularLobe {
    let toCentre = entry.vector.xyz - viewPosition;
    let halfLength = entry.axisX.w;
    let radius = entry.shape.x;
    let start = toCentre - entry.axisX.xyz * halfLength;
    let span = toCentre + entry.axisX.xyz * halfLength - start;
    let reflectionDotSpan = dot(reflection, span);
    let spread = max(dot(span, span) - reflectionDotSpan * reflectionDotSpan, SMALLEST_SEGMENT_RAY_SPREAD);
    let along = saturate((dot(reflection, start) * reflectionDotSpan - dot(start, span)) / spread);
    var nearest = start + span * along;
    let centreToRay = dot(nearest, reflection) * reflection - nearest;
    let centreToRayLengthSquared = dot(centreToRay, centreToRay);
    if (centreToRayLengthSquared > 0.0) {
        nearest += centreToRay * saturate(radius * inverseSqrt(centreToRayLengthSquared));
    }
    let roughness = materialRoughness();
    let centreDistance = length(toCentre);
    let radiusRatio = roughness / widenedRoughness(roughness, radius, centreDistance);
    let lengthRatio = roughness / widenedRoughness(roughness, halfLength, centreDistance);
    return SpecularLobe(towardOr(nearest, light.toLight), light.attenuation * radiusRatio * radiusRatio * lengthRatio);
}

fn rectSpecular(entry: Light, viewPosition: vec3f, reflection: vec3f, light: SurfaceLight) -> SpecularLobe {
    let fromCentre = viewPosition - entry.vector.xyz;
    let height = dot(fromCentre, entry.direction.xyz);
    let reach = height / max(-dot(reflection, entry.direction.xyz), SMALLEST_RAY_PLANE_COSINE);
    let toPoint = closestRectPoint(entry, fromCentre + reflection * reach) - fromCentre;
    let roughness = materialRoughness();
    let centreDistance = length(fromCentre);
    let widthRatio = roughness / widenedRoughness(roughness, entry.axisX.w, centreDistance);
    let heightRatio = roughness / widenedRoughness(roughness, entry.axisY.w, centreDistance);
    return SpecularLobe(towardOr(toPoint, light.toLight), light.attenuation * widthRatio * heightRatio);
}

fn specularLobe(index: u32, viewPosition: vec3f, reflection: vec3f, light: SurfaceLight) -> SpecularLobe {
    let entry = sceneLights.lights[index];
    let kind = entry.kindRangeSquared.x;
    if (kind == LIGHT_KIND_SPHERE || kind == LIGHT_KIND_TUBE) {
        return capsuleSpecular(entry, viewPosition, reflection, light);
    }
    if (kind == LIGHT_KIND_RECT) {
        return rectSpecular(entry, viewPosition, reflection, light);
    }
    return SpecularLobe(light.toLight, light.attenuation);
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

fn shadowedBy(map: ShadowMap, lit: f32) -> f32 {
    return FULLY_LIT - map.strength * (FULLY_LIT - lit);
}

fn outsideShadowMap(uv: vec2f, depth: f32) -> bool {
    return any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || depth > SHADOW_MAP_FARTHEST_DEPTH;
}

fn filteredShadow(maps: texture_depth_2d_array, uv: vec2f, layer: u32, depth: f32, filterStep: f32) -> f32 {
    var lit = 0.0;
    for (var y = -SHADOW_PCF_REACH_TAPS; y <= SHADOW_PCF_REACH_TAPS; y++) {
        for (var x = -SHADOW_PCF_REACH_TAPS; x <= SHADOW_PCF_REACH_TAPS; x++) {
            let tap = uv + vec2f(f32(x), f32(y)) * filterStep;
            lit += textureSampleCompareLevel(maps, sceneShadowSampler, tap, layer, depth);
        }
    }
    return lit / SHADOW_PCF_TAPS;
}

fn perspectiveShadowDepth(map: ShadowMap, lightDistance: f32) -> f32 {
    return map.depthScale + map.depthOffset / (lightDistance * (FULLY_LIT - map.depthBias));
}

fn directionalShadow(map: ShadowMap, normal: vec3f, viewPosition: vec3f) -> f32 {
    let fade = saturate((viewPosition.z - map.fadeStart) * map.fadeInverseLength);
    if (fade >= FULLY_LIT) {
        return FULLY_LIT;
    }
    let lightClip = map.viewToLight * vec4f(viewPosition + normal * map.normalOffset, 1.0);
    let uv = lightClip.xy * SHADOW_NDC_TO_UV_SCALE + SHADOW_NDC_TO_UV_OFFSET;
    let depth = lightClip.z - map.depthBias;
    if (outsideShadowMap(uv, depth)) {
        return FULLY_LIT;
    }
    return mix(shadowedBy(map, filteredShadow(directionalShadowMaps, uv, map.layer, depth, map.filterStep)), FULLY_LIT, fade);
}

fn spotShadow(map: ShadowMap, normal: vec3f, viewPosition: vec3f) -> f32 {
    let centre = map.viewToLight * vec4f(viewPosition, 1.0);
    if (centre.w <= 0.0) {
        return FULLY_LIT;
    }
    let lightClip = centre + map.viewToLight * vec4f(normal * (map.normalOffset * centre.w), 0.0);
    if (lightClip.w <= 0.0) {
        return FULLY_LIT;
    }
    let uv = lightClip.xy / lightClip.w * SHADOW_NDC_TO_UV_SCALE + SHADOW_NDC_TO_UV_OFFSET;
    let depth = perspectiveShadowDepth(map, lightClip.w);
    if (outsideShadowMap(uv, depth)) {
        return FULLY_LIT;
    }
    return shadowedBy(map, filteredShadow(spotShadowMaps, uv, map.layer, depth, map.filterStep));
}

fn majorAxisLength(v: vec3f) -> f32 {
    let size = abs(v);
    return max(size.x, max(size.y, size.z));
}

fn pointShadow(map: ShadowMap, normal: vec3f, viewPosition: vec3f) -> f32 {
    let centre = (map.viewToLight * vec4f(viewPosition, 1.0)).xyz;
    let reach = majorAxisLength(centre);
    if (reach <= 0.0) {
        return FULLY_LIT;
    }
    let toSurface = centre + (map.viewToLight * vec4f(normal * (map.normalOffset * reach), 0.0)).xyz;
    let size = abs(toSurface);
    let surfaceReach = max(size.x, max(size.y, size.z));
    if (surfaceReach <= 0.0) {
        return FULLY_LIT;
    }
    let depth = perspectiveShadowDepth(map, surfaceReach);
    if (depth > SHADOW_MAP_FARTHEST_DEPTH) {
        return FULLY_LIT;
    }
    var across = vec3f(0.0, 1.0, 0.0);
    var along = vec3f(0.0, 0.0, 1.0);
    if (size.y >= size.x && size.y >= size.z) {
        across = vec3f(1.0, 0.0, 0.0);
    } else if (size.z >= size.x) {
        across = vec3f(1.0, 0.0, 0.0);
        along = vec3f(0.0, 1.0, 0.0);
    }
    let tapSpacing = map.filterStep * surfaceReach;
    var lit = 0.0;
    for (var y = -SHADOW_PCF_REACH_TAPS; y <= SHADOW_PCF_REACH_TAPS; y++) {
        for (var x = -SHADOW_PCF_REACH_TAPS; x <= SHADOW_PCF_REACH_TAPS; x++) {
            let tap = toSurface + (across * f32(x) + along * f32(y)) * tapSpacing;
            lit += textureSampleCompareLevel(pointShadowMaps, sceneShadowSampler, tap, map.layer, depth);
        }
    }
    return shadowedBy(map, lit / SHADOW_PCF_TAPS);
}

fn lightShadowAt(index: u32, normal: vec3f, viewPosition: vec3f) -> f32 {
    let slot = sceneLights.lights[index].kindRangeSquared.z;
    if (slot == NO_SHADOW_MAP_SLOT) {
        return FULLY_LIT;
    }
    let map = sceneShadows.maps[u32(slot)];
    if (map.projection == SHADOW_PROJECTION_CUBE) {
        return pointShadow(map, normal, viewPosition);
    }
    if (map.projection == SHADOW_PROJECTION_PERSPECTIVE) {
        return spotShadow(map, normal, viewPosition);
    }
    return directionalShadow(map, normal, viewPosition);
}

fn shadowedLightIndex() -> u32 {
    return sceneShadows.primaryLightIndex;
}

fn shadowVisibility(normal: vec3f, viewPosition: vec3f) -> f32 {
    let index = shadowedLightIndex();
    if (index == NO_SHADOWED_LIGHT) {
        return FULLY_LIT;
    }
    return lightShadowAt(index, normal, viewPosition);
}

fn lightShadow(index: u32, input: SurfaceInput) -> f32 {
    if (index == shadowedLightIndex()) {
        return input.shadow;
    }
    return lightShadowAt(index, input.viewNormal, input.viewPosition);
}

fn shadowedLightSums(normal: vec3f, viewPosition: vec3f, specular: bool, shadow: f32) -> LightSums {
    var sums = LightSums(ambientLight() + hemisphereLight(normal), vec3f(0.0));
    var toCamera = vec3f(0.0);
    var reflection = vec3f(0.0);
    if (specular) {
        toCamera = unitOrZero(-viewPosition);
        reflection = reflect(-toCamera, normal);
    }
    for (var i = 0u; i < sceneLightCount(); i++) {
        let light = sceneLight(i, viewPosition);
        let diffuse = dot(normal, light.toLight) * light.attenuation;
        if (diffuse > 0.0) {
            var color = light.color;
            if (i == shadowedLightIndex()) {
                color *= shadow;
            } else {
                color *= lightShadowAt(i, normal, viewPosition);
            }
            sums.diffuse += color * diffuse;
            if (specular) {
                let lobe = specularLobe(i, viewPosition, reflection, light);
                sums.specular += color * highlight(normal, lobe.toLight, toCamera) * lobe.attenuation;
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

fn sceneRange(rgb: vec3f) -> vec3f {
    if (${HDR_SCENE_OUTPUT_OVERRIDE}) {
        return rgb;
    }
    return saturate(rgb);
}

fn sceneOutput(color: vec4f) -> vec4f {
    if (${HDR_SCENE_OUTPUT_OVERRIDE}) {
        return vec4f(min(displayToLinear(max(color.rgb, vec3f(0.0))), vec3f(LARGEST_HDR_SCENE_VALUE)), color.a);
    }
    return color;
}

fn litColor(input: SurfaceInput) -> vec4f {
    let albedo = input.diffuseColor * input.tint.rgb;
    var rgb = albedo;
    var highlightRgb = vec3f(0.0);
    if (sceneIsLit()) {
        let specular = materialHasSpecular();
        let sums = shadowedLightSums(input.viewNormal, input.viewPosition, specular, input.shadow);
        rgb = sceneRange(sums.diffuse * albedo + input.emissiveColor * input.tint.rgb);
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
    return sceneOutput(surface(surfaceInput));
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
