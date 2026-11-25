import {describe, expect, test} from "../../engine/testing/harness";
import {asFloat32Array, Vec} from "../../engine/math/types/vec";
import {Quaternions} from "../../engine/math/quaternions";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import {MAT4_FLOATS} from "../../engine/math/mat4Layout";
import {GpuShadowFit, writeLightBasis} from "./gpuShadowFit";
import {GpuShadowCube, GpuShadowFrustum} from "./gpuShadowFrustum";
import {
    GpuShadowPacking,
    MAX_DISTANCE_BIAS_FRACTION,
    MIN_SHADOW_FADE_LENGTH,
    NO_SHADOWED_LIGHT,
    packCubeShadowMap,
    packDirectionalShadowMap,
    packPerspectiveShadowMap,
    packShadowsOff,
    SHADOW_MAP_DEPTH_BIAS_OFFSET,
    SHADOW_MAP_DEPTH_OFFSET_OFFSET,
    SHADOW_MAP_DEPTH_SCALE_OFFSET,
    SHADOW_MAP_FADE_INVERSE_LENGTH_OFFSET,
    SHADOW_MAP_FADE_START_OFFSET,
    SHADOW_MAP_FILTER_STEP_OFFSET,
    SHADOW_MAP_LAYER_OFFSET,
    SHADOW_MAP_NORMAL_OFFSET_OFFSET,
    SHADOW_MAP_PROJECTION_OFFSET,
    SHADOW_MAP_STRENGTH_OFFSET,
    SHADOW_MAP_STRIDE_FLOATS,
    SHADOW_MAP_VIEW_TO_LIGHT_OFFSET,
    SHADOW_PROJECTION_CUBE,
    SHADOW_PROJECTION_ORTHOGRAPHIC,
    SHADOW_PROJECTION_PERSPECTIVE,
    SHADOWS_HEADER_FLOATS,
    SHADOWS_MAP_COUNT_OFFSET,
    SHADOWS_PRIMARY_LIGHT_OFFSET,
} from "./gpuShadowPacking";
import {
    CUBE_FACES,
    GpuShadowSettings,
    MAX_POINT_SHADOWS,
    MAX_SHADOW_MAP_LAYERS,
    MAX_SHADOW_MAP_SIZE,
    MAX_SHADOWED_LIGHTS,
    MIN_SHADOW_MAP_SIZE,
    NO_SHADOW_MAP,
    pointShadowBudgetOf,
    pointShadowMapSizeOf,
    shadowedLightBudgetOf,
    shadowMapSizeOf,
    spotShadowMapSizeOf,
} from "./gpuShadowSettings";

const MAP_SIZE = 512;
const SPOT_MAP_SIZE = 256;
const POINT_MAP_SIZE = 128;
const MAX_DISTANCE = 40;
const SHADOWED_LIGHT = 2;
const DIGITS = 6;
const DEFAULT_MAP_SIZE = 2048;
const DEFAULT_SPOT_MAP_SIZE = 1024;
const DEFAULT_POINT_MAP_SIZE = 512;
const DEFAULT_SHADOWED_LIGHTS = 6;
const DEFAULT_POINT_SHADOWS = 2;
const FRACTIONAL_MAP_SIZE = 700.4;
const DEPTH_BIAS_TEXELS = 0.75;
const NORMAL_BIAS_TEXELS = 2;
const FILTER_RADIUS_TEXELS = 1.5;
const STRENGTH = 0.6;
const FADE_FRACTION = 0.25;
const CAMERA_SCALE = 4;
const SPOT_TAN_HALF_ANGLE = 0.75;
const NEAR = 0.1;
const FAR = 12;
const LAYER = 3;
const FIRST_MAP = 0;
const SECOND_MAP = 1;
const RECORDS = 2;
const HUGE_DEPTH_BIAS_TEXELS = 1e6;
const VEC3_FLOATS = 3;
const DEPTH_DIGITS = 5;

function fittedShadow(cameraMatrix: Float32Array = asFloat32Array(LocalToWorld.identity())): GpuShadowFit {
    const fit = new GpuShadowFit();
    const view = {cameraMatrix, fieldOfViewRadians: Math.PI / 3, widthPx: 64, heightPx: 48, pixelHeightPerWidth: 1, orthographicDepthRange: 1000};
    expect(fit.fit(view, MAX_DISTANCE, MAP_SIZE, 0.3, -0.9, 0.2)).toBe(true);
    fit.finish(false);
    return fit;
}

