import {describe, expect, test} from "../../engine/testing/harness";
import {LocalToWorld} from "../../engine/translation";
import {asFloat32Array} from "../../engine/math/types/vec";
import {LIGHT_KIND_DIRECTIONAL, LIGHT_KIND_POINT, SceneLights} from "../../engine/rendering/3d/lighting/sceneLights";
import {FRAME_UNIFORM_FLOATS, frameViewMatrix, writeFrameUniforms} from "./gpuCamera";
import {
    FLOAT_BYTES,
    GpuLightPacking,
    LIGHT_COLOR_OFFSET,
    LIGHT_KIND_OFFSET,
    LIGHT_RANGE_SQUARED_OFFSET,
    LIGHT_STRIDE_FLOATS,
    LIGHT_VECTOR_OFFSET,
    LIGHTS_AMBIENT_OFFSET,
    LIGHTS_COUNT_OFFSET,
    LIGHTS_HEADER_FLOATS,
    LIGHTS_LIT,
    LIGHTS_LIT_OFFSET,
    LIGHTS_UNLIT,
    packSceneLights,
} from "./gpuLightPacking";

const WGSL_VEC4_ALIGN_BYTES = 16;
const DIGITS = 5;
const CAMERA_X = 1, CAMERA_Y = 2, CAMERA_Z = 3;
const QUARTER_TURN_HALF_ANGLE = Math.PI / 4;
const POINT_DISTANCE = 5;
const POINT_RANGE = 8;
const MANY_LIGHTS = 20;
const FOV = Math.PI / 3;
const RASTER_SIDE_PX = 64;
const SQUARE_PIXELS = 1;
const ORTHOGRAPHIC_DEPTH_RANGE = 100;
const SMALL_CAPACITY = 2;

function viewOfCameraTurnedToWorldX(): Float32Array {
    const camera = LocalToWorld.identity();
    LocalToWorld.fromTRSAt(asFloat32Array(camera), 0, CAMERA_X, CAMERA_Y, CAMERA_Z,
        0, Math.sin(QUARTER_TURN_HALF_ANGLE), 0, Math.cos(QUARTER_TURN_HALF_ANGLE), 1, 1, 1);
    const uniforms = new Float32Array(FRAME_UNIFORM_FLOATS);
    writeFrameUniforms(uniforms, camera, FOV, RASTER_SIDE_PX, RASTER_SIDE_PX, SQUARE_PIXELS, ORTHOGRAPHIC_DEPTH_RANGE);
    return frameViewMatrix(uniforms);
}

function closeTo(actual: ArrayLike<number>, expected: readonly number[]): void {
    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) expect(actual[i]).toBeCloseTo(expected[i], DIGITS);
}

