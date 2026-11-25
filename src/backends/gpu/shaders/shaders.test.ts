import {describe, expect, test} from "../../../engine/testing/harness";
import {LIGHT_KIND_DIRECTIONAL, LIGHT_KIND_RECT, LIGHT_KIND_SPHERE, LIGHT_KIND_SPOT, LIGHT_KIND_TUBE} from "../../../engine/rendering/3d/lighting/sceneLights";
import {
    AREA_LIGHT_WIDENING_DIVISOR,
    ROUGHNESS_FROM_SHININESS,
    SMALLEST_LIGHT_DISTANCE,
    SMALLEST_RAY_PLANE_COSINE,
    SMALLEST_ROUGHNESS,
    SMALLEST_SEGMENT_RAY_SPREAD,
} from "../../../engine/rendering/3d/lighting/shapedLights";
import {
    FLOAT_BYTES,
    LIGHT_AXIS_X_OFFSET,
    LIGHT_AXIS_Y_OFFSET,
    LIGHT_COLOR_OFFSET,
    LIGHT_CONE_COS_OUTER_OFFSET,
    LIGHT_CONE_SCALE_OFFSET,
    LIGHT_DIRECTION_OFFSET,
    LIGHT_EXTENT_X_OFFSET,
    LIGHT_EXTENT_Y_OFFSET,
    LIGHT_KIND_OFFSET,
    LIGHT_RADIUS_OFFSET,
    LIGHT_RANGE_SQUARED_OFFSET,
    LIGHT_SHADOW_MAP_OFFSET,
    LIGHT_SHAPE_OFFSET,
    LIGHT_STRIDE_FLOATS,
    LIGHT_VECTOR_OFFSET,
    LIGHTS_HEADER_FLOATS,
    LIGHTS_HEMISPHERE_GRADIENT_OFFSET,
    LIGHTS_UNLIT,
    MAT3_COLUMNS,
    NO_SHADOW_MAP_SLOT,
    VEC4_FLOATS,
} from "../gpuLightPacking";
import {MESH_VERTEX_FLOATS} from "../gpuMeshPacking";
import {INSTANCE_FLOATS, INSTANCE_PARAMS_OFFSET} from "../gpuInstanceBatcher";
import {FRAME_TIME_OFFSET, FRAME_UNIFORM_FLOATS} from "../gpuCamera";
import {LIT_SURFACE_SHADER, SURFACE_SHADER_PARAMS} from "../gpuSurfaceShader";
import {GPU_SHADER_STAGE} from "../gpuTypes";
import {
    ALPHA_TEST_THRESHOLD,
    assembleSurfaceShader,
    BASIC_LIT,
    BASIC_LIT_VERTEX_BUFFERS,
    FRAME_BIND_GROUP,
    FRAME_BIND_GROUP_LAYOUT,
    FRAME_UNIFORMS_BINDING,
    HDR_SCENE_OUTPUT_OVERRIDE,
    HIGHEST_NORMAL_DOT_HALF,
    INSTANCE_MATRIX_FIRST_LOCATION,
    INSTANCE_PARAMS_FIRST_LOCATION,
    INSTANCE_PARAMS_VECTORS,
    INSTANCE_TINT_LOCATION,
    INSTANCE_VERTEX_BUFFER_SLOT,
    LIGHTS_BINDING,
    LIT_SURFACE_WGSL,
    MATERIAL_BIND_GROUP,
    MATERIAL_BIND_GROUP_LAYOUT,
    MATERIAL_SAMPLER_BINDING,
    MATERIAL_SPECULAR_TEXTURE_BINDING,
    MATERIAL_TEXTURE_BINDING,
    MATERIAL_UNIFORMS_BINDING,
    MATERIAL_UNTEXTURED,
    MESH_VERTEX_BUFFER_SLOT,
    NORMAL_LOCATION,
    POSITION_LOCATION,
    DIRECTIONAL_SHADOW_MAPS_BINDING,
    POINT_SHADOW_MAPS_BINDING,
    SHADOW_PCF_REACH_TAPS,
    SHADOW_PCF_TAPS,
    SHADOW_SAMPLER_BINDING,
    SHADOWS_BINDING,
    SPOT_SHADOW_MAPS_BINDING,
    SMALLEST_HIGHLIGHT_BASE,
    SPECULAR_TEXTURE_MIP_LEVEL,
    SURFACE_FRAGMENT_ENTRY_POINT,
    SURFACE_FUNCTION_SIGNATURE,
    SURFACE_VERTEX_ENTRY_POINT,
    UV_LOCATION,
} from "./basicLitShader";
import {OVERLAY, OVERLAY_BIND_GROUP, OVERLAY_BIND_GROUP_LAYOUT, OVERLAY_SAMPLER_BINDING, OVERLAY_TEXTURE_BINDING} from "./overlayShader";
import {
    SHADOW_CASTER_BIND_GROUP,
    SHADOW_CASTER_BIND_GROUP_LAYOUT,
    SHADOW_CASTER_UNIFORM_BYTES,
    SHADOW_CASTER_UNIFORM_STRIDE_BYTES,
    SHADOW_CASTER_UNIFORMS_BINDING,
    SHADOW_CASTER_VERTEX_BUFFERS,
    SHADOW_CASTER_VERTEX_ENTRY_POINT,
    SHADOW_CASTER_WGSL,
} from "./shadowCasterShader";
import {
    FULLY_LIT,
    NO_SHADOWED_LIGHT,
    SHADOW_MAP_DEPTH_BIAS_OFFSET,
    SHADOW_MAP_DEPTH_OFFSET_OFFSET,
    SHADOW_MAP_DEPTH_SCALE_OFFSET,
    SHADOW_MAP_FADE_INVERSE_LENGTH_OFFSET,
    SHADOW_MAP_FADE_START_OFFSET,
    SHADOW_MAP_FARTHEST_DEPTH,
    SHADOW_MAP_FILTER_STEP_OFFSET,
    SHADOW_MAP_LAYER_OFFSET,
    SHADOW_MAP_NORMAL_OFFSET_OFFSET,
    SHADOW_MAP_PROJECTION_OFFSET,
    SHADOW_MAP_STRENGTH_OFFSET,
    SHADOW_MAP_STRIDE_FLOATS,
    SHADOW_MAP_VIEW_TO_LIGHT_OFFSET,
    SHADOW_PROJECTION_CUBE,
    SHADOW_PROJECTION_PERSPECTIVE,
    SHADOWS_HEADER_FLOATS,
    SHADOWS_MAP_COUNT_OFFSET,
    SHADOWS_PRIMARY_LIGHT_OFFSET,
} from "../gpuShadowPacking";
import {MAT4_FLOATS} from "../../../engine/math/mat4Layout";
import {LARGEST_HDR_SCENE_VALUE} from "../gpuSceneOutput";
import {SRGB_ENCODED_LINEAR_LIMIT, SRGB_GAMMA, SRGB_LINEAR_LIMIT, SRGB_LINEAR_SLOPE, SRGB_OFFSET, SRGB_SCALE} from "../gpuColorSpace";
import {COLOR_SPACE_WGSL} from "./colorSpaceShader";
import {
    ACES_A,
    ACES_B,
    ACES_C,
    ACES_D,
    ACES_E,
    ACES_TONE_MAPPING_ID,
    AGX_CURVE_COEFFICIENTS,
    AGX_DISPLAY_GAMMA,
    AGX_INSET_COLUMNS,
    AGX_MAX_EV,
    AGX_MIN_EV,
    AGX_OUTSET_COLUMNS,
    AGX_SMALLEST_INPUT,
    AGX_TONE_MAPPING_ID,
    BLOOM_DOWNSAMPLE_ENTRY_POINT,
    BLOOM_PREFILTER_OVERRIDE,
    BLOOM_UPSAMPLE_ENTRY_POINT,
    BOX_AVERAGE,
    COMPOSITE_ENTRY_POINT,
    DOWNSAMPLE_CENTRE_WEIGHT,
    DOWNSAMPLE_CORNER_WEIGHT,
    DOWNSAMPLE_INNER_REACH_TEXELS,
    DOWNSAMPLE_OUTER_REACH_TEXELS,
    ENCODE_SRGB_OUTPUT_OVERRIDE,
    FULL_SCREEN_VERTEX_ENTRY_POINT,
    LUMA_WEIGHTS,
    POST_BLOOM_INTENSITY_OFFSET,
    POST_BLOOM_KNEE_OFFSET,
    POST_BLOOM_THRESHOLD_OFFSET,
    POST_EXPOSURE_OFFSET,
    POST_PROCESS_UNIFORM_FLOATS,
    POST_PROCESS_WGSL,
    REINHARD_TONE_MAPPING_ID,
    TENT_CENTRE_WEIGHT,
    TENT_CORNER_WEIGHT,
    TENT_EDGE_WEIGHT,
    TENT_REACH_TEXELS,
    TENT_TOTAL_WEIGHT,
    TONE_MAPPING_OVERRIDE,
} from "./postProcessShader";
import {
    BLOOM_BIND_GROUP_LAYOUT,
    COMPOSITE_BIND_GROUP_LAYOUT,
    POST_BLOOM_BINDING,
    POST_PROCESS_BIND_GROUP,
    POST_SAMPLER_BINDING,
    POST_SOURCE_BINDING,
    POST_UNIFORMS_BINDING,
} from "./postProcessLayout";
import {wgslFloat} from "./wgsl";

