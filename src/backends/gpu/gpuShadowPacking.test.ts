import {describe, expect, test} from "../../engine/testing/harness";
import {asFloat32Array, Vec} from "../../engine/math/types/vec";
import {Quaternions} from "../../engine/math/quaternions";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import {SceneLights} from "../../engine/rendering/3d/lighting/sceneLights";
import {MAT4_FLOATS} from "../../engine/math/mat4Layout";
import {GpuShadowFit} from "./gpuShadowFit";
import {
    firstDirectionalLightOf,
    GpuShadowUniforms,
    MIN_SHADOW_FADE_LENGTH,
    NO_SHADOWED_LIGHT,
    packShadowsOff,
    packShadowUniforms,
    SHADOW_DEPTH_BIAS_OFFSET,
    SHADOW_ENABLED_OFFSET,
    SHADOW_FADE_INVERSE_LENGTH_OFFSET,
    SHADOW_FADE_START_OFFSET,
    SHADOW_FILTER_STEP_OFFSET,
    SHADOW_LIGHT_INDEX_OFFSET,
    SHADOW_NORMAL_OFFSET_OFFSET,
    SHADOW_STRENGTH_OFFSET,
    SHADOW_UNIFORM_FLOATS,
    SHADOW_VIEW_TO_LIGHT_CLIP_OFFSET,
    SHADOWS_OFF,
    SHADOWS_ON,
} from "./gpuShadowPacking";
import {GpuShadowSettings, MAX_SHADOW_MAP_SIZE, MIN_SHADOW_MAP_SIZE, NO_SHADOW_MAP, shadowMapSizeOf} from "./gpuShadowSettings";

const MAP_SIZE = 512;
const MAX_DISTANCE = 40;
const SHADOWED_LIGHT = 2;
const DIGITS = 6;
const DEFAULT_MAP_SIZE = 2048;
const FRACTIONAL_MAP_SIZE = 700.4;
const DEPTH_BIAS_TEXELS = 0.75;
const NORMAL_BIAS_TEXELS = 2;
const FILTER_RADIUS_TEXELS = 1.5;
const STRENGTH = 0.6;
const FADE_FRACTION = 0.25;
const CAMERA_SCALE = 4;

function fittedShadow(cameraMatrix: Float32Array = asFloat32Array(LocalToWorld.identity())): GpuShadowFit {
    const fit = new GpuShadowFit();
    const view = {cameraMatrix, fieldOfViewRadians: Math.PI / 3, widthPx: 64, heightPx: 48, pixelHeightPerWidth: 1, orthographicDepthRange: 1000};
    expect(fit.fit(view, MAX_DISTANCE, MAP_SIZE, 0.3, -0.9, 0.2)).toBe(true);
    fit.finish(false);
    return fit;
}

function settings(overrides: Partial<GpuShadowSettings> = {}): GpuShadowSettings {
    return Object.assign(new GpuShadowSettings(), {mapSize: MAP_SIZE, maxDistance: MAX_DISTANCE}, overrides);
}

function lightsOf(add: (lights: SceneLights) => void): SceneLights {
    const lights = new SceneLights();
    lights.beginGather();
    add(lights);
    return lights;
}