function spotFrustum(camera: Float64Array = new Float64Array(asFloat32Array(LocalToWorld.identity()))): GpuShadowFrustum {
    const basis = new Float64Array(VEC3_FLOATS * 3);
    writeLightBasis(basis, 0, -1, 0);
    const frustum = new GpuShadowFrustum();
    frustum.aim(1, 4, 2, basis, SPOT_TAN_HALF_ANGLE, NEAR, FAR, SPOT_MAP_SIZE);
    frustum.finishView(camera);
    return frustum;
}

function pointCube(camera: Float64Array = new Float64Array(asFloat32Array(LocalToWorld.identity()))): GpuShadowCube {
    const cube = new GpuShadowCube();
    cube.aim(1, 4, 2, NEAR, FAR, POINT_MAP_SIZE);
    cube.finishView(camera);
    return cube;
}

function settings(overrides: Partial<GpuShadowSettings> = {}): GpuShadowSettings {
    return Object.assign(new GpuShadowSettings(), {mapSize: MAP_SIZE, maxDistance: MAX_DISTANCE}, overrides);
}

function record(packing: GpuShadowPacking, map: number): Float32Array {
    const start = SHADOWS_HEADER_FLOATS + map * SHADOW_MAP_STRIDE_FLOATS;
    return packing.data.subarray(start, start + SHADOW_MAP_STRIDE_FLOATS);
}

function recordWords(packing: GpuShadowPacking, map: number): Uint32Array {
    const start = SHADOWS_HEADER_FLOATS + map * SHADOW_MAP_STRIDE_FLOATS;
    return packing.words.subarray(start, start + SHADOW_MAP_STRIDE_FLOATS);
}