describe("packSceneLights", () => {
    test("offsets and strides follow WGSL's 16-byte alignment of vec4 members and arrays", () => {
        for (const offset of [LIGHTS_AMBIENT_OFFSET, LIGHTS_COUNT_OFFSET, LIGHTS_HEADER_FLOATS, LIGHT_VECTOR_OFFSET, LIGHT_COLOR_OFFSET, LIGHT_KIND_OFFSET, LIGHT_STRIDE_FLOATS]) {
            expect(offset * FLOAT_BYTES % WGSL_VEC4_ALIGN_BYTES).toBe(0);
        }
        expect(LIGHTS_LIT_OFFSET).toBe(LIGHTS_COUNT_OFFSET + 1);
        expect(LIGHT_RANGE_SQUARED_OFFSET).toBe(LIGHT_KIND_OFFSET + 1);
    });

    test("no lights or no SceneLights is unlit with nothing to loop over", () => {
        const packing = new GpuLightPacking();
        packSceneLights(undefined, viewOfCameraTurnedToWorldX(), packing);
        expect([packing.words[LIGHTS_COUNT_OFFSET], packing.words[LIGHTS_LIT_OFFSET]]).toEqual([0, LIGHTS_UNLIT]);
        const empty = new SceneLights();
        empty.beginGather();
        packSceneLights(empty, viewOfCameraTurnedToWorldX(), packing);
        expect([packing.words[LIGHTS_COUNT_OFFSET], packing.words[LIGHTS_LIT_OFFSET]]).toEqual([0, LIGHTS_UNLIT]);
        expect(packing.usedFloats).toBe(LIGHTS_HEADER_FLOATS + LIGHT_STRIDE_FLOATS);
    });

    test("ambient alone lights the scene; directional lights point back at the light in view space; points move into view space with range squared", () => {
        const lights = new SceneLights();
        lights.beginGather();
        lights.addAmbient(0.1, 0.2, 0.3);
        lights.addDirectional(1, 0, 0, 0.5, 0.6, 0.7);
        lights.addPoint(CAMERA_X + POINT_DISTANCE, CAMERA_Y, CAMERA_Z, 1, 0.5, 0.25, POINT_RANGE);
        const packing = new GpuLightPacking();
        packSceneLights(lights, viewOfCameraTurnedToWorldX(), packing);

        expect([packing.words[LIGHTS_COUNT_OFFSET], packing.words[LIGHTS_LIT_OFFSET]]).toEqual([2, LIGHTS_LIT]);
        closeTo(packing.data.subarray(LIGHTS_AMBIENT_OFFSET, LIGHTS_AMBIENT_OFFSET + 3), [0.1, 0.2, 0.3]);

        const directional = packing.data.subarray(LIGHTS_HEADER_FLOATS, LIGHTS_HEADER_FLOATS + LIGHT_STRIDE_FLOATS);
        closeTo(directional.subarray(LIGHT_VECTOR_OFFSET, LIGHT_VECTOR_OFFSET + 3), [0, 0, -1]);
        closeTo(directional.subarray(LIGHT_COLOR_OFFSET, LIGHT_COLOR_OFFSET + 3), [0.5, 0.6, 0.7]);
        expect(directional[LIGHT_KIND_OFFSET]).toBe(LIGHT_KIND_DIRECTIONAL);

        const point = packing.data.subarray(LIGHTS_HEADER_FLOATS + LIGHT_STRIDE_FLOATS, LIGHTS_HEADER_FLOATS + 2 * LIGHT_STRIDE_FLOATS);
        closeTo(point.subarray(LIGHT_VECTOR_OFFSET, LIGHT_VECTOR_OFFSET + 3), [0, 0, POINT_DISTANCE]);
        expect(point[LIGHT_KIND_OFFSET]).toBe(LIGHT_KIND_POINT);
        expect(point[LIGHT_RANGE_SQUARED_OFFSET]).toBe(POINT_RANGE * POINT_RANGE);

        const ambientOnly = new SceneLights();
        ambientOnly.beginGather();
        ambientOnly.addAmbient(0.4, 0.4, 0.4);
        packSceneLights(ambientOnly, viewOfCameraTurnedToWorldX(), packing);
        expect([packing.words[LIGHTS_COUNT_OFFSET], packing.words[LIGHTS_LIT_OFFSET]]).toEqual([0, LIGHTS_LIT]);
    });

    test("grows to fit more lights than it was made for, keeping every light", () => {
        const lights = new SceneLights();
        lights.beginGather();
        for (let i = 0; i < MANY_LIGHTS; i++) lights.addDirectional(0, 0, 1, i, 0, 0);
        const packing = new GpuLightPacking(SMALL_CAPACITY);
        packSceneLights(lights, viewOfCameraTurnedToWorldX(), packing);
        expect(packing.capacity).toBeGreaterThan(MANY_LIGHTS - 1);
        expect(packing.usedFloats).toBe(LIGHTS_HEADER_FLOATS + MANY_LIGHTS * LIGHT_STRIDE_FLOATS);
        const last = LIGHTS_HEADER_FLOATS + (MANY_LIGHTS - 1) * LIGHT_STRIDE_FLOATS;
        expect(packing.data[last + LIGHT_COLOR_OFFSET]).toBe(MANY_LIGHTS - 1);
        expect(packing.words[LIGHTS_COUNT_OFFSET]).toBe(MANY_LIGHTS);
    });
});
