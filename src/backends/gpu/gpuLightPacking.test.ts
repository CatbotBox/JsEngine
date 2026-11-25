import {describe, expect, test} from "../../engine/testing/harness";
import {LocalToWorld} from "../../engine/translation";
import {asFloat32Array} from "../../engine/math/types/vec";
import {
    coneScaleOf,
    LIGHT_KIND_DIRECTIONAL,
    LIGHT_KIND_POINT,
    LIGHT_KIND_RECT,
    LIGHT_KIND_SPHERE,
    LIGHT_KIND_SPOT,
    LIGHT_KIND_TUBE,
    SceneLights,
} from "../../engine/rendering/3d/lighting/sceneLights";
import {FRAME_UNIFORM_FLOATS, frameViewMatrix, writeFrameUniforms} from "./gpuCamera";
import {
    assignLightShadowMap,
    FLOAT_BYTES,
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
    LIGHT_SHADOW_MAP_OFFSET,
    LIGHT_SHAPE_OFFSET,
    LIGHT_STRIDE_FLOATS,
    LIGHT_VECTOR_OFFSET,
    LIGHTS_AMBIENT_OFFSET,
    LIGHTS_COUNT_OFFSET,
    LIGHTS_HEADER_FLOATS,
    LIGHTS_HEMISPHERE_GRADIENT_OFFSET,
    LIGHTS_LIT,
    LIGHTS_LIT_OFFSET,
    LIGHTS_UNLIT,
    NO_SHADOW_MAP_SLOT,
    packSceneLights,
    VEC4_FLOATS,
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
const SPOT_INNER_COS = 0.9;
const SPOT_OUTER_COS = 0.8;
const SPHERE_RADIUS = 0.5;
const TUBE_HALF_LENGTH = 1.5;
const TUBE_RADIUS = 0.2;
const RECT_HALF_WIDTH = 0.75;
const RECT_HALF_HEIGHT = 0.25;
const AREA_RANGE = 6;
const VIEW_Z_COLUMN = 2;
const DIRECTIONAL_LIGHT_INDEX = 2;
const SHADOW_RECORD = 3;

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

function slot(packing: GpuLightPacking, index: number): Float32Array {
    const start = LIGHTS_HEADER_FLOATS + index * LIGHT_STRIDE_FLOATS;
    return packing.data.subarray(start, start + LIGHT_STRIDE_FLOATS);
}

function vec3(light: Float32Array, offset: number): Float32Array {
    return light.subarray(offset, offset + 3);
}

describe("packSceneLights", () => {
    test("offsets and strides follow WGSL's 16-byte alignment of vec4 members and arrays", () => {
        for (const offset of [
            LIGHTS_AMBIENT_OFFSET, LIGHTS_COUNT_OFFSET, LIGHTS_HEMISPHERE_GRADIENT_OFFSET, LIGHTS_HEADER_FLOATS,
            LIGHT_VECTOR_OFFSET, LIGHT_COLOR_OFFSET, LIGHT_KIND_OFFSET, LIGHT_DIRECTION_OFFSET, LIGHT_AXIS_X_OFFSET, LIGHT_AXIS_Y_OFFSET, LIGHT_SHAPE_OFFSET, LIGHT_STRIDE_FLOATS,
        ]) {
            expect(offset * FLOAT_BYTES % WGSL_VEC4_ALIGN_BYTES).toBe(0);
        }
        expect(LIGHTS_LIT_OFFSET).toBe(LIGHTS_COUNT_OFFSET + 1);
        expect(LIGHT_RANGE_SQUARED_OFFSET).toBe(LIGHT_KIND_OFFSET + 1);
    });

    test("the layout is pinned: a 20-float header with the hemisphere mat3 after the counts, then 28 floats per light", () => {
        expect({LIGHTS_AMBIENT_OFFSET, LIGHTS_COUNT_OFFSET, LIGHTS_LIT_OFFSET, LIGHTS_HEMISPHERE_GRADIENT_OFFSET, LIGHTS_HEADER_FLOATS})
            .toEqual({LIGHTS_AMBIENT_OFFSET: 0, LIGHTS_COUNT_OFFSET: 4, LIGHTS_LIT_OFFSET: 5, LIGHTS_HEMISPHERE_GRADIENT_OFFSET: 8, LIGHTS_HEADER_FLOATS: 20});
        expect({
            LIGHT_VECTOR_OFFSET, LIGHT_COLOR_OFFSET, LIGHT_KIND_OFFSET, LIGHT_RANGE_SQUARED_OFFSET, LIGHT_SHADOW_MAP_OFFSET, LIGHT_DIRECTION_OFFSET,
            LIGHT_AXIS_X_OFFSET, LIGHT_EXTENT_X_OFFSET, LIGHT_AXIS_Y_OFFSET, LIGHT_EXTENT_Y_OFFSET,
            LIGHT_SHAPE_OFFSET, LIGHT_RADIUS_OFFSET, LIGHT_CONE_COS_OUTER_OFFSET, LIGHT_CONE_SCALE_OFFSET, LIGHT_STRIDE_FLOATS,
        }).toEqual({
            LIGHT_VECTOR_OFFSET: 0, LIGHT_COLOR_OFFSET: 4, LIGHT_KIND_OFFSET: 8, LIGHT_RANGE_SQUARED_OFFSET: 9, LIGHT_SHADOW_MAP_OFFSET: 10, LIGHT_DIRECTION_OFFSET: 12,
            LIGHT_AXIS_X_OFFSET: 16, LIGHT_EXTENT_X_OFFSET: 19, LIGHT_AXIS_Y_OFFSET: 20, LIGHT_EXTENT_Y_OFFSET: 23,
            LIGHT_SHAPE_OFFSET: 24, LIGHT_RADIUS_OFFSET: 24, LIGHT_CONE_COS_OUTER_OFFSET: 25, LIGHT_CONE_SCALE_OFFSET: 26, LIGHT_STRIDE_FLOATS: 28,
        });
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
        closeTo(packing.data.subarray(LIGHTS_HEMISPHERE_GRADIENT_OFFSET, LIGHTS_HEADER_FLOATS), new Array(LIGHTS_HEADER_FLOATS - LIGHTS_HEMISPHERE_GRADIENT_OFFSET).fill(0));

        const directional = slot(packing, 0);
        closeTo(vec3(directional, LIGHT_VECTOR_OFFSET), [0, 0, -1]);
        closeTo(vec3(directional, LIGHT_COLOR_OFFSET), [0.5, 0.6, 0.7]);
        expect(directional[LIGHT_KIND_OFFSET]).toBe(LIGHT_KIND_DIRECTIONAL);

        const point = slot(packing, 1);
        closeTo(vec3(point, LIGHT_VECTOR_OFFSET), [0, 0, POINT_DISTANCE]);
        expect(point[LIGHT_KIND_OFFSET]).toBe(LIGHT_KIND_POINT);
        expect(point[LIGHT_RANGE_SQUARED_OFFSET]).toBe(POINT_RANGE * POINT_RANGE);
        closeTo(point.subarray(LIGHT_DIRECTION_OFFSET), new Array(LIGHT_STRIDE_FLOATS - LIGHT_DIRECTION_OFFSET).fill(0));

        const ambientOnly = new SceneLights();
        ambientOnly.beginGather();
        ambientOnly.addAmbient(0.4, 0.4, 0.4);
        packSceneLights(ambientOnly, viewOfCameraTurnedToWorldX(), packing);
        expect([packing.words[LIGHTS_COUNT_OFFSET], packing.words[LIGHTS_LIT_OFFSET]]).toEqual([0, LIGHTS_LIT]);
    });

    test("a spot light packs its view-space position, its unflipped view-space direction, its outer cone cosine and the cone's smoothstep scale", () => {
        const lights = new SceneLights();
        lights.beginGather();
        lights.addSpot(CAMERA_X + POINT_DISTANCE, CAMERA_Y, CAMERA_Z, 0, 1, 0, 1, 1, 1, POINT_RANGE, SPOT_INNER_COS, SPOT_OUTER_COS);
        const packing = new GpuLightPacking();
        packSceneLights(lights, viewOfCameraTurnedToWorldX(), packing);
        const spot = slot(packing, 0);
        expect(spot[LIGHT_KIND_OFFSET]).toBe(LIGHT_KIND_SPOT);
        closeTo(vec3(spot, LIGHT_VECTOR_OFFSET), [0, 0, POINT_DISTANCE]);
        expect(spot[LIGHT_RANGE_SQUARED_OFFSET]).toBe(POINT_RANGE * POINT_RANGE);
        closeTo(vec3(spot, LIGHT_DIRECTION_OFFSET), [0, 1, 0]);
        expect(spot[LIGHT_CONE_COS_OUTER_OFFSET]).toBeCloseTo(SPOT_OUTER_COS, DIGITS);
        expect(spot[LIGHT_CONE_SCALE_OFFSET]).toBeCloseTo(coneScaleOf(SPOT_INNER_COS, SPOT_OUTER_COS), DIGITS);
    });

    test("sphere, tube and rect lights pack their radius, view-space axes and half extents", () => {
        const lights = new SceneLights();
        lights.beginGather();
        lights.addSphere(CAMERA_X, CAMERA_Y + 1, CAMERA_Z, 1, 1, 1, AREA_RANGE, SPHERE_RADIUS);
        lights.addTube(CAMERA_X + 2, CAMERA_Y, CAMERA_Z + 1, 0, 0, 3, 1, 1, 1, AREA_RANGE, TUBE_HALF_LENGTH, TUBE_RADIUS);
        lights.addRect(CAMERA_X, CAMERA_Y, CAMERA_Z + 2, 2, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, AREA_RANGE, RECT_HALF_WIDTH, RECT_HALF_HEIGHT);
        const packing = new GpuLightPacking();
        packSceneLights(lights, viewOfCameraTurnedToWorldX(), packing);

        const sphere = slot(packing, 0);
        expect(sphere[LIGHT_KIND_OFFSET]).toBe(LIGHT_KIND_SPHERE);
        closeTo(vec3(sphere, LIGHT_VECTOR_OFFSET), [0, 1, 0]);
        expect(sphere[LIGHT_RADIUS_OFFSET]).toBeCloseTo(SPHERE_RADIUS, DIGITS);
        closeTo(sphere.subarray(LIGHT_AXIS_X_OFFSET, LIGHT_AXIS_X_OFFSET + VEC4_FLOATS), [0, 0, 0, 0]);

        const tube = slot(packing, 1);
        expect(tube[LIGHT_KIND_OFFSET]).toBe(LIGHT_KIND_TUBE);
        closeTo(vec3(tube, LIGHT_VECTOR_OFFSET), [-1, 0, 2]);
        closeTo(tube.subarray(LIGHT_AXIS_X_OFFSET, LIGHT_AXIS_X_OFFSET + VEC4_FLOATS), [-1, 0, 0, TUBE_HALF_LENGTH]);
        expect(tube[LIGHT_RADIUS_OFFSET]).toBeCloseTo(TUBE_RADIUS, DIGITS);
        expect(tube[LIGHT_RANGE_SQUARED_OFFSET]).toBe(AREA_RANGE * AREA_RANGE);

        const rect = slot(packing, 2);
        expect(rect[LIGHT_KIND_OFFSET]).toBe(LIGHT_KIND_RECT);
        closeTo(vec3(rect, LIGHT_VECTOR_OFFSET), [-2, 0, 0]);
        closeTo(vec3(rect, LIGHT_DIRECTION_OFFSET), [0, 0, 1]);
        closeTo(rect.subarray(LIGHT_AXIS_X_OFFSET, LIGHT_AXIS_X_OFFSET + VEC4_FLOATS), [-1, 0, 0, RECT_HALF_WIDTH]);
        closeTo(rect.subarray(LIGHT_AXIS_Y_OFFSET, LIGHT_AXIS_Y_OFFSET + VEC4_FLOATS), [0, 1, 0, RECT_HALF_HEIGHT]);
        expect(rect[LIGHT_RADIUS_OFFSET]).toBe(0);
    });

    test("a hemisphere light adds its mean to the ambient and its view-space gradient to the mat3, one column per normal axis, without taking a slot", () => {
        const lights = new SceneLights();
        lights.beginGather();
        lights.addAmbient(0.1, 0.1, 0.1);
        lights.addHemisphere(1, 0, 0, 0.9, 0.5, 0.3, 0.1, 0.1, 0.1);
        const packing = new GpuLightPacking();
        packSceneLights(lights, viewOfCameraTurnedToWorldX(), packing);
        expect([packing.words[LIGHTS_COUNT_OFFSET], packing.words[LIGHTS_LIT_OFFSET]]).toEqual([0, LIGHTS_LIT]);
        closeTo(packing.data.subarray(LIGHTS_AMBIENT_OFFSET, LIGHTS_AMBIENT_OFFSET + 3), [0.6, 0.4, 0.3]);
        const gradient = packing.data.subarray(LIGHTS_HEMISPHERE_GRADIENT_OFFSET, LIGHTS_HEADER_FLOATS);
        const zColumn = VIEW_Z_COLUMN * VEC4_FLOATS;
        closeTo(gradient.subarray(0, zColumn), new Array(zColumn).fill(0));
        closeTo(gradient.subarray(zColumn, zColumn + 3), [0.4, 0.2, 0.1]);
    });

    test("every light keeps its SceneLights index in the packed buffer, so a shadow map assigned by light index lands in that light's slot", () => {
        const lights = new SceneLights();
        lights.beginGather();
        lights.addHemisphere(0, 1, 0, 1, 1, 1, 0, 0, 0);
        lights.addSpot(0, 0, 0, 0, 0, 1, 1, 1, 1, POINT_RANGE, SPOT_INNER_COS, SPOT_OUTER_COS);
        lights.addSphere(0, 0, 0, 1, 1, 1, AREA_RANGE, SPHERE_RADIUS);
        lights.addDirectional(0, -1, 0, 1, 1, 1);
        const packing = new GpuLightPacking();
        packSceneLights(lights, viewOfCameraTurnedToWorldX(), packing);
        expect([0, 1, 2].map(index => slot(packing, index)[LIGHT_KIND_OFFSET])).toEqual([LIGHT_KIND_SPOT, LIGHT_KIND_SPHERE, LIGHT_KIND_DIRECTIONAL]);
        expect([0, 1, 2].map(index => slot(packing, index)[LIGHT_SHADOW_MAP_OFFSET])).toEqual([NO_SHADOW_MAP_SLOT, NO_SHADOW_MAP_SLOT, NO_SHADOW_MAP_SLOT]);
        assignLightShadowMap(packing, DIRECTIONAL_LIGHT_INDEX, SHADOW_RECORD);
        expect([0, 1, 2].map(index => slot(packing, index)[LIGHT_SHADOW_MAP_OFFSET])).toEqual([NO_SHADOW_MAP_SLOT, NO_SHADOW_MAP_SLOT, SHADOW_RECORD]);
        expect(slot(packing, DIRECTIONAL_LIGHT_INDEX)[LIGHT_KIND_OFFSET]).toBe(LIGHT_KIND_DIRECTIONAL);
        packSceneLights(lights, viewOfCameraTurnedToWorldX(), packing);
        expect(slot(packing, DIRECTIONAL_LIGHT_INDEX)[LIGHT_SHADOW_MAP_OFFSET]).toBe(NO_SHADOW_MAP_SLOT);
    });

    test("a slot that held an area light last frame packs a point light with clean shape fields", () => {
        const view = viewOfCameraTurnedToWorldX();
        const packing = new GpuLightPacking();
        const lights = new SceneLights();
        lights.beginGather();
        lights.addRect(0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, AREA_RANGE, RECT_HALF_WIDTH, RECT_HALF_HEIGHT);
        packSceneLights(lights, view, packing);
        lights.beginGather();
        lights.addPoint(0, 0, 0, 1, 1, 1, POINT_RANGE);
        packSceneLights(lights, view, packing);
        closeTo(slot(packing, 0).subarray(LIGHT_DIRECTION_OFFSET), new Array(LIGHT_STRIDE_FLOATS - LIGHT_DIRECTION_OFFSET).fill(0));
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
