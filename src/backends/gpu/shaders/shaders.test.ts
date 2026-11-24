import {describe, expect, test} from "../../../engine/testing/harness";
import {LIGHT_KIND_DIRECTIONAL} from "../../../engine/rendering/3d/lighting/sceneLights";
import {FLOAT_BYTES, LIGHTS_UNLIT} from "../gpuLightPacking";
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
    SHADOW_MAP_BINDING,
    SHADOW_PCF_REACH_TAPS,
    SHADOW_PCF_TAPS,
    SHADOW_SAMPLER_BINDING,
    SHADOW_UNIFORMS_BINDING,
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
    SHADOW_CASTER_UNIFORMS_BINDING,
    SHADOW_CASTER_VERTEX_BUFFERS,
    SHADOW_CASTER_VERTEX_ENTRY_POINT,
    SHADOW_CASTER_WGSL,
} from "./shadowCasterShader";
import {
    FULLY_LIT,
    NO_SHADOWED_LIGHT,
    SHADOW_DEPTH_BIAS_OFFSET,
    SHADOW_ENABLED_OFFSET,
    SHADOW_FADE_INVERSE_LENGTH_OFFSET,
    SHADOW_FADE_START_OFFSET,
    SHADOW_FILTER_STEP_OFFSET,
    SHADOW_LIGHT_INDEX_OFFSET,
    SHADOW_MAP_FARTHEST_DEPTH,
    SHADOW_NORMAL_OFFSET_OFFSET,
    SHADOW_STRENGTH_OFFSET,
    SHADOW_UNIFORM_FLOATS,
    SHADOW_VIEW_TO_LIGHT_CLIP_OFFSET,
    SHADOWS_OFF,
} from "../gpuShadowPacking";
import {MAT4_FLOATS} from "../../../engine/math/mat4Layout";
import {wgslFloat} from "./wgsl";

function fieldsOf(code: string, struct: string): string[] {
    const body = new RegExp(`struct ${struct} \\{([^}]*)\\}`).exec(code)?.[1] ?? "";
    return [...body.matchAll(/(\w+):/g)].map(match => match[1]);
}

