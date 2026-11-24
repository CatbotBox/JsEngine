import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {World} from "../core";
import {asFloat32Array} from "../math/types/vec";
import {MAT4_ELEMENT, MAT4_FLOATS, MAT4_TRANSLATION_X} from "../math/mat4Layout";
import {TRS_FLOATS} from "../math/trsLayout";
import {ComponentSchemaRegistry} from "../scene/componentSchemaRegistry";
import {registerEngineComponentSchemas} from "../scene/engineComponentSchemas";
import {deserializeInto, serializeWorld} from "../scene/sceneSerialization";
import {platformSceneAssetLoader} from "../scene/sceneAssets";
import {InterpolatedTransform, InterpolatedTransformSnap} from "./interpolatedTransform";
import {LocalPosition} from "./localPosition";
import {LocalToWorld} from "./localToWorld";

const MATRIX_DIGITS = 5;
const START = 0;
const FIRST_TICK = 1;
const SECOND_TICK = 2;
const THIRD_TICK = 3;
const NO_PROGRESS = 0;
const QUARTER_TICK = 0.25;
const HALF_TICK = 0.5;
const COMPLETE_TICK = 1;
const RIGHT_ANGLE = Math.PI / 2;
const STRAIGHT_ANGLE = Math.PI;
const WIDE_ANGLE = Math.PI * 5 / 9;
const NO_RESTART = false;
const RESTART = true;
const INTERPOLATION_OFF = false;
const HALF = 0.5;

interface Pose {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly angleZ: number;
    readonly scale: readonly [number, number, number];
}

const UNIT_SCALE: readonly [number, number, number] = [1, 1, 1];
const START_POSE: Pose = {x: 0, y: 0, z: 0, angleZ: 0, scale: UNIT_SCALE};
const END_POSE: Pose = {x: 10, y: -4, z: 2, angleZ: RIGHT_ANGLE, scale: [3, 3, 3]};

function matrixOf(pose: Pose): Float32Array {
    const matrix = new Float32Array(MAT4_FLOATS);
    const halfAngle = pose.angleZ * HALF;
    LocalToWorld.fromTRSAt(matrix, START, pose.x, pose.y, pose.z, 0, 0, Math.sin(halfAngle), Math.cos(halfAngle), ...pose.scale);
    return matrix;
}

function expectMatrixClose(actual: Float32Array, expected: Float32Array): void {
    for (let k = 0; k < MAT4_FLOATS; k++) expect(actual[k]).toBeCloseTo(expected[k], MATRIX_DIGITS);
}

function boundComponent(enabled?: boolean): {component: InterpolatedTransform, values: Float32Array} {
    const component = new InterpolatedTransform(enabled);
    const values = new Float32Array(InterpolatedTransform.f32Width);
    component.writeF32(values, START);
    component.bindF32(values);
    return {component, values};
}

function capture(values: Float32Array, localToWorld: Float32Array, tick: number, restart: boolean = NO_RESTART): void {
    InterpolatedTransform.captureAt(values, START, localToWorld, START, tick, restart);
}

function capturedMove(from: Pose, to: Pose): {component: InterpolatedTransform, values: Float32Array, localToWorld: Float32Array} {
    const {component, values} = boundComponent();
    capture(values, matrixOf(from), FIRST_TICK);
    const localToWorld = matrixOf(to);
    capture(values, localToWorld, SECOND_TICK);
    return {component, values, localToWorld};
}

function blend(values: Float32Array, localToWorld: Float32Array, tick: number, tickAlpha: number): boolean {
    return InterpolatedTransform.blendAt(values, START, localToWorld, START, tick, tickAlpha);
}