function fieldsOf(code: string, struct: string): string[] {
    const body = new RegExp(`struct ${struct} \\{([^}]*)\\}`).exec(code)?.[1] ?? "";
    return [...body.matchAll(/(\w+):/g)].map(match => match[1]);
}

function bindingsOf(layout: GPUBindGroupLayoutDescriptor): number[] {
    return [...layout.entries].map(entry => entry.binding);
}

function functionBody(code: string, signatureStart: string): string {
    const start = code.indexOf(signatureStart);
    const ends = [code.indexOf("\nfn ", start + signatureStart.length), code.indexOf("\n@", start + signatureStart.length)].filter(end => end > start);
    return code.slice(start, ends.length === 0 ? code.length : Math.min(...ends));
}

function occurrences(text: string, token: string): number {
    return text.split(token).length - 1;
}

const VEC4_COMPONENTS: readonly string[] = ["x", "y", "z", "w"];
const DOWNSAMPLE_TAPS = 13;
const DOWNSAMPLE_BOXES = 5;
const TENT_TAPS = 9;
const SIDES = 4;

const UNIFORM_STRUCT_ALIGNMENT_BYTES = 16;
const TOON_SOURCE = `${SURFACE_FUNCTION_SIGNATURE} {
    let bands = max(input.params[0], 1.0);
    return vec4f(floor(lightDiffuse(input) * bands) / bands * input.diffuseColor, 1.0);
}
`;