describe("shadow map packing", () => {
    test("the layout keeps WGSL's 16-byte alignment: a 4-float header, then 28-float records with the matrix first", () => {
        expect(SHADOWS_HEADER_FLOATS).toBe(4);
        expect(SHADOW_MAP_STRIDE_FLOATS).toBe(28);
        expect(SHADOW_MAP_VIEW_TO_LIGHT_OFFSET).toBe(0);
        expect([SHADOW_MAP_PROJECTION_OFFSET, SHADOW_MAP_DEPTH_OFFSET_OFFSET]).toEqual([MAT4_FLOATS, MAT4_FLOATS + 9]);
        expect((SHADOW_MAP_STRIDE_FLOATS * 4) % 16).toBe(0);
    });

    test("off: no primary light, no maps, and one zeroed record so the storage binding is never empty", () => {
        const packing = new GpuShadowPacking();
        packing.data.fill(Number.NaN);
        packShadowsOff(packing);
        expect([packing.words[SHADOWS_PRIMARY_LIGHT_OFFSET], packing.words[SHADOWS_MAP_COUNT_OFFSET]]).toEqual([NO_SHADOWED_LIGHT, 0]);
        expect(packing.usedFloats).toBe(SHADOWS_HEADER_FLOATS + SHADOW_MAP_STRIDE_FLOATS);
        expect(Array.from(record(packing, FIRST_MAP))).toEqual(new Array(SHADOW_MAP_STRIDE_FLOATS).fill(0));
    });

    test("grows to fit more records, and begin clears the records it uses", () => {
        const packing = new GpuShadowPacking();
        packing.begin(RECORDS);
        packing.setPrimaryLight(SHADOWED_LIGHT);
        expect(packing.capacity).toBeGreaterThan(RECORDS - 1);
        expect([packing.words[SHADOWS_PRIMARY_LIGHT_OFFSET], packing.words[SHADOWS_MAP_COUNT_OFFSET]]).toEqual([SHADOWED_LIGHT, RECORDS]);
        expect(packing.usedFloats).toBe(SHADOWS_HEADER_FLOATS + RECORDS * SHADOW_MAP_STRIDE_FLOATS);
    });

    test("directional: the view-to-light matrix, its layer and the biases converted from texels to light depth and view units", () => {
        const fit = fittedShadow();
        const packing = new GpuShadowPacking();
        packing.begin(RECORDS);
        const tuning = settings({depthBiasTexels: DEPTH_BIAS_TEXELS, normalBiasTexels: NORMAL_BIAS_TEXELS, filterRadiusTexels: FILTER_RADIUS_TEXELS, strength: STRENGTH, fadeFraction: FADE_FRACTION});
        packDirectionalShadowMap(packing, SECOND_MAP, fit, tuning, LAYER);
        const map = record(packing, SECOND_MAP), words = recordWords(packing, SECOND_MAP);
        expect(Array.from(map.subarray(SHADOW_MAP_VIEW_TO_LIGHT_OFFSET, SHADOW_MAP_VIEW_TO_LIGHT_OFFSET + MAT4_FLOATS))).toEqual(Array.from(fit.viewToLightClip));
        expect([words[SHADOW_MAP_PROJECTION_OFFSET], words[SHADOW_MAP_LAYER_OFFSET]]).toEqual([SHADOW_PROJECTION_ORTHOGRAPHIC, LAYER]);
        expect(map[SHADOW_MAP_DEPTH_BIAS_OFFSET]).toBeCloseTo(DEPTH_BIAS_TEXELS * fit.texelWorldSize / fit.depthRange, DIGITS);
        expect(map[SHADOW_MAP_NORMAL_OFFSET_OFFSET]).toBeCloseTo(NORMAL_BIAS_TEXELS * fit.texelWorldSize, DIGITS);
        expect(map[SHADOW_MAP_FILTER_STEP_OFFSET]).toBeCloseTo(FILTER_RADIUS_TEXELS / MAP_SIZE, DIGITS);
        expect(map[SHADOW_MAP_STRENGTH_OFFSET]).toBeCloseTo(STRENGTH, DIGITS);
        expect(map[SHADOW_MAP_FADE_START_OFFSET]).toBeCloseTo(MAX_DISTANCE * (1 - FADE_FRACTION), 4);
        expect(map[SHADOW_MAP_FADE_INVERSE_LENGTH_OFFSET]).toBeCloseTo(1 / (MAX_DISTANCE * FADE_FRACTION), DIGITS);
        expect([map[SHADOW_MAP_DEPTH_SCALE_OFFSET], map[SHADOW_MAP_DEPTH_OFFSET_OFFSET]]).toEqual([0, 0]);
        expect(Array.from(record(packing, FIRST_MAP))).toEqual(new Array(SHADOW_MAP_STRIDE_FLOATS).fill(0));
    });

    test("directional: the normal offset is in view units when the camera is scaled", () => {
        const scaled = asFloat32Array(LocalToWorld.fromTRS(LocalToWorld.identity(), Vec.alloc3(), Quaternions.eulerToQuat(Vec.alloc3()), Vec.alloc3(CAMERA_SCALE, CAMERA_SCALE, CAMERA_SCALE)));
        const fit = fittedShadow(scaled);
        const packing = new GpuShadowPacking();
        packing.begin(1);
        packDirectionalShadowMap(packing, FIRST_MAP, fit, settings({normalBiasTexels: 1}), LAYER);
        expect(record(packing, FIRST_MAP)[SHADOW_MAP_NORMAL_OFFSET_OFFSET]).toBeCloseTo(fit.texelWorldSize / CAMERA_SCALE, DIGITS);
    });

    test("directional: out-of-range tuning is clamped: strength to 0..1, negative biases and radius to zero, no fade to a sharp cut at maxDistance", () => {
        const fit = fittedShadow();
        const packing = new GpuShadowPacking();
        packing.begin(1);
        packDirectionalShadowMap(packing, FIRST_MAP, fit, settings({strength: 3, depthBiasTexels: -1, normalBiasTexels: Number.NaN, filterRadiusTexels: -2, fadeFraction: 0}), LAYER);
        const map = record(packing, FIRST_MAP);
        expect(map[SHADOW_MAP_STRENGTH_OFFSET]).toBe(1);
        expect([map[SHADOW_MAP_DEPTH_BIAS_OFFSET], map[SHADOW_MAP_NORMAL_OFFSET_OFFSET], map[SHADOW_MAP_FILTER_STEP_OFFSET]]).toEqual([0, 0, 0]);
        expect(map[SHADOW_MAP_FADE_START_OFFSET]).toBeCloseTo(MAX_DISTANCE - MIN_SHADOW_FADE_LENGTH, 4);
        expect(map[SHADOW_MAP_FADE_INVERSE_LENGTH_OFFSET]).toBeCloseTo(1 / MIN_SHADOW_FADE_LENGTH, 2);
        packDirectionalShadowMap(packing, FIRST_MAP, fit, settings({strength: -0.5}), LAYER);
        expect(map[SHADOW_MAP_STRENGTH_OFFSET]).toBe(0);
    });

    test("spot: the perspective view-to-light matrix, depth from distance, and biases as fractions of the distance to the light", () => {
        const frustum = spotFrustum();
        const packing = new GpuShadowPacking();
        packing.begin(1);
        packPerspectiveShadowMap(packing, FIRST_MAP, frustum, settings({depthBiasTexels: DEPTH_BIAS_TEXELS, normalBiasTexels: NORMAL_BIAS_TEXELS, filterRadiusTexels: FILTER_RADIUS_TEXELS}), LAYER, 1);
        const map = record(packing, FIRST_MAP), words = recordWords(packing, FIRST_MAP);
        const texelSpread = 2 * SPOT_TAN_HALF_ANGLE / SPOT_MAP_SIZE;
        expect(Array.from(map.subarray(0, MAT4_FLOATS))).toEqual(Array.from(frustum.viewToLightClip));
        expect([words[SHADOW_MAP_PROJECTION_OFFSET], words[SHADOW_MAP_LAYER_OFFSET]]).toEqual([SHADOW_PROJECTION_PERSPECTIVE, LAYER]);
        expect(map[SHADOW_MAP_DEPTH_BIAS_OFFSET]).toBeCloseTo(DEPTH_BIAS_TEXELS * texelSpread, DIGITS);
        expect(map[SHADOW_MAP_NORMAL_OFFSET_OFFSET]).toBeCloseTo(NORMAL_BIAS_TEXELS * texelSpread, DIGITS);
        expect(map[SHADOW_MAP_FILTER_STEP_OFFSET]).toBeCloseTo(FILTER_RADIUS_TEXELS / SPOT_MAP_SIZE, DIGITS);
        expect(map[SHADOW_MAP_DEPTH_SCALE_OFFSET]).toBeCloseTo(FAR / (FAR - NEAR), DIGITS);
        expect(map[SHADOW_MAP_DEPTH_OFFSET_OFFSET]).toBeCloseTo(-FAR * NEAR / (FAR - NEAR), DIGITS);
        expect([map[SHADOW_MAP_FADE_START_OFFSET], map[SHADOW_MAP_FADE_INVERSE_LENGTH_OFFSET]]).toEqual([0, 0]);
        const atNear = map[SHADOW_MAP_DEPTH_SCALE_OFFSET] + map[SHADOW_MAP_DEPTH_OFFSET_OFFSET] / NEAR;
        const atFar = map[SHADOW_MAP_DEPTH_SCALE_OFFSET] + map[SHADOW_MAP_DEPTH_OFFSET_OFFSET] / FAR;
        expect(atNear).toBeCloseTo(0, DEPTH_DIGITS);
        expect(atFar).toBeCloseTo(1, DEPTH_DIGITS);
    });

    test("point: the view-to-light-offset matrix, the cube's texel spread for the filter, and a distance bias capped below the distance itself", () => {
        const scale = new Float64Array(asFloat32Array(LocalToWorld.fromTRS(LocalToWorld.identity(), Vec.alloc3(), Quaternions.eulerToQuat(Vec.alloc3()), Vec.alloc3(CAMERA_SCALE, CAMERA_SCALE, CAMERA_SCALE))));
        const cube = pointCube(scale);
        const packing = new GpuShadowPacking();
        packing.begin(1);
        packCubeShadowMap(packing, FIRST_MAP, cube, settings({depthBiasTexels: DEPTH_BIAS_TEXELS, normalBiasTexels: NORMAL_BIAS_TEXELS, filterRadiusTexels: FILTER_RADIUS_TEXELS}), LAYER, 1 / CAMERA_SCALE);
        const map = record(packing, FIRST_MAP), words = recordWords(packing, FIRST_MAP);
        const texelSpread = 2 / POINT_MAP_SIZE;
        expect(Array.from(map.subarray(0, MAT4_FLOATS))).toEqual(Array.from(cube.viewToLightOffset));
        expect([words[SHADOW_MAP_PROJECTION_OFFSET], words[SHADOW_MAP_LAYER_OFFSET]]).toEqual([SHADOW_PROJECTION_CUBE, LAYER]);
        expect(map[SHADOW_MAP_DEPTH_BIAS_OFFSET]).toBeCloseTo(DEPTH_BIAS_TEXELS * texelSpread, DIGITS);
        expect(map[SHADOW_MAP_NORMAL_OFFSET_OFFSET]).toBeCloseTo(NORMAL_BIAS_TEXELS * texelSpread / CAMERA_SCALE, DIGITS);
        expect(map[SHADOW_MAP_FILTER_STEP_OFFSET]).toBeCloseTo(FILTER_RADIUS_TEXELS * texelSpread, DIGITS);
        packCubeShadowMap(packing, FIRST_MAP, cube, settings({depthBiasTexels: HUGE_DEPTH_BIAS_TEXELS}), LAYER, 1);
        expect(map[SHADOW_MAP_DEPTH_BIAS_OFFSET]).toBe(MAX_DISTANCE_BIAS_FRACTION);
    });
});

