import {describe, expect, test} from "../../../engine/testing/harness";
import {Vec} from "../../../engine/math/types/vec";
import {Quaternions} from "../../../engine/math/quaternions";
import {LocalToWorld} from "../../../engine/translation/localToWorld";
import {Mesh, MeshBuilder} from "../../../engine/rendering/3d/mesh";
import {Material} from "../../../engine/rendering/3d/material";
import {ViewSpaceMesh} from "../../../engine/rendering/3d/viewSpaceMesh";
import {
    LIGHT_KIND_DIRECTIONAL,
    LIGHT_KIND_RECT,
    LIGHT_KIND_SPHERE,
    LIGHT_KIND_SPOT,
    LIGHT_KIND_TUBE,
    SceneLights,
} from "../../../engine/rendering/3d/lighting/sceneLights";
import {
    AREA_LIGHT_WIDENING_DIVISOR,
    ROUGHNESS_FROM_SHININESS,
    SMALLEST_LIGHT_DISTANCE,
    SMALLEST_RAY_PLANE_COSINE,
    SMALLEST_ROUGHNESS,
    SMALLEST_SEGMENT_RAY_SPREAD,
} from "../../../engine/rendering/3d/lighting/shapedLights";
import {VertexLighting} from "../../../engine/rendering/3d/lighting/vertexLighting";
import {CHANNEL_MASK, CHANNEL_MAX, GREEN_SHIFT, RED_SHIFT, WHITE_RGB} from "../../../engine/rendering/packedRgb";
import {
    GpuLightPacking,
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
    LIGHT_STRIDE_FLOATS,
    LIGHT_VECTOR_OFFSET,
    LIGHTS_AMBIENT_OFFSET,
    LIGHTS_COUNT_OFFSET,
    LIGHTS_HEADER_FLOATS,
    LIGHTS_HEMISPHERE_GRADIENT_OFFSET,
    MAT3_COLUMNS,
    packSceneLights,
    VEC4_FLOATS,
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

interface ReferenceLight {
    readonly toLight: Rgb;
    readonly attenuation: number;
}

const DIGITS = 5;
const VERTICES = 3;
const NO_GLOSS: Rgb = [1, 1, 1];
const TINT = 0xE0C0A0;
const MAT3_FLOATS = 9;
const ZERO: Rgb = [0, 0, 0];
const UNLIT: ReferenceLight = {toLight: ZERO, attenuation: 0};
const REFLECTION_SCALE = 2;
const SMOOTHSTEP_SQUARE_COEFFICIENT = 3;
const SMOOTHSTEP_CUBE_COEFFICIENT = 2;

function rgbOf(packed: number): Rgb {
    return [((packed >> RED_SHIFT) & CHANNEL_MASK) / CHANNEL_MAX, ((packed >> GREEN_SHIFT) & CHANNEL_MASK) / CHANNEL_MAX, (packed & CHANNEL_MASK) / CHANNEL_MAX];
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function add(a: Rgb, b: Rgb): Rgb {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Rgb, b: Rgb): Rgb {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: Rgb, factor: number): Rgb {
    return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function saturate(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function clamp(value: number, low: number, high: number): number {
    return Math.min(high, Math.max(low, value));
}

function unitOrZero(v: Rgb): Rgb {
    const lengthSquared = dot(v, v);
    return lengthSquared > 0 ? v.map(c => c / Math.sqrt(lengthSquared)) as Rgb : [0, 0, 0];
}

function towardOr(offset: Rgb, fallback: Rgb): Rgb {
    return dot(offset, offset) > 0 ? unitOrZero(offset) : fallback;
}

function vec3At(data: Float32Array, offset: number): Rgb {
    return [data[offset], data[offset + 1], data[offset + 2]];
}

function smoothstep(value: number): number {
    const t = saturate(value);
    return t * t * (SMOOTHSTEP_SQUARE_COEFFICIENT - SMOOTHSTEP_CUBE_COEFFICIENT * t);
}

function rangeFalloff(distanceSquared: number, rangeSquared: number): number {
    if (distanceSquared >= rangeSquared) return 0;
    const falloff = 1 - distanceSquared / rangeSquared;
    return falloff * falloff;
}

function highlight(normal: Rgb, toLight: Rgb, toCamera: Rgb, material: Float32Array): number {
    const halfway: Rgb = [toLight[0] + toCamera[0], toLight[1] + toCamera[1], toLight[2] + toCamera[2]];
    const halfwayLengthSquared = dot(halfway, halfway);
    if (halfwayLengthSquared === 0) return 0;
    const normalDotHalf = dot(normal, halfway) / Math.sqrt(halfwayLengthSquared);
    if (normalDotHalf < material[MATERIAL_SPECULAR_CUTOFF_OFFSET]) return 0;
    return Math.pow(Math.max(normalDotHalf, SMALLEST_HIGHLIGHT_BASE), material[MATERIAL_SHININESS_OFFSET]);
}

function materialRoughness(material: Float32Array): number {
    return Math.max(Math.sqrt(ROUGHNESS_FROM_SHININESS / (Math.max(material[MATERIAL_SHININESS_OFFSET], 0) + ROUGHNESS_FROM_SHININESS)), SMALLEST_ROUGHNESS);
}

function widenedRoughness(roughness: number, halfExtent: number, distance: number): number {
    return saturate(roughness + halfExtent / (AREA_LIGHT_WIDENING_DIVISOR * Math.max(distance, SMALLEST_LIGHT_DISTANCE)));
}

function pointLight(data: Float32Array, o: number, viewPosition: Rgb): ReferenceLight {
    const offset = sub(vec3At(data, o + LIGHT_VECTOR_OFFSET), viewPosition);
    const distanceSquared = dot(offset, offset);
    const rangeSquared = data[o + LIGHT_RANGE_SQUARED_OFFSET];
    if (distanceSquared >= rangeSquared || distanceSquared === 0) return UNLIT;
    const falloff = 1 - distanceSquared / rangeSquared;
    return {toLight: scale(offset, 1 / Math.sqrt(distanceSquared)), attenuation: falloff * falloff};
}

function spotLight(data: Float32Array, o: number, viewPosition: Rgb): ReferenceLight {
    const light = pointLight(data, o, viewPosition);
    const alongCone = -dot(light.toLight, vec3At(data, o + LIGHT_DIRECTION_OFFSET));
    const cone = smoothstep((alongCone - data[o + LIGHT_CONE_COS_OUTER_OFFSET]) * data[o + LIGHT_CONE_SCALE_OFFSET]);
    return {toLight: light.toLight, attenuation: light.attenuation * cone};
}

function capsuleLight(data: Float32Array, o: number, viewPosition: Rgb): ReferenceLight {
    const toCentre = sub(vec3At(data, o + LIGHT_VECTOR_OFFSET), viewPosition);
    const axis = vec3At(data, o + LIGHT_AXIS_X_OFFSET);
    const halfLength = data[o + LIGHT_EXTENT_X_OFFSET];
    const toCore = add(toCentre, scale(axis, clamp(-dot(toCentre, axis), -halfLength, halfLength)));
    const coreDistanceSquared = dot(toCore, toCore);
    if (coreDistanceSquared === 0) return UNLIT;
    const coreDistance = Math.sqrt(coreDistanceSquared);
    const surfaceDistance = Math.max(coreDistance - data[o + LIGHT_RADIUS_OFFSET], 0);
    return {toLight: scale(toCore, 1 / coreDistance), attenuation: rangeFalloff(surfaceDistance * surfaceDistance, data[o + LIGHT_RANGE_SQUARED_OFFSET])};
}

function closestRectPoint(data: Float32Array, o: number, fromCentre: Rgb): Rgb {
    const width = vec3At(data, o + LIGHT_AXIS_X_OFFSET), height = vec3At(data, o + LIGHT_AXIS_Y_OFFSET);
    const halfWidth = data[o + LIGHT_EXTENT_X_OFFSET], halfHeight = data[o + LIGHT_EXTENT_Y_OFFSET];
    return add(scale(width, clamp(dot(fromCentre, width), -halfWidth, halfWidth)), scale(height, clamp(dot(fromCentre, height), -halfHeight, halfHeight)));
}

function rectLight(data: Float32Array, o: number, viewPosition: Rgb): ReferenceLight {
    const fromCentre = sub(viewPosition, vec3At(data, o + LIGHT_VECTOR_OFFSET));
    const normal = vec3At(data, o + LIGHT_DIRECTION_OFFSET);
    if (dot(fromCentre, normal) <= 0) return UNLIT;
    const toClosest = sub(closestRectPoint(data, o, fromCentre), fromCentre);
    const distanceSquared = dot(toClosest, toClosest);
    if (distanceSquared === 0) return UNLIT;
    const toLight = scale(toClosest, 1 / Math.sqrt(distanceSquared));
    const emitterCosine = Math.max(-dot(toLight, normal), 0);
    return {toLight, attenuation: rangeFalloff(distanceSquared, data[o + LIGHT_RANGE_SQUARED_OFFSET]) * emitterCosine};
}

function referenceLight(data: Float32Array, o: number, viewPosition: Rgb): ReferenceLight {
    const kind = data[o + LIGHT_KIND_OFFSET];
    if (kind === LIGHT_KIND_DIRECTIONAL) return {toLight: vec3At(data, o + LIGHT_VECTOR_OFFSET), attenuation: 1};
    if (kind === LIGHT_KIND_SPOT) return spotLight(data, o, viewPosition);
    if (kind === LIGHT_KIND_SPHERE || kind === LIGHT_KIND_TUBE) return capsuleLight(data, o, viewPosition);
    if (kind === LIGHT_KIND_RECT) return rectLight(data, o, viewPosition);
    return pointLight(data, o, viewPosition);
}

function capsuleSpecular(data: Float32Array, o: number, viewPosition: Rgb, reflection: Rgb, light: ReferenceLight, roughness: number): ReferenceLight {
    const toCentre = sub(vec3At(data, o + LIGHT_VECTOR_OFFSET), viewPosition);
    const axis = vec3At(data, o + LIGHT_AXIS_X_OFFSET);
    const halfLength = data[o + LIGHT_EXTENT_X_OFFSET];
    const radius = data[o + LIGHT_RADIUS_OFFSET];
    const start = sub(toCentre, scale(axis, halfLength));
    const span = sub(add(toCentre, scale(axis, halfLength)), start);
    const reflectionDotSpan = dot(reflection, span);
    const spread = Math.max(dot(span, span) - reflectionDotSpan * reflectionDotSpan, SMALLEST_SEGMENT_RAY_SPREAD);
    let nearest = add(start, scale(span, saturate((dot(reflection, start) * reflectionDotSpan - dot(start, span)) / spread)));
    const centreToRay = sub(scale(reflection, dot(nearest, reflection)), nearest);
    const centreToRayLengthSquared = dot(centreToRay, centreToRay);
    if (centreToRayLengthSquared > 0) nearest = add(nearest, scale(centreToRay, saturate(radius / Math.sqrt(centreToRayLengthSquared))));
    const centreDistance = Math.sqrt(dot(toCentre, toCentre));
    const radiusRatio = roughness / widenedRoughness(roughness, radius, centreDistance);
    const lengthRatio = roughness / widenedRoughness(roughness, halfLength, centreDistance);
    return {toLight: towardOr(nearest, light.toLight), attenuation: light.attenuation * radiusRatio * radiusRatio * lengthRatio};
}

function rectSpecular(data: Float32Array, o: number, viewPosition: Rgb, reflection: Rgb, light: ReferenceLight, roughness: number): ReferenceLight {
    const fromCentre = sub(viewPosition, vec3At(data, o + LIGHT_VECTOR_OFFSET));
    const normal = vec3At(data, o + LIGHT_DIRECTION_OFFSET);
    const reach = dot(fromCentre, normal) / Math.max(-dot(reflection, normal), SMALLEST_RAY_PLANE_COSINE);
    const toPoint = sub(closestRectPoint(data, o, add(fromCentre, scale(reflection, reach))), fromCentre);
    const centreDistance = Math.sqrt(dot(fromCentre, fromCentre));
    const widthRatio = roughness / widenedRoughness(roughness, data[o + LIGHT_EXTENT_X_OFFSET], centreDistance);
    const heightRatio = roughness / widenedRoughness(roughness, data[o + LIGHT_EXTENT_Y_OFFSET], centreDistance);
    return {toLight: towardOr(toPoint, light.toLight), attenuation: light.attenuation * widthRatio * heightRatio};
}

function specularLobe(data: Float32Array, o: number, viewPosition: Rgb, reflection: Rgb, light: ReferenceLight, roughness: number): ReferenceLight {
    const kind = data[o + LIGHT_KIND_OFFSET];
    if (kind === LIGHT_KIND_SPHERE || kind === LIGHT_KIND_TUBE) return capsuleSpecular(data, o, viewPosition, reflection, light, roughness);
    if (kind === LIGHT_KIND_RECT) return rectSpecular(data, o, viewPosition, reflection, light, roughness);
    return light;
}

function hemisphereLight(data: Float32Array, normal: Rgb): Rgb {
    const sum: Rgb = [0, 0, 0];
    for (let axis = 0; axis < MAT3_COLUMNS; axis++) {
        const column = vec3At(data, LIGHTS_HEMISPHERE_GRADIENT_OFFSET + axis * VEC4_FLOATS);
        for (let c = 0; c < 3; c++) sum[c] += column[c] * normal[axis];
    }
    return sum;
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
    const reflection = specular ? sub(scale(normal, REFLECTION_SCALE * dot(normal, toCamera)), toCamera) : ZERO;
    const roughness = materialRoughness(material);
    const diffuseSum = add(vec3At(data, LIGHTS_AMBIENT_OFFSET), hemisphereLight(data, normal));
    const specularSum: Rgb = [0, 0, 0];
    for (let i = 0; i < lights.words[LIGHTS_COUNT_OFFSET]; i++) {
        const o = LIGHTS_HEADER_FLOATS + i * LIGHT_STRIDE_FLOATS;
        const color = vec3At(data, o + LIGHT_COLOR_OFFSET);
        const light = referenceLight(data, o, viewPosition);
        const diffuse = dot(normal, light.toLight) * light.attenuation;
        if (!(diffuse > 0)) continue;
        const lobe = specular ? specularLobe(data, o, viewPosition, reflection, light, roughness) : light;
        const shine = specular ? highlight(normal, lobe.toLight, toCamera, material) * lobe.attenuation : 0;
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

interface Totals {
    readonly diffuse: number;
    readonly highlight: number;
}

const IDENTITY_VIEW = LocalToWorld.identity();
const TURNED_VIEW = LocalToWorld.fromTRS(LocalToWorld.identity(), Vec.alloc3(0.4, -0.2, 0.3), Quaternions.eulerToQuat(Vec.alloc3(0.1, 0.25, -0.05)), Vec.alloc3(1, 1, 1));

function compareWithSoftware(addLights: (lights: SceneLights) => void, surface: Material, view = IDENTITY_VIEW): Totals {
    const sceneLights = new SceneLights();
    sceneLights.beginGather();
    addLights(sceneLights);
    const model = LocalToWorld.fromTRS(LocalToWorld.identity(), Vec.alloc3(0.5, -0.3, 4), Quaternions.eulerToQuat(Vec.alloc3(0.3, -0.4, 0.1)), Vec.alloc3(1, 1, 1));
    const modelView = LocalToWorld.mul(view, model);
    const viewMesh = new ViewSpaceMesh().transformFrom(tiltedTriangle(surface), new Float32Array(Vec.toArray(modelView)), LocalToWorld.normalMatrix3(modelView, new Float32Array(MAT3_FLOATS)));

    const software = new VertexLighting();
    software.beginFrame(sceneLights, view);
    const shading = software.shade(viewMesh, TINT);

    const lights = new GpuLightPacking();
    packSceneLights(sceneLights, new Float32Array(Vec.toArray(view)), lights);
    const packedMaterial = new Float32Array(MATERIAL_UNIFORM_FLOATS);
    packMaterial(surface, true, packedMaterial);

    let diffuseTotal = 0;
    let highlightTotal = 0;
    for (let vertex = 0, j = 0; vertex < VERTICES; vertex++, j += 3) {
        const normal: Rgb = [viewMesh.normals[j], viewMesh.normals[j + 1], viewMesh.normals[j + 2]];
        const position: Rgb = [viewMesh.positions[j], viewMesh.positions[j + 1], viewMesh.positions[j + 2]];
        const gpu = referenceFragment(normal, position, lights, packedMaterial, rgbOf(TINT), NO_GLOSS);
        for (let c = 0; c < 3; c++) {
            expect(gpu.diffuse[c]).toBeCloseTo(shading.diffuseRgb[j + c], DIGITS);
            expect(gpu.specular[c]).toBeCloseTo(shading.specularRgb[j + c], DIGITS);
            diffuseTotal += gpu.diffuse[c];
            highlightTotal += gpu.specular[c];
        }
    }
    return {diffuse: diffuseTotal, highlight: highlightTotal};
}

function highlightOf(addLights: (lights: SceneLights) => void, surface: Material, view = IDENTITY_VIEW): number {
    return compareWithSoftware(addLights, surface, view).highlight;
}

const sunAndLamp = (lights: SceneLights) => {
    lights.addAmbient(0.1, 0.12, 0.14);
    lights.addDirectional(-0.4, -0.2, 1, 0.9, 0.85, 0.8);
    lights.addPoint(1.5, 0.5, 2, 0.4, 0.6, 1.2, 6);
};
const headLight = (lights: SceneLights) => lights.addDirectional(0, 0, 1, 1, 1, 1);
const lampOutOfRange = (lights: SceneLights) => lights.addPoint(0, 0, -10, 1, 1, 1, 2);
const lightFromBehind = (lights: SceneLights) => lights.addDirectional(0, 0, -1, 1, 1, 1);

const SPOT_INNER_COS = Math.cos(0.2);
const SPOT_OUTER_COS = Math.cos(0.6);
const spotOnTheTriangle = (lights: SceneLights) => lights.addSpot(0.2, -0.1, 1, 0.1, -0.05, 1, 1.1, 0.9, 0.7, 8, SPOT_INNER_COS, SPOT_OUTER_COS);
const hardEdgedSpot = (lights: SceneLights) => lights.addSpot(0.2, -0.1, 1, 0.1, -0.05, 1, 1, 1, 1, 8, SPOT_OUTER_COS, SPOT_OUTER_COS);
const spotAimedAway = (lights: SceneLights) => lights.addSpot(0.2, -0.1, 1, 0, 0, -1, 1, 1, 1, 8, SPOT_INNER_COS, SPOT_OUTER_COS);
const sphereBulb = (lights: SceneLights) => lights.addSphere(1, 0.5, 2, 0.9, 0.7, 0.5, 6, 0.6);
const fluorescentTube = (lights: SceneLights) => lights.addTube(0, 0.2, 2.5, 1, 0.3, 0, 0.6, 0.9, 1, 6, 1.2, 0.1);
const panel = (lights: SceneLights) => lights.addRect(0.5, -1.5, 2, 0, 0.6, 0.8, 1, 0, 0, 0, 0.8, -0.6, 1, 0.95, 0.9, 7, 0.8, 0.5);
const panelFacingAway = (lights: SceneLights) => lights.addRect(0.5, -1.5, 2, 0, -0.6, -0.8, 1, 0, 0, 0, -0.8, 0.6, 1, 1, 1, 7, 0.8, 0.5);
const skyAndGround = (lights: SceneLights) => lights.addHemisphere(0.2, 1, 0.1, 0.3, 0.4, 0.6, 0.2, 0.1, 0.05);
const everyKind = (lights: SceneLights) => {
    sunAndLamp(lights);
    spotOnTheTriangle(lights);
    sphereBulb(lights);
    fluorescentTube(lights);
    panel(lights);
    skyAndGround(lights);
};

describe("the lit shader's lighting maths against the software VertexLighting", () => {
    test("diffuse plus emissive and the Blinn-Phong highlight match per vertex for directional and point lights, tinted", () => {
        expect(highlightOf(sunAndLamp, material(0x8040C0, 24))).toBeGreaterThan(0);
        expect(highlightOf(headLight, material(0x8040C0, 24))).toBeGreaterThan(0);
    });

    test("no specular colour, a light out of range or from behind gives no highlight", () => {
        expect(highlightOf(sunAndLamp, material(0, 24))).toBe(0);
        expect(highlightOf(lampOutOfRange, material(WHITE_RGB, 24))).toBe(0);
        expect(highlightOf(lightFromBehind, material(WHITE_RGB, 24))).toBe(0);
    });

    test("a negligible highlight is cut off, and zero shininess lights every surface facing the light", () => {
        expect(highlightOf(sunAndLamp, material(WHITE_RGB, 1000))).toBe(0);
        expect(highlightOf(sunAndLamp, material(WHITE_RGB, 0))).toBeGreaterThan(0);
    });
});

describe("the lit shader's spot, area and hemisphere lights against the software VertexLighting", () => {
    test("a spot light matches in its soft penumbra and with a hard edge, and gives nothing when aimed away", () => {
        const soft = compareWithSoftware(spotOnTheTriangle, material(0x8040C0, 24));
        expect(soft.diffuse).toBeGreaterThan(0);
        expect(soft.highlight).toBeGreaterThan(0);
        expect(compareWithSoftware(hardEdgedSpot, material(0x8040C0, 24)).diffuse).toBeGreaterThan(0);
        expect(compareWithSoftware(spotAimedAway, material(0, 24)).diffuse).toBeCloseTo(compareWithSoftware(() => {}, material(0, 24)).diffuse, DIGITS);
    });

    test("sphere and tube lights match, highlight included, at glossy and rough shininess", () => {
        for (const shininess of [8, 64]) {
            expect(highlightOf(sphereBulb, material(WHITE_RGB, shininess))).toBeGreaterThan(0);
            expect(highlightOf(fluorescentTube, material(WHITE_RGB, shininess))).toBeGreaterThan(0);
        }
    });

    test("a rect light matches in front, and lights nothing from behind", () => {
        expect(highlightOf(panel, material(WHITE_RGB, 8))).toBeGreaterThan(0);
        const unlit = compareWithSoftware(() => {}, material(WHITE_RGB, 8));
        const behind = compareWithSoftware(panelFacingAway, material(WHITE_RGB, 8));
        expect(behind.diffuse).toBeCloseTo(unlit.diffuse, DIGITS);
        expect(behind.highlight).toBe(0);
    });

    test("the hemisphere gradient matches and adds no highlight", () => {
        const hemisphere = compareWithSoftware(skyAndGround, material(WHITE_RGB, 8));
        expect(hemisphere.diffuse).toBeGreaterThan(0);
        expect(hemisphere.highlight).toBe(0);
    });

    test("every kind at once matches through a turned and moved camera, whose turn leaves the diffuse light where it was", () => {
        expect(highlightOf(everyKind, material(0x8040C0, 24), TURNED_VIEW)).toBeGreaterThan(0);
        expect(highlightOf(everyKind, material(0, 24), TURNED_VIEW)).toBe(0);
        const straight = compareWithSoftware(everyKind, material(0, 24));
        const turned = compareWithSoftware(everyKind, material(0, 24), TURNED_VIEW);
        expect(turned.diffuse).toBeCloseTo(straight.diffuse, DIGITS);
    });
});