describe("WGSL templates", () => {
    test("the lit shader declares the bindings the bind group layouts use", () => {
        const code = BASIC_LIT.code;
        for (const binding of bindingsOf(FRAME_BIND_GROUP_LAYOUT)) expect(code.includes(`@group(${FRAME_BIND_GROUP}) @binding(${binding})`)).toBe(true);
        for (const binding of bindingsOf(MATERIAL_BIND_GROUP_LAYOUT)) expect(code.includes(`@group(${MATERIAL_BIND_GROUP}) @binding(${binding})`)).toBe(true);
        expect(bindingsOf(FRAME_BIND_GROUP_LAYOUT)).toEqual([
            FRAME_UNIFORMS_BINDING, LIGHTS_BINDING, SHADOWS_BINDING, DIRECTIONAL_SHADOW_MAPS_BINDING, SHADOW_SAMPLER_BINDING, SPOT_SHADOW_MAPS_BINDING, POINT_SHADOW_MAPS_BINDING,
        ]);
        expect(code.includes(`@binding(${SHADOWS_BINDING}) var<storage, read> sceneShadows: Shadows;`)).toBe(true);
        expect(code.includes(`@binding(${DIRECTIONAL_SHADOW_MAPS_BINDING}) var directionalShadowMaps: texture_depth_2d_array;`)).toBe(true);
        expect(code.includes(`@binding(${SHADOW_SAMPLER_BINDING}) var sceneShadowSampler: sampler_comparison;`)).toBe(true);
        expect(code.includes(`@binding(${SPOT_SHADOW_MAPS_BINDING}) var spotShadowMaps: texture_depth_2d_array;`)).toBe(true);
        expect(code.includes(`@binding(${POINT_SHADOW_MAPS_BINDING}) var pointShadowMaps: texture_depth_cube_array;`)).toBe(true);
        const shadowEntries = [...FRAME_BIND_GROUP_LAYOUT.entries].filter(entry => entry.binding >= SHADOWS_BINDING);
        expect(shadowEntries.map(entry => [entry.visibility, entry.buffer?.type, entry.texture?.sampleType, entry.texture?.viewDimension, entry.sampler?.type])).toEqual([
            [GPU_SHADER_STAGE.FRAGMENT, "read-only-storage", undefined, undefined, undefined],
            [GPU_SHADER_STAGE.FRAGMENT, undefined, "depth", "2d-array", undefined],
            [GPU_SHADER_STAGE.FRAGMENT, undefined, undefined, undefined, "comparison"],
            [GPU_SHADER_STAGE.FRAGMENT, undefined, "depth", "2d-array", undefined],
            [GPU_SHADER_STAGE.FRAGMENT, undefined, "depth", "cube-array", undefined],
        ]);
        expect(bindingsOf(MATERIAL_BIND_GROUP_LAYOUT)).toEqual([MATERIAL_UNIFORMS_BINDING, MATERIAL_SAMPLER_BINDING, MATERIAL_TEXTURE_BINDING, MATERIAL_SPECULAR_TEXTURE_BINDING]);
        expect(code.includes(`@binding(${MATERIAL_SPECULAR_TEXTURE_BINDING}) var specularTexture: texture_2d<f32>;`)).toBe(true);
    });

    test("the lit shader reads every vertex attribute the vertex buffer layouts provide, at the same locations and strides", () => {
        const code = BASIC_LIT.code;
        const locations = BASIC_LIT_VERTEX_BUFFERS.flatMap(buffer => [...buffer.attributes].map(attribute => attribute.shaderLocation));
        expect(locations).toEqual([POSITION_LOCATION, NORMAL_LOCATION, UV_LOCATION,
            INSTANCE_MATRIX_FIRST_LOCATION, INSTANCE_MATRIX_FIRST_LOCATION + 1, INSTANCE_MATRIX_FIRST_LOCATION + 2, INSTANCE_MATRIX_FIRST_LOCATION + 3, INSTANCE_TINT_LOCATION,
            INSTANCE_PARAMS_FIRST_LOCATION, INSTANCE_PARAMS_FIRST_LOCATION + 1]);
        for (const location of locations) expect(code.includes(`@location(${location})`)).toBe(true);
        expect(code.includes(`@location(${INSTANCE_TINT_LOCATION}) tint`)).toBe(true);
        expect(code.includes(`@location(${INSTANCE_PARAMS_FIRST_LOCATION}) params0: vec4f`) && code.includes(`@location(${INSTANCE_PARAMS_FIRST_LOCATION + 1}) params1: vec4f`)).toBe(true);
        const paramAttributes = [...BASIC_LIT_VERTEX_BUFFERS[INSTANCE_VERTEX_BUFFER_SLOT].attributes].filter(attribute => attribute.shaderLocation >= INSTANCE_PARAMS_FIRST_LOCATION);
        expect(paramAttributes.map(attribute => [attribute.offset, attribute.format])).toEqual([
            [INSTANCE_PARAMS_OFFSET * FLOAT_BYTES, "float32x4"], [(INSTANCE_PARAMS_OFFSET + 4) * FLOAT_BYTES, "float32x4"],
        ]);
        expect(INSTANCE_PARAMS_VECTORS * 4).toBe(SURFACE_SHADER_PARAMS);
        expect(BASIC_LIT_VERTEX_BUFFERS[MESH_VERTEX_BUFFER_SLOT].arrayStride).toBe(MESH_VERTEX_FLOATS * FLOAT_BYTES);
        expect([BASIC_LIT_VERTEX_BUFFERS[INSTANCE_VERTEX_BUFFER_SLOT].arrayStride, BASIC_LIT_VERTEX_BUFFERS[INSTANCE_VERTEX_BUFFER_SLOT].stepMode]).toEqual([INSTANCE_FLOATS * FLOAT_BYTES, "instance"]);
    });

    test("the lit shader takes its constants from the TypeScript side", () => {
        const code = BASIC_LIT.code;
        expect(code.includes(`const LIGHT_KIND_DIRECTIONAL: f32 = ${wgslFloat(LIGHT_KIND_DIRECTIONAL)};`)).toBe(true);
        expect(code.includes(`const ALPHA_TEST_THRESHOLD: f32 = ${wgslFloat(ALPHA_TEST_THRESHOLD)};`)).toBe(true);
        expect(code.includes(`const MATERIAL_UNTEXTURED: f32 = ${wgslFloat(MATERIAL_UNTEXTURED)};`)).toBe(true);
        expect(code.includes(`const LIGHTS_UNLIT: u32 = ${LIGHTS_UNLIT}u;`)).toBe(true);
        expect(code.includes(`const HIGHEST_NORMAL_DOT_HALF: f32 = ${wgslFloat(HIGHEST_NORMAL_DOT_HALF)};`)).toBe(true);
        expect(code.includes(`const SMALLEST_HIGHLIGHT_BASE: f32 = ${wgslFloat(SMALLEST_HIGHLIGHT_BASE)};`)).toBe(true);
        expect(code.includes(`const SPECULAR_TEXTURE_MIP_LEVEL: f32 = ${wgslFloat(SPECULAR_TEXTURE_MIP_LEVEL)};`)).toBe(true);
        expect(code.includes(`const SURFACE_SHADER_PARAMS: u32 = ${SURFACE_SHADER_PARAMS}u;`)).toBe(true);
        expect(code.includes("${")).toBe(false);
    });

    test("uniform structs list their fields in the order the packing offsets assume", () => {
        expect(fieldsOf(BASIC_LIT.code, "Frame")).toEqual(["view", "projection", "time"]);
        expect(fieldsOf(BASIC_LIT.code, "Lights")).toEqual(["ambient", "count", "lit", "reserved0", "reserved1", "hemisphereGradient", "lights"]);
        expect(fieldsOf(BASIC_LIT.code, "Light")).toEqual(["vector", "color", "kindRangeSquared", "direction", "axisX", "axisY", "shape"]);
        expect(fieldsOf(BASIC_LIT.code, "Material")).toEqual(["diffuse", "emissive", "specularShininess", "textured", "specularCutoff", "reserved0", "reserved1"]);
    });

    test("the highlight is skipped for materials without specular, gated by the cutoff, and added after the texel multiply", () => {
        const code = BASIC_LIT.code;
        expect(code.includes("return material.specularCutoff <= HIGHEST_NORMAL_DOT_HALF;")).toBe(true);
        expect(code.includes("let specular = materialHasSpecular();")).toBe(true);
        expect(code.includes("if (normalDotHalf < material.specularCutoff) {")).toBe(true);
        expect(code.includes("textureSampleLevel(specularTexture, materialSampler, input.uv, SPECULAR_TEXTURE_MIP_LEVEL)")).toBe(true);
        const texelMultiply = code.indexOf("rgb *= input.texel.rgb;");
        const highlightAdded = code.indexOf("return vec4f(rgb + highlightRgb, 1.0);");
        expect(texelMultiply).toBeGreaterThan(0);
        expect(highlightAdded).toBeGreaterThan(texelMultiply);
    });

    test("the frame uniforms end with the elapsed time, are visible to fragment shaders, and keep the uniform struct 16-byte aligned", () => {
        expect(FRAME_TIME_OFFSET).toBe(FRAME_UNIFORM_FLOATS - 4);
        expect((FRAME_UNIFORM_FLOATS * FLOAT_BYTES) % UNIFORM_STRUCT_ALIGNMENT_BYTES).toBe(0);
        const frameUniforms = [...FRAME_BIND_GROUP_LAYOUT.entries].find(entry => entry.binding === FRAME_UNIFORMS_BINDING)!;
        expect(frameUniforms.visibility & GPU_SHADER_STAGE.FRAGMENT).toBe(GPU_SHADER_STAGE.FRAGMENT);
        expect(BASIC_LIT.code.includes("surfaceInput.time = frame.time;")).toBe(true);
    });

    test("the built-in lit shader is the template with the lit surface, which returns the built-in lit result", () => {
        expect(BASIC_LIT.name).toBe(LIT_SURFACE_SHADER);
        expect(BASIC_LIT.code.endsWith(LIT_SURFACE_WGSL)).toBe(true);
        expect(LIT_SURFACE_WGSL.includes(`${SURFACE_FUNCTION_SIGNATURE} {\n    return input.lit;\n}`)).toBe(true);
        expect(BASIC_LIT.code.includes("surfaceInput.lit = litColor(surfaceInput);\n    return sceneOutput(surface(surfaceInput));")).toBe(true);
        expect([BASIC_LIT.vertexEntryPoint, BASIC_LIT.fragmentEntryPoint]).toEqual([SURFACE_VERTEX_ENTRY_POINT, SURFACE_FRAGMENT_ENTRY_POINT]);
    });

    test("a custom surface shader is the same template, constants, bindings and locations as the lit shader, followed by its snippet", () => {
        const toon = assembleSurfaceShader("toon", TOON_SOURCE);
        const template = BASIC_LIT.code.slice(0, BASIC_LIT.code.length - LIT_SURFACE_WGSL.length);
        expect(toon.code).toBe(template + TOON_SOURCE);
        expect(template.includes(SURFACE_FUNCTION_SIGNATURE)).toBe(false);
        for (const binding of bindingsOf(FRAME_BIND_GROUP_LAYOUT)) expect(toon.code.includes(`@group(${FRAME_BIND_GROUP}) @binding(${binding})`)).toBe(true);
        for (const binding of bindingsOf(MATERIAL_BIND_GROUP_LAYOUT)) expect(toon.code.includes(`@group(${MATERIAL_BIND_GROUP}) @binding(${binding})`)).toBe(true);
        expect(toon.code.includes(`const LIGHT_KIND_DIRECTIONAL: f32 = ${wgslFloat(LIGHT_KIND_DIRECTIONAL)};`)).toBe(true);
        expect(toon.code.includes(`@location(${INSTANCE_PARAMS_FIRST_LOCATION}) params0: vec4f`)).toBe(true);
        expect([toon.name, toon.vertexEntryPoint, toon.fragmentEntryPoint]).toEqual(["toon", BASIC_LIT.vertexEntryPoint, BASIC_LIT.fragmentEntryPoint]);
    });

    test("the surface input and its lighting helpers are declared for snippets to use", () => {
        expect(fieldsOf(BASIC_LIT.code, "SurfaceInput")).toEqual([
            "pixelPosition", "viewPosition", "viewNormal", "toCamera", "uv", "texel", "gloss", "tint",
            "diffuseColor", "emissiveColor", "specularColor", "shininess", "lit", "params", "time", "shadow",
        ]);
        expect(fieldsOf(BASIC_LIT.code, "SurfaceLight")).toEqual(["toLight", "color", "attenuation"]);
        for (const helper of [
            "fn lightDiffuse(input: SurfaceInput) -> vec3f",
            "fn lightSpecular(input: SurfaceInput) -> vec3f",
            "fn sceneIsLit() -> bool",
            "fn ambientLight() -> vec3f",
            "fn sceneLightCount() -> u32",
            "fn sceneLight(index: u32, viewPosition: vec3f) -> SurfaceLight",
            "fn lightSums(normal: vec3f, viewPosition: vec3f, specular: bool) -> LightSums",
            "fn shadowVisibility(normal: vec3f, viewPosition: vec3f) -> f32",
            "fn shadowedLightIndex() -> u32",
            "fn lightShadow(index: u32, input: SurfaceInput) -> f32",
        ]) expect(BASIC_LIT.code.includes(helper)).toBe(true);
        expect(BASIC_LIT.code.includes("let light = sceneLight(i, viewPosition);")).toBe(true);
    });

    test("the shadow storage lists a 16-byte header then the map records, each field at the offset the packing writes, 16-byte aligned", () => {
        expect(fieldsOf(BASIC_LIT.code, "Shadows")).toEqual(["primaryLightIndex", "mapCount", "reserved0", "reserved1", "maps"]);
        expect(BASIC_LIT.code.includes("    maps: array<ShadowMap>,\n}")).toBe(true);
        expect([SHADOWS_PRIMARY_LIGHT_OFFSET, SHADOWS_MAP_COUNT_OFFSET, SHADOWS_HEADER_FLOATS]).toEqual([0, 1, VEC4_FLOATS]);
        expect(fieldsOf(BASIC_LIT.code, "ShadowMap")).toEqual([
            "viewToLight", "projection", "layer", "depthBias", "normalOffset", "filterStep", "strength", "fadeStart", "fadeInverseLength",
            "depthScale", "depthOffset", "reserved0", "reserved1",
        ]);
        expect([
            SHADOW_MAP_VIEW_TO_LIGHT_OFFSET, SHADOW_MAP_PROJECTION_OFFSET, SHADOW_MAP_LAYER_OFFSET, SHADOW_MAP_DEPTH_BIAS_OFFSET, SHADOW_MAP_NORMAL_OFFSET_OFFSET,
            SHADOW_MAP_FILTER_STEP_OFFSET, SHADOW_MAP_STRENGTH_OFFSET, SHADOW_MAP_FADE_START_OFFSET, SHADOW_MAP_FADE_INVERSE_LENGTH_OFFSET,
            SHADOW_MAP_DEPTH_SCALE_OFFSET, SHADOW_MAP_DEPTH_OFFSET_OFFSET,
        ]).toEqual([0, ...Array.from({length: 10}, (_, field) => MAT4_FLOATS + field)]);
        expect(SHADOW_MAP_STRIDE_FLOATS).toBe(MAT4_FLOATS + 12);
        expect((SHADOW_MAP_STRIDE_FLOATS * FLOAT_BYTES) % UNIFORM_STRUCT_ALIGNMENT_BYTES).toBe(0);
        expect((SHADOWS_HEADER_FLOATS * FLOAT_BYTES) % UNIFORM_STRUCT_ALIGNMENT_BYTES).toBe(0);
    });

    test("each light's shadow map slot rides in kindRangeSquared.z, after its kind and range", () => {
        expect([LIGHT_KIND_OFFSET + 1, LIGHT_KIND_OFFSET + 2]).toEqual([LIGHT_RANGE_SQUARED_OFFSET, LIGHT_SHADOW_MAP_OFFSET]);
        const code = BASIC_LIT.code;
        expect(code.includes("let slot = sceneLights.lights[index].kindRangeSquared.z;\n    if (slot == NO_SHADOW_MAP_SLOT) {\n        return FULLY_LIT;\n    }")).toBe(true);
        expect(code.includes("let map = sceneShadows.maps[u32(slot)];")).toBe(true);
        expect(code.includes(`const NO_SHADOW_MAP_SLOT: f32 = ${wgslFloat(NO_SHADOW_MAP_SLOT)};`)).toBe(true);
    });

    test("the shadow constants come from the TypeScript side and every map kind filters with the same square PCF kernel", () => {
        const code = BASIC_LIT.code;
        expect(code.includes(`const NO_SHADOWED_LIGHT: u32 = ${NO_SHADOWED_LIGHT}u;`)).toBe(true);
        expect(code.includes(`const SHADOW_PROJECTION_PERSPECTIVE: u32 = ${SHADOW_PROJECTION_PERSPECTIVE}u;`)).toBe(true);
        expect(code.includes(`const SHADOW_PROJECTION_CUBE: u32 = ${SHADOW_PROJECTION_CUBE}u;`)).toBe(true);
        expect(code.includes(`const FULLY_LIT: f32 = ${wgslFloat(FULLY_LIT)};`)).toBe(true);
        expect(code.includes(`const SHADOW_MAP_FARTHEST_DEPTH: f32 = ${wgslFloat(SHADOW_MAP_FARTHEST_DEPTH)};`)).toBe(true);
        expect(code.includes(`const SHADOW_PCF_REACH_TAPS: i32 = ${SHADOW_PCF_REACH_TAPS};`)).toBe(true);
        expect(code.includes(`const SHADOW_PCF_TAPS: f32 = ${wgslFloat(SHADOW_PCF_TAPS)};`)).toBe(true);
        expect(SHADOW_PCF_TAPS).toBe((SHADOW_PCF_REACH_TAPS * 2 + 1) ** 2);
        expect(occurrences(code, "for (var y = -SHADOW_PCF_REACH_TAPS; y <= SHADOW_PCF_REACH_TAPS; y++)")).toBe(2);
        expect(occurrences(code, "for (var x = -SHADOW_PCF_REACH_TAPS; x <= SHADOW_PCF_REACH_TAPS; x++)")).toBe(2);
        expect(code.includes("textureSampleCompareLevel(maps, sceneShadowSampler, tap, layer, depth)")).toBe(true);
        expect(code.includes("textureSampleCompareLevel(pointShadowMaps, sceneShadowSampler, tap, map.layer, depth)")).toBe(true);
        expect(code.includes("filteredShadow(directionalShadowMaps, uv, map.layer, depth, map.filterStep)")).toBe(true);
        expect(code.includes("filteredShadow(spotShadowMaps, uv, map.layer, depth, map.filterStep)")).toBe(true);
    });

    test("each map kind has its own lookup: directional fades and offsets in view units, spot and point offset and bias by the distance to the light", () => {
        const code = BASIC_LIT.code;
        const dispatch = functionBody(code, "fn lightShadowAt(");
        expect(dispatch.indexOf("return pointShadow(map, normal, viewPosition);")).toBeGreaterThan(dispatch.indexOf("if (map.projection == SHADOW_PROJECTION_CUBE) {"));
        expect(dispatch.indexOf("return spotShadow(map, normal, viewPosition);")).toBeGreaterThan(dispatch.indexOf("if (map.projection == SHADOW_PROJECTION_PERSPECTIVE) {"));
        expect(dispatch.includes("return directionalShadow(map, normal, viewPosition);")).toBe(true);
        const directional = functionBody(code, "fn directionalShadow(");
        expect(directional.includes("let fade = saturate((viewPosition.z - map.fadeStart) * map.fadeInverseLength);")).toBe(true);
        expect(directional.includes("map.viewToLight * vec4f(viewPosition + normal * map.normalOffset, 1.0)")).toBe(true);
        expect(directional.includes("let depth = lightClip.z - map.depthBias;")).toBe(true);
        const spot = functionBody(code, "fn spotShadow(");
        expect(spot.includes("map.viewToLight * vec4f(normal * (map.normalOffset * centre.w), 0.0)")).toBe(true);
        expect(spot.includes("let depth = perspectiveShadowDepth(map, lightClip.w);")).toBe(true);
        expect(code.includes("return map.depthScale + map.depthOffset / (lightDistance * (FULLY_LIT - map.depthBias));")).toBe(true);
        const point = functionBody(code, "fn pointShadow(");
        expect(point.includes("let reach = majorAxisLength(centre);")).toBe(true);
        expect(point.includes("map.viewToLight * vec4f(normal * (map.normalOffset * reach), 0.0)")).toBe(true);
        expect(point.includes("let depth = perspectiveShadowDepth(map, surfaceReach);")).toBe(true);
        expect(point.includes("let tapSpacing = map.filterStep * surfaceReach;")).toBe(true);
    });

    test("every light's diffuse and highlight are scaled by its own shadow, the primary directional's comes from the surface input, and shadows off sample nothing", () => {
        const code = BASIC_LIT.code;
        const visibility = functionBody(code, "fn shadowVisibility(");
        expect(visibility.includes("if (index == NO_SHADOWED_LIGHT) {\n        return FULLY_LIT;\n    }")).toBe(true);
        expect(code.includes("if (i == shadowedLightIndex()) {\n                color *= shadow;\n            } else {\n                color *= lightShadowAt(i, normal, viewPosition);\n            }")).toBe(true);
        expect(code.includes("sums.diffuse += color * diffuse;")).toBe(true);
        expect(code.includes("let lobe = specularLobe(i, viewPosition, reflection, light);\n                sums.specular += color * highlight(normal, lobe.toLight, toCamera) * lobe.attenuation;")).toBe(true);
        expect(code.includes("surfaceInput.shadow = shadowVisibility(surfaceInput.viewNormal, input.viewPosition);\n    surfaceInput.lit = litColor(surfaceInput);")).toBe(true);
        expect(code.includes("let sums = shadowedLightSums(input.viewNormal, input.viewPosition, specular, input.shadow);")).toBe(true);
        expect(functionBody(code, "fn shadowedLightIndex(").includes("return sceneShadows.primaryLightIndex;")).toBe(true);
        const lightShadow = functionBody(code, "fn lightShadow(");
        expect(lightShadow.includes("if (index == shadowedLightIndex()) {\n        return input.shadow;\n    }\n    return lightShadowAt(index, input.viewNormal, input.viewPosition);")).toBe(true);
        expect(NO_SHADOWED_LIGHT).toBe(0xFFFFFFFF);
    });

    test("the shadow caster shader declares its layout's binding and reads the position and model columns at the lit layout's locations and strides", () => {
        const code = SHADOW_CASTER_WGSL;
        for (const binding of bindingsOf(SHADOW_CASTER_BIND_GROUP_LAYOUT)) expect(code.includes(`@group(${SHADOW_CASTER_BIND_GROUP}) @binding(${binding})`)).toBe(true);
        expect(bindingsOf(SHADOW_CASTER_BIND_GROUP_LAYOUT)).toEqual([SHADOW_CASTER_UNIFORMS_BINDING]);
        const casterUniforms = [...SHADOW_CASTER_BIND_GROUP_LAYOUT.entries][0].buffer!;
        expect([casterUniforms.type, casterUniforms.hasDynamicOffset, casterUniforms.minBindingSize]).toEqual(["uniform", true, SHADOW_CASTER_UNIFORM_BYTES]);
        expect([SHADOW_CASTER_UNIFORM_BYTES, SHADOW_CASTER_UNIFORM_STRIDE_BYTES]).toEqual([MAT4_FLOATS * FLOAT_BYTES, 256]);
        expect(fieldsOf(code, "ShadowCaster")).toEqual(["worldToLightClip"]);
        const locations = SHADOW_CASTER_VERTEX_BUFFERS.flatMap(buffer => [...buffer.attributes].map(attribute => attribute.shaderLocation));
        expect(locations).toEqual([POSITION_LOCATION, INSTANCE_MATRIX_FIRST_LOCATION, INSTANCE_MATRIX_FIRST_LOCATION + 1, INSTANCE_MATRIX_FIRST_LOCATION + 2, INSTANCE_MATRIX_FIRST_LOCATION + 3]);
        for (const location of locations) expect(code.includes(`@location(${location})`)).toBe(true);
        expect(SHADOW_CASTER_VERTEX_BUFFERS.map(buffer => [buffer.arrayStride, buffer.stepMode])).toEqual(BASIC_LIT_VERTEX_BUFFERS.map(buffer => [buffer.arrayStride, buffer.stepMode]));
        const litAttributes = BASIC_LIT_VERTEX_BUFFERS.flatMap(buffer => [...buffer.attributes]);
        for (const attribute of SHADOW_CASTER_VERTEX_BUFFERS.flatMap(buffer => [...buffer.attributes])) {
            expect(litAttributes.find(lit => lit.shaderLocation === attribute.shaderLocation)).toEqual(attribute);
        }
        expect(code.includes(`fn ${SHADOW_CASTER_VERTEX_ENTRY_POINT}(input: CasterVertex) -> @builtin(position) vec4f`)).toBe(true);
        expect(code.includes("return shadowCaster.worldToLightClip * (model * vec4f(input.position, 1.0));")).toBe(true);
        expect(code.includes("${")).toBe(false);
    });

    test("the overlay shader declares its layout's bindings", () => {
        for (const binding of bindingsOf(OVERLAY_BIND_GROUP_LAYOUT)) expect(OVERLAY.code.includes(`@group(${OVERLAY_BIND_GROUP}) @binding(${binding})`)).toBe(true);
        expect(bindingsOf(OVERLAY_BIND_GROUP_LAYOUT)).toEqual([OVERLAY_SAMPLER_BINDING, OVERLAY_TEXTURE_BINDING]);
    });

    test("the lit shader clamps to the display range and writes its result unchanged unless the HDR override is set", () => {
        const code = BASIC_LIT.code;
        expect(code.includes(`override ${HDR_SCENE_OUTPUT_OVERRIDE}: bool = false;`)).toBe(true);
        expect(code.includes(COLOR_SPACE_WGSL)).toBe(true);
        expect(code.includes(`const LARGEST_HDR_SCENE_VALUE: f32 = ${wgslFloat(LARGEST_HDR_SCENE_VALUE)};`)).toBe(true);
        expect(code.includes(`fn sceneRange(rgb: vec3f) -> vec3f {\n    if (${HDR_SCENE_OUTPUT_OVERRIDE}) {\n        return rgb;\n    }\n    return saturate(rgb);\n}`)).toBe(true);
        expect(code.includes(`fn sceneOutput(color: vec4f) -> vec4f {\n    if (${HDR_SCENE_OUTPUT_OVERRIDE}) {\n`
            + "        return vec4f(min(displayToLinear(max(color.rgb, vec3f(0.0))), vec3f(LARGEST_HDR_SCENE_VALUE)), color.a);\n    }\n    return color;\n}")).toBe(true);
        expect(code.includes("rgb = sceneRange(sums.diffuse * albedo + input.emissiveColor * input.tint.rgb);")).toBe(true);
        expect(code.includes("saturate(sums.diffuse")).toBe(false);
        const toon = assembleSurfaceShader("toon", TOON_SOURCE);
        expect(toon.code.includes(`override ${HDR_SCENE_OUTPUT_OVERRIDE}: bool = false;`) && toon.code.includes("return sceneOutput(surface(surfaceInput));")).toBe(true);
    });

    test("the colour space snippet takes the sRGB transfer constants from the TypeScript side", () => {
        for (const [name, value] of [
            ["SRGB_ENCODED_LINEAR_LIMIT", SRGB_ENCODED_LINEAR_LIMIT], ["SRGB_LINEAR_LIMIT", SRGB_LINEAR_LIMIT], ["SRGB_LINEAR_SLOPE", SRGB_LINEAR_SLOPE],
            ["SRGB_GAMMA", SRGB_GAMMA], ["SRGB_OFFSET", SRGB_OFFSET], ["SRGB_SCALE", SRGB_SCALE],
        ] as const) expect(COLOR_SPACE_WGSL.includes(`const ${name}: f32 = ${wgslFloat(value)};`)).toBe(true);
        expect(COLOR_SPACE_WGSL.includes("let high = pow((encoded + SRGB_OFFSET) / SRGB_SCALE, vec3f(SRGB_GAMMA));")).toBe(true);
        expect(COLOR_SPACE_WGSL.includes("return select(high, low, encoded <= vec3f(SRGB_ENCODED_LINEAR_LIMIT));")).toBe(true);
        expect(COLOR_SPACE_WGSL.includes("let high = SRGB_SCALE * pow(linear, vec3f(1.0 / SRGB_GAMMA)) - SRGB_OFFSET;")).toBe(true);
        expect(COLOR_SPACE_WGSL.includes("return select(high, low, linear <= vec3f(SRGB_LINEAR_LIMIT));")).toBe(true);
        expect(COLOR_SPACE_WGSL.includes("${")).toBe(false);
    });

    test("the post-process shader declares its layouts' bindings, its entry points and its pipeline overrides", () => {
        const code = POST_PROCESS_WGSL;
        expect(bindingsOf(BLOOM_BIND_GROUP_LAYOUT)).toEqual([POST_SAMPLER_BINDING, POST_SOURCE_BINDING, POST_UNIFORMS_BINDING]);
        expect(bindingsOf(COMPOSITE_BIND_GROUP_LAYOUT)).toEqual([POST_SAMPLER_BINDING, POST_SOURCE_BINDING, POST_UNIFORMS_BINDING, POST_BLOOM_BINDING]);
        for (const binding of bindingsOf(COMPOSITE_BIND_GROUP_LAYOUT)) expect(code.includes(`@group(${POST_PROCESS_BIND_GROUP}) @binding(${binding})`)).toBe(true);
        expect(code.includes(`@binding(${POST_SOURCE_BINDING}) var postSource: texture_2d<f32>;`)).toBe(true);
        expect(code.includes(`@binding(${POST_BLOOM_BINDING}) var postBloom: texture_2d<f32>;`)).toBe(true);
        expect([...COMPOSITE_BIND_GROUP_LAYOUT.entries].map(entry => [entry.visibility, entry.sampler?.type, entry.texture?.sampleType, entry.buffer?.type])).toEqual([
            [GPU_SHADER_STAGE.FRAGMENT, "filtering", undefined, undefined],
            [GPU_SHADER_STAGE.FRAGMENT, undefined, "float", undefined],
            [GPU_SHADER_STAGE.FRAGMENT, undefined, undefined, "uniform"],
            [GPU_SHADER_STAGE.FRAGMENT, undefined, "float", undefined],
        ]);
        expect(code.includes(`@vertex\nfn ${FULL_SCREEN_VERTEX_ENTRY_POINT}(@builtin(vertex_index) index: u32) -> FullScreenVertex`)).toBe(true);
        for (const entryPoint of [BLOOM_DOWNSAMPLE_ENTRY_POINT, BLOOM_UPSAMPLE_ENTRY_POINT, COMPOSITE_ENTRY_POINT]) {
            expect(code.includes(`@fragment\nfn ${entryPoint}(input: FullScreenVertex) -> @location(0) vec4f`)).toBe(true);
        }
        expect(code.includes(`override ${BLOOM_PREFILTER_OVERRIDE}: bool = false;`)).toBe(true);
        expect(code.includes(`override ${TONE_MAPPING_OVERRIDE}: u32 = ACES_TONE_MAPPING_ID;`)).toBe(true);
        expect(code.includes(`override ${ENCODE_SRGB_OUTPUT_OVERRIDE}: bool = true;`)).toBe(true);
        expect(code.includes(COLOR_SPACE_WGSL)).toBe(true);
        expect(code.includes("${")).toBe(false);
    });

    test("the post-process uniforms list their fields in the order the packing offsets assume, 16-byte aligned", () => {
        expect(fieldsOf(POST_PROCESS_WGSL, "PostProcess")).toEqual(["exposure", "bloomIntensity", "bloomThreshold", "bloomKnee"]);
        expect([POST_EXPOSURE_OFFSET, POST_BLOOM_INTENSITY_OFFSET, POST_BLOOM_THRESHOLD_OFFSET, POST_BLOOM_KNEE_OFFSET]).toEqual([0, 1, 2, 3]);
        expect((POST_PROCESS_UNIFORM_FLOATS * FLOAT_BYTES) % UNIFORM_STRUCT_ALIGNMENT_BYTES).toBe(0);
    });

    test("the post-process shader takes its tone-map and filter constants from the TypeScript side", () => {
        const code = POST_PROCESS_WGSL;
        for (const [name, value] of [
            ["ACES_A", ACES_A], ["ACES_B", ACES_B], ["ACES_C", ACES_C], ["ACES_D", ACES_D], ["ACES_E", ACES_E],
            ["AGX_MIN_EV", AGX_MIN_EV], ["AGX_MAX_EV", AGX_MAX_EV], ["AGX_SMALLEST_INPUT", AGX_SMALLEST_INPUT], ["AGX_DISPLAY_GAMMA", AGX_DISPLAY_GAMMA],
            ["DOWNSAMPLE_OUTER_REACH_TEXELS", DOWNSAMPLE_OUTER_REACH_TEXELS], ["DOWNSAMPLE_INNER_REACH_TEXELS", DOWNSAMPLE_INNER_REACH_TEXELS],
            ["DOWNSAMPLE_CENTRE_WEIGHT", DOWNSAMPLE_CENTRE_WEIGHT], ["DOWNSAMPLE_CORNER_WEIGHT", DOWNSAMPLE_CORNER_WEIGHT], ["BOX_AVERAGE", BOX_AVERAGE],
            ["TENT_REACH_TEXELS", TENT_REACH_TEXELS], ["TENT_CENTRE_WEIGHT", TENT_CENTRE_WEIGHT], ["TENT_EDGE_WEIGHT", TENT_EDGE_WEIGHT],
            ["TENT_CORNER_WEIGHT", TENT_CORNER_WEIGHT], ["TENT_TOTAL_WEIGHT", TENT_TOTAL_WEIGHT],
        ] as const) expect(code.includes(`const ${name}: f32 = ${wgslFloat(value)};`)).toBe(true);
        AGX_CURVE_COEFFICIENTS.forEach((coefficient, power) => expect(code.includes(`const AGX_CURVE_${power}: f32 = ${wgslFloat(coefficient)};`)).toBe(true));
        expect(code.includes(`const AGX_INSET: mat3x3f = mat3x3f(${AGX_INSET_COLUMNS.map(wgslFloat).join(", ")});`)).toBe(true);
        expect(code.includes(`const AGX_OUTSET: mat3x3f = mat3x3f(${AGX_OUTSET_COLUMNS.map(wgslFloat).join(", ")});`)).toBe(true);
        expect(code.includes(`const LUMA_WEIGHTS: vec3f = vec3f(${LUMA_WEIGHTS.map(wgslFloat).join(", ")});`)).toBe(true);
        expect(code.includes(`const ACES_TONE_MAPPING_ID: u32 = ${ACES_TONE_MAPPING_ID}u;`)).toBe(true);
        expect(code.includes(`const AGX_TONE_MAPPING_ID: u32 = ${AGX_TONE_MAPPING_ID}u;`)).toBe(true);
        expect(code.includes(`const REINHARD_TONE_MAPPING_ID: u32 = ${REINHARD_TONE_MAPPING_ID}u;`)).toBe(true);
        expect(DOWNSAMPLE_CENTRE_WEIGHT + DOWNSAMPLE_CORNER_WEIGHT * SIDES).toBe(1);
        expect(TENT_CENTRE_WEIGHT + TENT_EDGE_WEIGHT * SIDES + TENT_CORNER_WEIGHT * SIDES).toBe(TENT_TOTAL_WEIGHT);
    });

    test("the bloom downsample takes 13 taps in five boxes, Karis-weighted and thresholded only when prefiltering; the upsample is a 3x3 tent", () => {
        const code = POST_PROCESS_WGSL;
        const downsample = functionBody(code, `fn ${BLOOM_DOWNSAMPLE_ENTRY_POINT}(`);
        expect(occurrences(downsample, "bloomTap(uv, texel,")).toBe(DOWNSAMPLE_TAPS);
        expect(occurrences(downsample, ") * BOX_AVERAGE;")).toBe(DOWNSAMPLE_BOXES);
        const prefilterBranch = downsample.slice(downsample.indexOf(`if (${BLOOM_PREFILTER_OVERRIDE}) {`), downsample.lastIndexOf("    return vec4f(centre"));
        expect(occurrences(prefilterBranch, "karisWeight(")).toBe(DOWNSAMPLE_BOXES);
        expect(prefilterBranch.includes("return vec4f(prefiltered(weighted / totalWeight), 1.0);")).toBe(true);
        expect(downsample.includes("return vec4f(centre * DOWNSAMPLE_CENTRE_WEIGHT + (topLeft + topRight + bottomLeft + bottomRight) * DOWNSAMPLE_CORNER_WEIGHT, 1.0);")).toBe(true);
        const upsample = functionBody(code, `fn ${BLOOM_UPSAMPLE_ENTRY_POINT}(`);
        expect(occurrences(upsample, "bloomTap(uv, texel,")).toBe(TENT_TAPS);
        expect(upsample.includes("(centre * TENT_CENTRE_WEIGHT + edges * TENT_EDGE_WEIGHT + corners * TENT_CORNER_WEIGHT) / TENT_TOTAL_WEIGHT")).toBe(true);
        expect(code.includes("return 1.0 / (1.0 + dot(rgb, LUMA_WEIGHTS));")).toBe(true);
    });

    test("the composite adds the bloom to the scene, exposes, tone maps by the override and encodes to sRGB unless the canvas does", () => {
        const composite = functionBody(POST_PROCESS_WGSL, `fn ${COMPOSITE_ENTRY_POINT}(`);
        expect(composite.includes("let mapped = toneMap(max((scene + bloom * post.bloomIntensity) * post.exposure, vec3f(0.0)));")).toBe(true);
        expect(composite.includes(`if (${ENCODE_SRGB_OUTPUT_OVERRIDE}) {\n        return vec4f(linearToDisplay(mapped), 1.0);\n    }\n    return vec4f(mapped, 1.0);`)).toBe(true);
        const toneMap = functionBody(POST_PROCESS_WGSL, "fn toneMap(");
        expect(toneMap.includes(`if (${TONE_MAPPING_OVERRIDE} == AGX_TONE_MAPPING_ID) {\n        return agx(rgb);`)).toBe(true);
        expect(toneMap.includes(`if (${TONE_MAPPING_OVERRIDE} == REINHARD_TONE_MAPPING_ID) {\n        return reinhard(rgb);`)).toBe(true);
        expect(toneMap.includes("return acesNarkowicz(rgb);")).toBe(true);
    });

    test("WGSL floats always carry a decimal point", () => {
        expect([wgslFloat(0), wgslFloat(1), wgslFloat(0.5), wgslFloat(1e-12)]).toEqual(["0.0", "1.0", "0.5", "1e-12"]);
    });
});

