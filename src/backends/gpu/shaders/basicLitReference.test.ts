import {describe, expect, test} from "../../../engine/testing/harness";
import {Vec, Vec4} from "../../../engine/math/types/vec";
import {Quaternions} from "../../../engine/math/quaternions";
import {LocalToWorld} from "../../../engine/translation/localToWorld";
import {Mesh, MeshBuilder} from "../../../engine/rendering/3d/mesh";
import {Material} from "../../../engine/rendering/3d/material";
import {ViewSpaceMesh} from "../../../engine/rendering/3d/viewSpaceMesh";
import {LIGHT_KIND_DIRECTIONAL, SceneLights} from "../../../engine/rendering/3d/lighting/sceneLights";
import {VertexLighting} from "../../../engine/rendering/3d/lighting/vertexLighting";
import {CHANNEL_MASK, CHANNEL_MAX, GREEN_SHIFT, RED_SHIFT, WHITE_RGB} from "../../../engine/rendering/packedRgb";
import {
    GpuLightPacking,
    LIGHT_COLOR_OFFSET,
    LIGHT_KIND_OFFSET,
    LIGHT_RANGE_SQUARED_OFFSET,
    LIGHT_STRIDE_FLOATS,
    LIGHT_VECTOR_OFFSET,
    LIGHTS_AMBIENT_OFFSET,
    LIGHTS_COUNT_OFFSET,
    LIGHTS_HEADER_FLOATS,
    packSceneLights,
} from "../gpuLightPacking";
import {packMaterial} from "../gpuMaterialCache";
import {
    HIGHEST_NORMAL_DOT_HALF,
    MATERIAL_DIFFUSE_OFFSET,
    MATERIAL_EMISSIVE_OFFSET,
    MATERIAL_SHININESS_OFFSET,
    MATERIAL_SPECULAR_CUTOFF_OFFSET,
    MATERIAL_SPECULAR_OFFSET,
    MATERIAL_UNIFORM_FLOATS,
    SMALLEST_HIGHLIGHT_BASE,
} from "./basicLitShader";

type Rgb = [number, number, number];

const DIGITS = 5;
const VERTICES = 3;
const NO_GLOSS: Rgb = [1, 1, 1];
const TINT = 0xE0C0A0;
const MAT3_FLOATS = 9;