describe("GpuShadowSettings", () => {
    test("the map sizes default to 2048 directional, 1024 spot and 512 point, round, clamp to the texture limits, and zero, negative or non-finite sizes mean no map", () => {
        const defaults = new GpuShadowSettings();
        expect([shadowMapSizeOf(defaults), spotShadowMapSizeOf(defaults), pointShadowMapSizeOf(defaults)]).toEqual([DEFAULT_MAP_SIZE, DEFAULT_SPOT_MAP_SIZE, DEFAULT_POINT_MAP_SIZE]);
        for (const [sizeOf, key] of [[shadowMapSizeOf, "mapSize"], [spotShadowMapSizeOf, "spotMapSize"], [pointShadowMapSizeOf, "pointMapSize"]] as const) {
            expect(sizeOf(settings({[key]: FRACTIONAL_MAP_SIZE}))).toBe(Math.round(FRACTIONAL_MAP_SIZE));
            expect(sizeOf(settings({[key]: MAX_SHADOW_MAP_SIZE * 4}))).toBe(MAX_SHADOW_MAP_SIZE);
            expect(sizeOf(settings({[key]: 1}))).toBe(MIN_SHADOW_MAP_SIZE);
            for (const size of [0, -DEFAULT_MAP_SIZE, Number.NaN, Number.POSITIVE_INFINITY]) expect(sizeOf(settings({[key]: size}))).toBe(NO_SHADOW_MAP);
        }
    });

    test("the budget defaults to six shadowed lights with at most two cube maps, floors, clamps to the array-layer limits, and the cube budget never exceeds the total", () => {
        const defaults = new GpuShadowSettings();
        expect([shadowedLightBudgetOf(defaults), pointShadowBudgetOf(defaults)]).toEqual([DEFAULT_SHADOWED_LIGHTS, DEFAULT_POINT_SHADOWS]);
        expect([shadowedLightBudgetOf(settings({maxShadowedLights: 2.9})), pointShadowBudgetOf(settings({maxPointShadows: 1.5}))]).toEqual([2, 1]);
        expect(pointShadowBudgetOf(settings({maxShadowedLights: 1, maxPointShadows: 4}))).toBe(1);
        expect([shadowedLightBudgetOf(settings({maxShadowedLights: 1e9})), pointShadowBudgetOf(settings({maxShadowedLights: 1e9, maxPointShadows: 1e9}))])
            .toEqual([MAX_SHADOWED_LIGHTS, MAX_POINT_SHADOWS]);
        for (const count of [0, -1, Number.NaN]) expect([shadowedLightBudgetOf(settings({maxShadowedLights: count})), pointShadowBudgetOf(settings({maxPointShadows: count}))]).toEqual([0, 0]);
    });

    test("the cube limit is the most whole cubes that fit in WebGPU's default array-layer limit", () => {
        expect(MAX_POINT_SHADOWS * CUBE_FACES).toBeLessThan(MAX_SHADOW_MAP_LAYERS + 1);
        expect((MAX_POINT_SHADOWS + 1) * CUBE_FACES).toBeGreaterThan(MAX_SHADOW_MAP_LAYERS);
        expect(MAX_SHADOWED_LIGHTS).toBe(MAX_SHADOW_MAP_LAYERS);
    });
});