describe("shadow uniform packing", () => {
    test("off: no shadowed light, the flag off and every other float zero", () => {
        const uniforms = new GpuShadowUniforms();
        uniforms.data.fill(Number.NaN);
        packShadowsOff(uniforms);
        expect(uniforms.words[SHADOW_ENABLED_OFFSET]).toBe(SHADOWS_OFF);
        expect(uniforms.words[SHADOW_LIGHT_INDEX_OFFSET]).toBe(NO_SHADOWED_LIGHT);
        for (let i = 0; i < SHADOW_UNIFORM_FLOATS; i++) {
            if (i === SHADOW_LIGHT_INDEX_OFFSET) continue;
            expect(uniforms.data[i]).toBe(0);
        }
    });

    test("on: the view-to-light matrix, the light index and the biases converted from texels to light depth and view units", () => {
        const fit = fittedShadow();
        const uniforms = new GpuShadowUniforms();
        const tuning = settings({depthBiasTexels: DEPTH_BIAS_TEXELS, normalBiasTexels: NORMAL_BIAS_TEXELS, filterRadiusTexels: FILTER_RADIUS_TEXELS, strength: STRENGTH, fadeFraction: FADE_FRACTION});
        packShadowUniforms(uniforms, fit, tuning, SHADOWED_LIGHT);
        expect(Array.from(uniforms.data.subarray(SHADOW_VIEW_TO_LIGHT_CLIP_OFFSET, SHADOW_VIEW_TO_LIGHT_CLIP_OFFSET + MAT4_FLOATS))).toEqual(Array.from(fit.viewToLightClip));
        expect([uniforms.words[SHADOW_LIGHT_INDEX_OFFSET], uniforms.words[SHADOW_ENABLED_OFFSET]]).toEqual([SHADOWED_LIGHT, SHADOWS_ON]);
        expect(uniforms.data[SHADOW_DEPTH_BIAS_OFFSET]).toBeCloseTo(DEPTH_BIAS_TEXELS * fit.texelWorldSize / fit.depthRange, DIGITS);
        expect(uniforms.data[SHADOW_NORMAL_OFFSET_OFFSET]).toBeCloseTo(NORMAL_BIAS_TEXELS * fit.texelWorldSize, DIGITS);
        expect(uniforms.data[SHADOW_FILTER_STEP_OFFSET]).toBeCloseTo(FILTER_RADIUS_TEXELS / MAP_SIZE, DIGITS);
        expect(uniforms.data[SHADOW_STRENGTH_OFFSET]).toBeCloseTo(STRENGTH, DIGITS);
        expect(uniforms.data[SHADOW_FADE_START_OFFSET]).toBeCloseTo(MAX_DISTANCE * (1 - FADE_FRACTION), 4);
        expect(uniforms.data[SHADOW_FADE_INVERSE_LENGTH_OFFSET]).toBeCloseTo(1 / (MAX_DISTANCE * FADE_FRACTION), DIGITS);
    });

    test("the normal offset is in view units when the camera is scaled", () => {
        const scaled = asFloat32Array(LocalToWorld.fromTRS(LocalToWorld.identity(), Vec.alloc3(), Quaternions.eulerToQuat(Vec.alloc3()), Vec.alloc3(CAMERA_SCALE, CAMERA_SCALE, CAMERA_SCALE)));
        const fit = fittedShadow(scaled);
        const uniforms = new GpuShadowUniforms();
        packShadowUniforms(uniforms, fit, settings({normalBiasTexels: 1}), SHADOWED_LIGHT);
        expect(uniforms.data[SHADOW_NORMAL_OFFSET_OFFSET]).toBeCloseTo(fit.texelWorldSize / CAMERA_SCALE, DIGITS);
    });

    test("out-of-range tuning is clamped: strength to 0..1, negative biases and radius to zero, no fade to a sharp cut at maxDistance", () => {
        const fit = fittedShadow();
        const uniforms = new GpuShadowUniforms();
        packShadowUniforms(uniforms, fit, settings({strength: 3, depthBiasTexels: -1, normalBiasTexels: Number.NaN, filterRadiusTexels: -2, fadeFraction: 0}), SHADOWED_LIGHT);
        expect(uniforms.data[SHADOW_STRENGTH_OFFSET]).toBe(1);
        expect([uniforms.data[SHADOW_DEPTH_BIAS_OFFSET], uniforms.data[SHADOW_NORMAL_OFFSET_OFFSET], uniforms.data[SHADOW_FILTER_STEP_OFFSET]]).toEqual([0, 0, 0]);
        expect(uniforms.data[SHADOW_FADE_START_OFFSET]).toBeCloseTo(MAX_DISTANCE - MIN_SHADOW_FADE_LENGTH, 4);
        expect(uniforms.data[SHADOW_FADE_INVERSE_LENGTH_OFFSET]).toBeCloseTo(1 / MIN_SHADOW_FADE_LENGTH, 2);
        packShadowUniforms(uniforms, fit, settings({strength: -0.5}), SHADOWED_LIGHT);
        expect(uniforms.data[SHADOW_STRENGTH_OFFSET]).toBe(0);
    });
});

describe("the shadowed light", () => {
    test("is the first directional light in gather order, and none without lights or without a directional one", () => {
        expect(firstDirectionalLightOf(undefined)).toBe(NO_SHADOWED_LIGHT);
        expect(firstDirectionalLightOf(lightsOf(() => undefined))).toBe(NO_SHADOWED_LIGHT);
        expect(firstDirectionalLightOf(lightsOf(lights => lights.addAmbient(0.1, 0.1, 0.1)))).toBe(NO_SHADOWED_LIGHT);
        expect(firstDirectionalLightOf(lightsOf(lights => lights.addPoint(0, 1, 0, 1, 1, 1, 5)))).toBe(NO_SHADOWED_LIGHT);
        expect(firstDirectionalLightOf(lightsOf(lights => {
            lights.addPoint(0, 1, 0, 1, 1, 1, 5);
            lights.addDirectional(0, -1, 0, 1, 1, 1);
            lights.addDirectional(1, -1, 0, 1, 1, 1);
        }))).toBe(1);
    });
});

describe("GpuShadowSettings", () => {
    test("the map size defaults to 2048, rounds, clamps to the texture limits, and zero, negative or non-finite sizes mean no map", () => {
        expect(shadowMapSizeOf(new GpuShadowSettings())).toBe(DEFAULT_MAP_SIZE);
        expect(shadowMapSizeOf(settings({mapSize: FRACTIONAL_MAP_SIZE}))).toBe(Math.round(FRACTIONAL_MAP_SIZE));
        expect(shadowMapSizeOf(settings({mapSize: MAX_SHADOW_MAP_SIZE * 4}))).toBe(MAX_SHADOW_MAP_SIZE);
        expect(shadowMapSizeOf(settings({mapSize: 1}))).toBe(MIN_SHADOW_MAP_SIZE);
        for (const mapSize of [0, -DEFAULT_MAP_SIZE, Number.NaN, Number.POSITIVE_INFINITY]) expect(shadowMapSizeOf(settings({mapSize}))).toBe(NO_SHADOW_MAP);
    });
});