function bindingsOf(layout: GPUBindGroupLayoutDescriptor): number[] {
    return [...layout.entries].map(entry => entry.binding);
}

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
        expect(bindingsOf(FRAME_BIND_GROUP_LAYOUT)).toEqual([FRAME_UNIFORMS_BINDING, LIGHTS_BINDING, SHADOW_UNIFORMS_BINDING, SHADOW_MAP_BINDING, SHADOW_SAMPLER_BINDING]);
        expect(code.includes(`@binding(${SHADOW_UNIFORMS_BINDING}) var<uniform> sceneShadow: Shadow;`)).toBe(true);
        expect(code.includes(`@binding(${SHADOW_MAP_BINDING}) var sceneShadowMap: texture_depth_2d;`)).toBe(true);
        expect(code.includes(`@binding(${SHADOW_SAMPLER_BINDING}) var sceneShadowSampler: sampler_comparison;`)).toBe(true);
        const shadowEntries = [...FRAME_BIND_GROUP_LAYOUT.entries].filter(entry => entry.binding >= SHADOW_UNIFORMS_BINDING);
        expect(shadowEntries.map(entry => [entry.visibility, entry.buffer?.type, entry.texture?.sampleType, entry.sampler?.type])).toEqual([
            [GPU_SHADER_STAGE.FRAGMENT, "uniform", undefined, undefined],
            [GPU_SHADER_STAGE.FRAGMENT, undefined, "depth", undefined],
            [GPU_SHADER_STAGE.FRAGMENT, undefined, undefined, "comparison"],
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
        expect(fieldsOf(BASIC_LIT.code, "Lights")).toEqual(["ambient", "count", "lit", "reserved0", "reserved1", "lights"]);
        expect(fieldsOf(BASIC_LIT.code, "Light")).toEqual(["vector", "color", "kindRangeSquared"]);
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
        expect(BASIC_LIT.code.includes("surfaceInput.lit = litColor(surfaceInput);\n    return surface(surfaceInput);")).toBe(true);
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

    test("the shadow uniforms struct lists its fields in the order and at the offsets the packing writes, 16-byte aligned", () => {
        expect(fieldsOf(BASIC_LIT.code, "Shadow")).toEqual([
            "viewToLightClip", "lightIndex", "enabled", "depthBias", "normalOffset", "filterStep", "strength", "fadeStart", "fadeInverseLength",
        ]);
        expect([
            SHADOW_VIEW_TO_LIGHT_CLIP_OFFSET, SHADOW_LIGHT_INDEX_OFFSET, SHADOW_ENABLED_OFFSET, SHADOW_DEPTH_BIAS_OFFSET, SHADOW_NORMAL_OFFSET_OFFSET,
            SHADOW_FILTER_STEP_OFFSET, SHADOW_STRENGTH_OFFSET, SHADOW_FADE_START_OFFSET, SHADOW_FADE_INVERSE_LENGTH_OFFSET,
        ]).toEqual([0, MAT4_FLOATS, MAT4_FLOATS + 1, MAT4_FLOATS + 2, MAT4_FLOATS + 3, MAT4_FLOATS + 4, MAT4_FLOATS + 5, MAT4_FLOATS + 6, MAT4_FLOATS + 7]);
        expect((SHADOW_UNIFORM_FLOATS * FLOAT_BYTES) % UNIFORM_STRUCT_ALIGNMENT_BYTES).toBe(0);
    });

    test("the shadow constants come from the TypeScript side and the PCF kernel is a square of taps around the centre", () => {
        const code = BASIC_LIT.code;
        expect(code.includes(`const SHADOWS_OFF: u32 = ${SHADOWS_OFF}u;`)).toBe(true);
        expect(code.includes(`const FULLY_LIT: f32 = ${wgslFloat(FULLY_LIT)};`)).toBe(true);
        expect(code.includes(`const SHADOW_MAP_FARTHEST_DEPTH: f32 = ${wgslFloat(SHADOW_MAP_FARTHEST_DEPTH)};`)).toBe(true);
        expect(code.includes(`const SHADOW_PCF_REACH_TAPS: i32 = ${SHADOW_PCF_REACH_TAPS};`)).toBe(true);
        expect(code.includes(`const SHADOW_PCF_TAPS: f32 = ${wgslFloat(SHADOW_PCF_TAPS)};`)).toBe(true);
        expect(SHADOW_PCF_TAPS).toBe((SHADOW_PCF_REACH_TAPS * 2 + 1) ** 2);
        expect(code.includes("for (var y = -SHADOW_PCF_REACH_TAPS; y <= SHADOW_PCF_REACH_TAPS; y++)")).toBe(true);
        expect(code.includes("for (var x = -SHADOW_PCF_REACH_TAPS; x <= SHADOW_PCF_REACH_TAPS; x++)")).toBe(true);
        expect(code.includes("textureSampleCompareLevel(sceneShadowMap, sceneShadowSampler, tap, depth)")).toBe(true);
    });

    test("shadows off returns fully lit before sampling, and only the shadowed light's colour is scaled by the shadow", () => {
        const code = BASIC_LIT.code;
        const visibility = code.slice(code.indexOf("fn shadowVisibility("), code.indexOf("fn shadowedLightIndex("));
        const offCheck = visibility.indexOf("if (sceneShadow.enabled == SHADOWS_OFF) {\n        return FULLY_LIT;\n    }");
        expect(offCheck).toBeGreaterThan(0);
        expect(visibility.indexOf("textureSampleCompareLevel")).toBeGreaterThan(offCheck);
        expect(code.includes("if (i == shadowedLightIndex()) {\n                color *= shadow;\n            }")).toBe(true);
        expect(code.includes("sums.diffuse += color * diffuse;")).toBe(true);
        expect(code.includes("sums.specular += color * highlight(normal, light.toLight, toCamera) * light.attenuation;")).toBe(true);
        expect(code.includes("surfaceInput.shadow = shadowVisibility(surfaceInput.viewNormal, input.viewPosition);\n    surfaceInput.lit = litColor(surfaceInput);")).toBe(true);
        expect(code.includes("let sums = shadowedLightSums(input.viewNormal, input.viewPosition, specular, input.shadow);")).toBe(true);
        expect(NO_SHADOWED_LIGHT).toBe(0xFFFFFFFF);
    });

    test("the shadow caster shader declares its layout's binding and reads the position and model columns at the lit layout's locations and strides", () => {
        const code = SHADOW_CASTER_WGSL;
        for (const binding of bindingsOf(SHADOW_CASTER_BIND_GROUP_LAYOUT)) expect(code.includes(`@group(${SHADOW_CASTER_BIND_GROUP}) @binding(${binding})`)).toBe(true);
        expect(bindingsOf(SHADOW_CASTER_BIND_GROUP_LAYOUT)).toEqual([SHADOW_CASTER_UNIFORMS_BINDING]);
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

    test("WGSL floats always carry a decimal point", () => {
        expect([wgslFloat(0), wgslFloat(1), wgslFloat(0.5), wgslFloat(1e-12)]).toEqual(["0.0", "1.0", "0.5", "1e-12"]);
    });
});