function rgbOf(packed: number): Rgb {
    return [((packed >> RED_SHIFT) & CHANNEL_MASK) / CHANNEL_MAX, ((packed >> GREEN_SHIFT) & CHANNEL_MASK) / CHANNEL_MAX, (packed & CHANNEL_MASK) / CHANNEL_MAX];
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function unitOrZero(v: Rgb): Rgb {
    const lengthSquared = dot(v, v);
    return lengthSquared > 0 ? v.map(c => c / Math.sqrt(lengthSquared)) as Rgb : [0, 0, 0];
}

function highlight(normal: Rgb, toLight: Rgb, toCamera: Rgb, material: Float32Array): number {
    const halfway: Rgb = [toLight[0] + toCamera[0], toLight[1] + toCamera[1], toLight[2] + toCamera[2]];
    const halfwayLengthSquared = dot(halfway, halfway);
    if (halfwayLengthSquared === 0) return 0;
    const normalDotHalf = dot(normal, halfway) / Math.sqrt(halfwayLengthSquared);
    if (normalDotHalf < material[MATERIAL_SPECULAR_CUTOFF_OFFSET]) return 0;
    return Math.pow(Math.max(normalDotHalf, SMALLEST_HIGHLIGHT_BASE), material[MATERIAL_SHININESS_OFFSET]);
}

interface FragmentTerms {
    readonly diffuse: Rgb;
    readonly specular: Rgb;
}

function referenceFragment(viewNormal: Rgb, viewPosition: Rgb, lights: GpuLightPacking, material: Float32Array, tint: Rgb, gloss: Rgb): FragmentTerms {
    const data = lights.data;
    const normal = unitOrZero(viewNormal);
    const specular = material[MATERIAL_SPECULAR_CUTOFF_OFFSET] <= HIGHEST_NORMAL_DOT_HALF;
    const toCamera = specular ? unitOrZero([-viewPosition[0], -viewPosition[1], -viewPosition[2]]) : [0, 0, 0] as Rgb;
    const diffuseSum: Rgb = [data[LIGHTS_AMBIENT_OFFSET], data[LIGHTS_AMBIENT_OFFSET + 1], data[LIGHTS_AMBIENT_OFFSET + 2]];
    const specularSum: Rgb = [0, 0, 0];
    for (let i = 0; i < lights.words[LIGHTS_COUNT_OFFSET]; i++) {
        const o = LIGHTS_HEADER_FLOATS + i * LIGHT_STRIDE_FLOATS;
        const vector: Rgb = [data[o + LIGHT_VECTOR_OFFSET], data[o + LIGHT_VECTOR_OFFSET + 1], data[o + LIGHT_VECTOR_OFFSET + 2]];
        const color: Rgb = [data[o + LIGHT_COLOR_OFFSET], data[o + LIGHT_COLOR_OFFSET + 1], data[o + LIGHT_COLOR_OFFSET + 2]];
        let toLight = vector;
        let attenuation = 1;
        if (data[o + LIGHT_KIND_OFFSET] !== LIGHT_KIND_DIRECTIONAL) {
            const offset: Rgb = [vector[0] - viewPosition[0], vector[1] - viewPosition[1], vector[2] - viewPosition[2]];
            const distanceSquared = dot(offset, offset);
            const rangeSquared = data[o + LIGHT_RANGE_SQUARED_OFFSET];
            if (distanceSquared >= rangeSquared || distanceSquared === 0) continue;
            const falloff = 1 - distanceSquared / rangeSquared;
            toLight = offset.map(c => c / Math.sqrt(distanceSquared)) as Rgb;
            attenuation = falloff * falloff;
        }
        const diffuse = dot(normal, toLight) * attenuation;
        if (!(diffuse > 0)) continue;
        const shine = specular ? highlight(normal, toLight, toCamera, material) * attenuation : 0;
        for (let c = 0; c < 3; c++) {
            diffuseSum[c] += color[c] * diffuse;
            specularSum[c] += color[c] * shine;
        }
    }
    return {
        diffuse: [0, 1, 2].map(c => diffuseSum[c] * material[MATERIAL_DIFFUSE_OFFSET + c] * tint[c] + material[MATERIAL_EMISSIVE_OFFSET + c] * tint[c]) as Rgb,
        specular: [0, 1, 2].map(c => specularSum[c] * gloss[c] * material[MATERIAL_SPECULAR_OFFSET + c] * tint[c]) as Rgb,
    };
}

function tiltedTriangle(material: Material): Mesh {
    const builder = new MeshBuilder();
    builder.vertices.push(Vec.alloc3(-1, -1, 0), Vec.alloc3(-1, 1, 0), Vec.alloc3(1, -1, 0));
    builder.triangles.push(Vec.alloc3(0, 1, 2));
    builder.materials.push(material);
    builder.vertexMaterial.push(0, 0, 0);
    builder.generateUvs();
    builder.generateNormals();
    return new Mesh(builder);
}

function material(specularColor: number, shininess: number): Material {
    const result = new Material("reference", 0xC08040);
    result.emissiveColor = 0x101820;
    result.specularColor = specularColor;
    result.shininess = shininess;
    return result;
}

function compareWithSoftware(addLights: (lights: SceneLights) => void, surface: Material): number {
    const sceneLights = new SceneLights();
    sceneLights.beginGather();
    addLights(sceneLights);
    const view = LocalToWorld.identity();
    const model = LocalToWorld.fromTRS(LocalToWorld.identity(), Vec.alloc3(0.5, -0.3, 4), Quaternions.eulerToQuat(Vec.alloc3(0.3, -0.4, 0.1)), Vec.alloc3(1, 1, 1));
    const viewMesh = new ViewSpaceMesh().transformFrom(tiltedTriangle(surface), new Float32Array(Vec.toArray(model)), LocalToWorld.normalMatrix3(model, new Float32Array(MAT3_FLOATS)));

    const software = new VertexLighting();
    software.beginFrame(sceneLights, view);
    const shading = software.shade(viewMesh, TINT);

    const lights = new GpuLightPacking();
    packSceneLights(sceneLights, new Float32Array(Vec.toArray(view)), lights);
    const packedMaterial = new Float32Array(MATERIAL_UNIFORM_FLOATS);
    packMaterial(surface, true, packedMaterial);

    let highlightTotal = 0;
    for (let vertex = 0, j = 0; vertex < VERTICES; vertex++, j += 3) {
        const normal: Rgb = [viewMesh.normals[j], viewMesh.normals[j + 1], viewMesh.normals[j + 2]];
        const position: Rgb = [viewMesh.positions[j], viewMesh.positions[j + 1], viewMesh.positions[j + 2]];
        const gpu = referenceFragment(normal, position, lights, packedMaterial, rgbOf(TINT), NO_GLOSS);
        for (let c = 0; c < 3; c++) {
            expect(gpu.diffuse[c]).toBeCloseTo(shading.diffuseRgb[j + c], DIGITS);
            expect(gpu.specular[c]).toBeCloseTo(shading.specularRgb[j + c], DIGITS);
            highlightTotal += gpu.specular[c];
        }
    }
    return highlightTotal;
}

const sunAndLamp = (lights: SceneLights) => {
    lights.addAmbient(0.1, 0.12, 0.14);
    lights.addDirectional(-0.4, -0.2, 1, 0.9, 0.85, 0.8);
    lights.addPoint(1.5, 0.5, 2, 0.4, 0.6, 1.2, 6);
};
const headLight = (lights: SceneLights) => lights.addDirectional(0, 0, 1, 1, 1, 1);
const lampOutOfRange = (lights: SceneLights) => lights.addPoint(0, 0, -10, 1, 1, 1, 2);
const lightFromBehind = (lights: SceneLights) => lights.addDirectional(0, 0, -1, 1, 1, 1);

describe("the lit shader's lighting maths against the software VertexLighting", () => {
    test("diffuse plus emissive and the Blinn-Phong highlight match per vertex for directional and point lights, tinted", () => {
        expect(compareWithSoftware(sunAndLamp, material(0x8040C0, 24))).toBeGreaterThan(0);
        expect(compareWithSoftware(headLight, material(0x8040C0, 24))).toBeGreaterThan(0);
    });

    test("no specular colour, a light out of range or from behind gives no highlight", () => {
        expect(compareWithSoftware(sunAndLamp, material(0, 24))).toBe(0);
        expect(compareWithSoftware(lampOutOfRange, material(WHITE_RGB, 24))).toBe(0);
        expect(compareWithSoftware(lightFromBehind, material(WHITE_RGB, 24))).toBe(0);
    });

    test("a negligible highlight is cut off, and zero shininess lights every surface facing the light", () => {
        expect(compareWithSoftware(sunAndLamp, material(WHITE_RGB, 1000))).toBe(0);
        expect(compareWithSoftware(sunAndLamp, material(WHITE_RGB, 0))).toBeGreaterThan(0);
    });
});
