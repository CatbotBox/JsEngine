import {describe, expect, test} from "../../../engine/testing/harness";
import {LIGHT_KIND_DIRECTIONAL} from "../../../engine/rendering/3d/lighting/sceneLights";
import {FLOAT_BYTES, LIGHTS_UNLIT} from "../gpuLightPacking";
import {MESH_VERTEX_FLOATS} from "../gpuMeshPacking";
import {INSTANCE_FLOATS} from "../gpuInstanceBatcher";
import {
    ALPHA_TEST_THRESHOLD,
    BASIC_LIT,
    BASIC_LIT_VERTEX_BUFFERS,
    FRAME_BIND_GROUP,
    FRAME_BIND_GROUP_LAYOUT,
    FRAME_UNIFORMS_BINDING,
    HIGHEST_NORMAL_DOT_HALF,
    INSTANCE_MATRIX_FIRST_LOCATION,
    INSTANCE_TINT_LOCATION,
    INSTANCE_VERTEX_BUFFER_SLOT,
    LIGHTS_BINDING,
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
    SMALLEST_HIGHLIGHT_BASE,
    SPECULAR_TEXTURE_MIP_LEVEL,
    UV_LOCATION,
} from "./basicLitShader";
import {OVERLAY, OVERLAY_BIND_GROUP, OVERLAY_BIND_GROUP_LAYOUT, OVERLAY_SAMPLER_BINDING, OVERLAY_TEXTURE_BINDING} from "./overlayShader";
import {wgslFloat} from "./wgsl";

function fieldsOf(code: string, struct: string): string[] {
    const body = new RegExp(`struct ${struct} \\{([^}]*)\\}`).exec(code)?.[1] ?? "";
    return [...body.matchAll(/(\w+):/g)].map(match => match[1]);
}

function bindingsOf(layout: GPUBindGroupLayoutDescriptor): number[] {
    return [...layout.entries].map(entry => entry.binding);
}

describe("WGSL templates", () => {
    test("the lit shader declares the bindings the bind group layouts use", () => {
        const code = BASIC_LIT.code;
        for (const binding of bindingsOf(FRAME_BIND_GROUP_LAYOUT)) expect(code.includes(`@group(${FRAME_BIND_GROUP}) @binding(${binding})`)).toBe(true);
        for (const binding of bindingsOf(MATERIAL_BIND_GROUP_LAYOUT)) expect(code.includes(`@group(${MATERIAL_BIND_GROUP}) @binding(${binding})`)).toBe(true);
        expect(bindingsOf(FRAME_BIND_GROUP_LAYOUT)).toEqual([FRAME_UNIFORMS_BINDING, LIGHTS_BINDING]);
        expect(bindingsOf(MATERIAL_BIND_GROUP_LAYOUT)).toEqual([MATERIAL_UNIFORMS_BINDING, MATERIAL_SAMPLER_BINDING, MATERIAL_TEXTURE_BINDING, MATERIAL_SPECULAR_TEXTURE_BINDING]);
        expect(code.includes(`@binding(${MATERIAL_SPECULAR_TEXTURE_BINDING}) var specularTexture: texture_2d<f32>;`)).toBe(true);
    });

    test("the lit shader reads every vertex attribute the vertex buffer layouts provide, at the same locations and strides", () => {
        const code = BASIC_LIT.code;
        const locations = BASIC_LIT_VERTEX_BUFFERS.flatMap(buffer => [...buffer.attributes].map(attribute => attribute.shaderLocation));
        expect(locations).toEqual([POSITION_LOCATION, NORMAL_LOCATION, UV_LOCATION,
            INSTANCE_MATRIX_FIRST_LOCATION, INSTANCE_MATRIX_FIRST_LOCATION + 1, INSTANCE_MATRIX_FIRST_LOCATION + 2, INSTANCE_MATRIX_FIRST_LOCATION + 3, INSTANCE_TINT_LOCATION]);
        for (const location of locations) expect(code.includes(`@location(${location})`)).toBe(true);
        expect(code.includes(`@location(${INSTANCE_TINT_LOCATION}) tint`)).toBe(true);
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
        expect(code.includes("${")).toBe(false);
    });

    test("uniform structs list their fields in the order the packing offsets assume", () => {
        expect(fieldsOf(BASIC_LIT.code, "Frame")).toEqual(["view", "projection"]);
        expect(fieldsOf(BASIC_LIT.code, "Lights")).toEqual(["ambient", "count", "lit", "reserved0", "reserved1", "lights"]);
        expect(fieldsOf(BASIC_LIT.code, "Light")).toEqual(["vector", "color", "kindRangeSquared"]);
        expect(fieldsOf(BASIC_LIT.code, "Material")).toEqual(["diffuse", "emissive", "specularShininess", "textured", "specularCutoff", "reserved0", "reserved1"]);
    });

    test("the highlight is skipped for materials without specular, gated by the cutoff, and added after the texel multiply", () => {
        const code = BASIC_LIT.code;
        expect(code.includes("let specular = material.specularCutoff <= HIGHEST_NORMAL_DOT_HALF;")).toBe(true);
        expect(code.includes("if (normalDotHalf < material.specularCutoff) {")).toBe(true);
        expect(code.includes("textureSampleLevel(specularTexture, materialSampler, input.uv, SPECULAR_TEXTURE_MIP_LEVEL)")).toBe(true);
        const texelMultiply = code.indexOf("rgb *= texel.rgb;");
        const highlightAdded = code.indexOf("return vec4f(rgb + highlightRgb, 1.0);");
        expect(texelMultiply).toBeGreaterThan(0);
        expect(highlightAdded).toBeGreaterThan(texelMultiply);
    });

    test("the overlay shader declares its layout's bindings", () => {
        for (const binding of bindingsOf(OVERLAY_BIND_GROUP_LAYOUT)) expect(OVERLAY.code.includes(`@group(${OVERLAY_BIND_GROUP}) @binding(${binding})`)).toBe(true);
        expect(bindingsOf(OVERLAY_BIND_GROUP_LAYOUT)).toEqual([OVERLAY_SAMPLER_BINDING, OVERLAY_TEXTURE_BINDING]);
    });

    test("WGSL floats always carry a decimal point", () => {
        expect([wgslFloat(0), wgslFloat(1), wgslFloat(0.5), wgslFloat(1e-12)]).toEqual(["0.0", "1.0", "0.5", "1e-12"]);
    });
});