describe("LocalToWorld.decomposeAt", () => {
    test("recovers a translation, rotation and scale that rebuild the matrix, a mirrored axis included", () => {
        const halfAngle = 0.35;
        const axisScale = Math.sin(halfAngle) / Math.sqrt(3);
        const matrix = new Float32Array(MAT4_FLOATS);
        LocalToWorld.fromTRSAt(matrix, START, 1, 2, 3, axisScale, axisScale, axisScale, Math.cos(halfAngle), 2, -3, 4);
        const trs = new Float32Array(TRS_FLOATS);
        LocalToWorld.decomposeAt(matrix, START, trs, START);
        const rebuilt = new Float32Array(MAT4_FLOATS);
        LocalToWorld.fromTRSAt(rebuilt, START, trs[0], trs[1], trs[2], trs[3], trs[4], trs[5], trs[6], trs[7], trs[8], trs[9]);
        expectMatrixClose(rebuilt, matrix);
    });

    test("still backs the instance rotation and scale, the mirrored axis signed on x", () => {
        const localToWorld = new LocalToWorld();
        const scale: [number, number, number] = [-2, 5, 0.5];
        localToWorld.matrix = matrixOf({x: 1, y: 2, z: 3, angleZ: RIGHT_ANGLE, scale}) as unknown as typeof localToWorld.matrix;
        const halfAngle = RIGHT_ANGLE * HALF;
        const rotation = asFloat32Array(localToWorld.rotation);
        [0, 0, Math.sin(halfAngle), Math.cos(halfAngle)].forEach((expected, k) => expect(rotation[k]).toBeCloseTo(expected, MATRIX_DIGITS));
        const decomposedScale = asFloat32Array(localToWorld.scale);
        scale.forEach((expected, k) => expect(decomposedScale[k]).toBeCloseTo(expected, MATRIX_DIGITS));
    });
});