describe("WGSL light kinds", () => {
    test("each Light field is a vec4 at the offset the packing writes, and the hemisphere gradient is a mat3 between the header counts and the lights", () => {
        const code = BASIC_LIT.code;
        const fields = fieldsOf(code, "Light");
        expect(fields.map((_, index) => index * VEC4_FLOATS)).toEqual([
            LIGHT_VECTOR_OFFSET, LIGHT_COLOR_OFFSET, LIGHT_KIND_OFFSET, LIGHT_DIRECTION_OFFSET, LIGHT_AXIS_X_OFFSET, LIGHT_AXIS_Y_OFFSET, LIGHT_SHAPE_OFFSET,
        ]);
        expect(code.includes(`struct Light {\n${fields.map(field => `    ${field}: vec4f,`).join("\n")}\n}`)).toBe(true);
        expect(LIGHT_STRIDE_FLOATS).toBe(fields.length * VEC4_FLOATS);
        expect(code.includes("    reserved1: u32,\n    hemisphereGradient: mat3x3f,\n    lights: array<Light>,")).toBe(true);
        expect(LIGHTS_HEADER_FLOATS).toBe(LIGHTS_HEMISPHERE_GRADIENT_OFFSET + MAT3_COLUMNS * VEC4_FLOATS);
    });

    test("the shader reads each scalar from the vec4 component the packing writes it to", () => {
        const code = BASIC_LIT.code;
        const component = (offset: number, field: number) => VEC4_COMPONENTS[offset - field];
        const range = `entry.kindRangeSquared.${component(LIGHT_RANGE_SQUARED_OFFSET, LIGHT_KIND_OFFSET)}`;
        const radius = `entry.shape.${component(LIGHT_RADIUS_OFFSET, LIGHT_SHAPE_OFFSET)}`;
        const halfLength = `entry.axisX.${component(LIGHT_EXTENT_X_OFFSET, LIGHT_AXIS_X_OFFSET)}`;
        const halfHeight = `entry.axisY.${component(LIGHT_EXTENT_Y_OFFSET, LIGHT_AXIS_Y_OFFSET)}`;
        expect(functionBody(code, "fn spotLight(").includes(`(alongCone - entry.shape.${component(LIGHT_CONE_COS_OUTER_OFFSET, LIGHT_SHAPE_OFFSET)}) * entry.shape.${component(LIGHT_CONE_SCALE_OFFSET, LIGHT_SHAPE_OFFSET)}`)).toBe(true);
        const capsule = functionBody(code, "fn capsuleLight(");
        expect(capsule.includes(`clamp(-dot(toCentre, entry.axisX.xyz), -${halfLength}, ${halfLength})`)).toBe(true);
        expect(capsule.includes(`max(coreDistance - ${radius}, 0.0)`) && capsule.includes(`surfaceDistance * surfaceDistance, ${range})`)).toBe(true);
        expect(functionBody(code, "fn closestRectPoint(").includes(`clamp(dot(fromCentre, entry.axisY.xyz), -${halfHeight}, ${halfHeight})`)).toBe(true);
        expect(functionBody(code, "fn capsuleSpecular(").includes(`let halfLength = ${halfLength};\n    let radius = ${radius};`)).toBe(true);
        expect(functionBody(code, "fn rectSpecular(").includes(`widenedRoughness(roughness, ${halfHeight}, centreDistance)`)).toBe(true);
    });

    test("the light kinds and the area-light constants come from the TypeScript side", () => {
        const code = BASIC_LIT.code;
        for (const [name, value] of [
            ["LIGHT_KIND_SPOT", LIGHT_KIND_SPOT], ["LIGHT_KIND_SPHERE", LIGHT_KIND_SPHERE], ["LIGHT_KIND_TUBE", LIGHT_KIND_TUBE], ["LIGHT_KIND_RECT", LIGHT_KIND_RECT],
            ["AREA_LIGHT_WIDENING_DIVISOR", AREA_LIGHT_WIDENING_DIVISOR], ["ROUGHNESS_FROM_SHININESS", ROUGHNESS_FROM_SHININESS], ["SMALLEST_ROUGHNESS", SMALLEST_ROUGHNESS],
            ["SMALLEST_LIGHT_DISTANCE", SMALLEST_LIGHT_DISTANCE], ["SMALLEST_SEGMENT_RAY_SPREAD", SMALLEST_SEGMENT_RAY_SPREAD], ["SMALLEST_RAY_PLANE_COSINE", SMALLEST_RAY_PLANE_COSINE],
        ] as const) expect(code.includes(`const ${name}: f32 = ${wgslFloat(value)};`)).toBe(true);
        const kinds = [LIGHT_KIND_DIRECTIONAL, LIGHT_KIND_SPOT, LIGHT_KIND_SPHERE, LIGHT_KIND_TUBE, LIGHT_KIND_RECT];
        expect(new Set(kinds).size).toBe(kinds.length);
    });

    test("sceneLight dispatches every kind with the point light as the fallback, and only area lights move the highlight's representative point", () => {
        const code = BASIC_LIT.code;
        const dispatch = functionBody(code, "fn sceneLight(");
        expect(dispatch.includes("if (kind == LIGHT_KIND_SPOT) {\n        return spotLight(entry, viewPosition);")).toBe(true);
        expect(dispatch.includes("if (kind == LIGHT_KIND_SPHERE || kind == LIGHT_KIND_TUBE) {\n        return capsuleLight(entry, viewPosition);")).toBe(true);
        expect(dispatch.includes("if (kind == LIGHT_KIND_RECT) {\n        return rectLight(entry, viewPosition);")).toBe(true);
        expect(dispatch.trimEnd().endsWith("return pointLight(entry, viewPosition);\n}")).toBe(true);
        const lobe = functionBody(code, "fn specularLobe(");
        expect(lobe.includes("return capsuleSpecular(entry, viewPosition, reflection, light);")).toBe(true);
        expect(lobe.includes("return rectSpecular(entry, viewPosition, reflection, light);")).toBe(true);
        expect(lobe.includes("    }\n    return SpecularLobe(light.toLight, light.attenuation);\n}")).toBe(true);
        expect(code.includes("reflection = reflect(-toCamera, normal);")).toBe(true);
    });

    test("the hemisphere gradient adds to the ambient term and nothing else, so it has no highlight and no shadow", () => {
        const code = BASIC_LIT.code;
        expect(code.includes("var sums = LightSums(ambientLight() + hemisphereLight(normal), vec3f(0.0));")).toBe(true);
        expect(code.includes("return sceneLights.hemisphereGradient * normal;")).toBe(true);
        expect(occurrences(code, "hemisphereLight(")).toBe(2);
    });
});