describe("InterpolatedTransform blending", () => {
    test("the first capture has no previous tick, so the transform is not blended", () => {
        const {values} = boundComponent();
        const localToWorld = matrixOf(END_POSE);
        capture(values, localToWorld, FIRST_TICK);
        expect(blend(values, localToWorld, FIRST_TICK, HALF_TICK)).toBe(false);
        expect(Array.from(localToWorld)).toEqual(Array.from(matrixOf(END_POSE)));
    });

    test("halfway between ticks lerps position and scale and turns halfway", () => {
        const {values, localToWorld} = capturedMove(START_POSE, END_POSE);
        expect(blend(values, localToWorld, SECOND_TICK, HALF_TICK)).toBe(true);
        expectMatrixClose(localToWorld, matrixOf({x: 5, y: -2, z: 1, angleZ: RIGHT_ANGLE * HALF, scale: [2, 2, 2]}));
    });

    test("a quarter of the way normalizes the lerped quaternion", () => {
        const {values, localToWorld} = capturedMove(START_POSE, END_POSE);
        blend(values, localToWorld, SECOND_TICK, QUARTER_TICK);
        const halfEnd = RIGHT_ANGLE * HALF;
        const nlerpedAngle = 2 * Math.atan2(QUARTER_TICK * Math.sin(halfEnd), (1 - QUARTER_TICK) + QUARTER_TICK * Math.cos(halfEnd));
        expectMatrixClose(localToWorld, matrixOf({x: 2.5, y: -1, z: 0.5, angleZ: nlerpedAngle, scale: [1.5, 1.5, 1.5]}));
    });

    test("no progress into the next tick shows the previous tick", () => {
        const {values, localToWorld} = capturedMove(START_POSE, END_POSE);
        blend(values, localToWorld, SECOND_TICK, NO_PROGRESS);
        expectMatrixClose(localToWorld, matrixOf(START_POSE));
    });

    test("rotation blends along the shorter arc", () => {
        const {values, localToWorld} = capturedMove(
            {...START_POSE, angleZ: WIDE_ANGLE},
            {...START_POSE, angleZ: -WIDE_ANGLE},
        );
        blend(values, localToWorld, SECOND_TICK, HALF_TICK);
        expectMatrixClose(localToWorld, matrixOf({...START_POSE, angleZ: STRAIGHT_ANGLE}));
    });

    test("restoring puts back the captured matrix exactly, once", () => {
        const {values, localToWorld} = capturedMove(START_POSE, END_POSE);
        blend(values, localToWorld, SECOND_TICK, HALF_TICK);
        expect(InterpolatedTransform.restoreAt(values, START, localToWorld, START)).toBe(true);
        expect(Array.from(localToWorld)).toEqual(Array.from(matrixOf(END_POSE)));
        expect(InterpolatedTransform.restoreAt(values, START, localToWorld, START)).toBe(false);
    });

    test("an unmoved transform is never blended, so a matrix no decomposition reproduces keeps its bits", () => {
        const {values} = boundComponent();
        const sheared = matrixOf(END_POSE);
        sheared[MAT4_ELEMENT.m01] += HALF;
        capture(values, sheared, FIRST_TICK);
        capture(values, sheared, SECOND_TICK);
        const presented = Float32Array.from(sheared);
        expect(blend(values, presented, SECOND_TICK, HALF_TICK)).toBe(false);
        expect(Array.from(presented)).toEqual(Array.from(sheared));
    });

    test("a tick missed between captures restarts the history", () => {
        const {values} = boundComponent();
        capture(values, matrixOf(START_POSE), FIRST_TICK);
        const localToWorld = matrixOf(END_POSE);
        capture(values, localToWorld, THIRD_TICK);
        expect(blend(values, localToWorld, THIRD_TICK, HALF_TICK)).toBe(false);
    });

    test("a capture told to restart, as a snap tag does, starts the history over", () => {
        const {values} = boundComponent();
        capture(values, matrixOf(START_POSE), FIRST_TICK);
        const localToWorld = matrixOf(END_POSE);
        capture(values, localToWorld, SECOND_TICK, RESTART);
        expect(blend(values, localToWorld, SECOND_TICK, HALF_TICK)).toBe(false);
    });

    test("snap before the capture restarts the history, so the next tick blends from the snapped transform", () => {
        const {component, values} = boundComponent();
        capture(values, matrixOf(START_POSE), FIRST_TICK);
        component.snap();
        const teleported = matrixOf(END_POSE);
        capture(values, teleported, SECOND_TICK);
        expect(blend(values, teleported, SECOND_TICK, HALF_TICK)).toBe(false);
        const moved = matrixOf({...END_POSE, x: END_POSE.x + 2});
        capture(values, moved, THIRD_TICK);
        expect(blend(values, moved, THIRD_TICK, HALF_TICK)).toBe(true);
        expectMatrixClose(moved, matrixOf({...END_POSE, x: END_POSE.x + 1}));
    });

    test("snap after the capture draws the captured transform for the rest of the tick", () => {
        const {component, values, localToWorld} = capturedMove(START_POSE, END_POSE);
        component.snap();
        expect(blend(values, localToWorld, SECOND_TICK, HALF_TICK)).toBe(false);
    });

    test("a disabled interpolation is not blended but keeps its history for when it is enabled again", () => {
        const {component, values, localToWorld} = capturedMove(START_POSE, END_POSE);
        component.enabled = INTERPOLATION_OFF;
        expect(blend(values, localToWorld, SECOND_TICK, HALF_TICK)).toBe(false);
        component.enabled = true;
        expect(blend(values, localToWorld, SECOND_TICK, HALF_TICK)).toBe(true);
    });

    test("a matrix changed after its tick was captured is presented as it is", () => {
        const {values, localToWorld} = capturedMove(START_POSE, END_POSE);
        localToWorld[MAT4_TRANSLATION_X] += HALF;
        const changed = Float32Array.from(localToWorld);
        expect(blend(values, localToWorld, SECOND_TICK, HALF_TICK)).toBe(false);
        expect(Array.from(localToWorld)).toEqual(Array.from(changed));
    });

    test("a complete or unknown tick fraction presents the current tick", () => {
        const {values, localToWorld} = capturedMove(START_POSE, END_POSE);
        expect(blend(values, localToWorld, SECOND_TICK, COMPLETE_TICK)).toBe(false);
        expect(blend(values, localToWorld, SECOND_TICK, Number.NaN)).toBe(false);
        expect(Array.from(localToWorld)).toEqual(Array.from(matrixOf(END_POSE)));
    });
});

describe("InterpolatedTransform in scene files", () => {
    test("the enabled flag is saved and loaded; the tick history and a pending snap are not saved", () => {
        const platform = new MemoryPlatform();
        const registry = new ComponentSchemaRegistry();
        registerEngineComponentSchemas(registry);
        const source = new World({platform});
        const interpolation = new InterpolatedTransform(INTERPOLATION_OFF);
        source.entityManager.createEntity("mover", [new LocalPosition(1, 2, 3), new LocalToWorld(), interpolation, new InterpolatedTransformSnap()]);
        const saved = serializeWorld(source, registry);
        expect(saved.document.entities[0].components.InterpolatedTransform).toEqual({enabled: false});
        expect(Object.keys(saved.document.entities[0].components).includes("InterpolatedTransformSnap")).toBe(false);

        const target = new World({platform});
        const loaded = deserializeInto(target, registry, saved.document, {assets: platformSceneAssetLoader(platform)});
        const loadedInterpolation = target.entityManager.getComponent<InterpolatedTransform>(loaded.entities[0], InterpolatedTransform)!;
        expect(loadedInterpolation.enabled).toBe(false);
        expect(target.entityManager.hasComponent(loaded.entities[0], InterpolatedTransformSnap)).toBe(false);
    });
});
