import {describe, expect, test} from "../../engine/testing/harness";
import {AXIS_Z, IDENTITY_QUATERNION, quaternionFromAxisAngle, rotateVector} from "./editorCameraMath";
import type {Vector3} from "./editorCameraMath";
import {
    applyMatrix3,
    chainLinear,
    chainRotation,
    handleAxes,
    handleAxisRotation,
    handleOrigin,
    IDENTITY_MATRIX3,
    invertMatrix3,
    localDeltaOf,
    matrix3FromRotationScale,
    multiplyMatrix3,
    rotatedAboutWorldAxis,
    snapToIncrement,
    snapVector,
} from "./transformMath";

const DIGITS = 5;
const QUARTER_TURN = Math.PI / 2;

function expectVector(actual: Vector3, expected: Vector3): void {
    actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], DIGITS));
}

describe("transform maths for gizmos", () => {
    const quarterTurnZ = quaternionFromAxisAngle(AXIS_Z, QUARTER_TURN);

    test("a rotation-scale matrix maps local axes to scaled, rotated axes and inverts back", () => {
        const linear = matrix3FromRotationScale(quarterTurnZ, [2, 3, 4]);
        expectVector(applyMatrix3(linear, [1, 0, 0]), [0, 2, 0]);
        const product = multiplyMatrix3(linear, invertMatrix3(linear)!);
        product.forEach((value, index) => expect(value).toBeCloseTo(IDENTITY_MATRIX3[index], DIGITS));
        expect(invertMatrix3([0, 0, 0, 0, 1, 0, 0, 0, 1])).toBeUndefined();
    });

    test("a world drag under a rotated, scaled parent becomes the matching local delta", () => {
        const parent = chainLinear([{rotation: quarterTurnZ, scale: [2, 2, 2]}]);
        expectVector(localDeltaOf(parent, [0, 2, 0]), [1, 0, 0]);
        expectVector(localDeltaOf(IDENTITY_MATRIX3, [1, 2, 3]), [1, 2, 3]);
    });

    test("parent rotations compose root first", () => {
        const rotation = chainRotation([{rotation: quarterTurnZ, scale: [1, 1, 1]}, {rotation: quarterTurnZ, scale: [1, 1, 1]}]);
        expectVector(rotateVector(rotation, [1, 0, 0]), [-1, 0, 0]);
    });

    test("rotating about a world axis under a rotated parent rotates the child in world space", () => {
        const parent = quaternionFromAxisAngle([1, 0, 0], QUARTER_TURN);
        const local = rotatedAboutWorldAxis([0, 0, 0, 1], parent, AXIS_Z, QUARTER_TURN);
        const world = chainRotation([{rotation: parent, scale: [1, 1, 1]}, {rotation: local, scale: [1, 1, 1]}]);
        const expected = chainRotation([{rotation: quarterTurnZ, scale: [1, 1, 1]}, {rotation: parent, scale: [1, 1, 1]}]);
        expectVector(rotateVector(world, [0, 1, 0]), rotateVector(expected, [0, 1, 0]));
    });

    test("snapping rounds to the nearest increment", () => {
        expect(snapToIncrement(0.37, 0.25)).toBe(0.25);
        expect(Object.is(snapToIncrement(-0.1, 0.25), 0)).toBe(true);
        expect(snapToIncrement(-0.13, 0.25)).toBe(-0.25);
        expect(snapVector([1.4, 2.6, -0.6], 1)).toEqual([1, 3, -1]);
        expect(snapToIncrement(0.37, 0)).toBe(0.37);
    });
});

describe("handle placement", () => {
    const quarterTurnZ = quaternionFromAxisAngle(AXIS_Z, QUARTER_TURN);
    const first = {entity: "first", min: [0, 0, 0] as Vector3, max: [2, 2, 0] as Vector3, pivot: [1, 0, 0] as Vector3, rotation: IDENTITY_QUATERNION};
    const second = {entity: "second", min: [4, 4, 0] as Vector3, max: [6, 8, 0] as Vector3, pivot: [5, 5, 0] as Vector3, rotation: quarterTurnZ};

    test("Center puts the handles at the selection's bounds centre, Pivot at the primary entity's world position", () => {
        expect(handleOrigin([first, second], "first", "center")).toEqual([3, 4, 0]);
        expect(handleOrigin([first, second], "first", "pivot")).toEqual([1, 0, 0]);
        expect(handleOrigin([first, second], "missing", "pivot")).toEqual([5, 5, 0]);
        expect(handleOrigin([], undefined, "pivot")).toBeUndefined();
        expect(handleOrigin([], undefined, "center")).toBeUndefined();
    });

    test("Global keeps the world axes; along the entity the axes follow the primary's world rotation", () => {
        expect(handleAxisRotation([first, second], "second", false)).toEqual(IDENTITY_QUATERNION);
        expect(handleAxisRotation([first, second], "second", true)).toEqual(quarterTurnZ);
        expect(handleAxisRotation([], undefined, true)).toEqual(IDENTITY_QUATERNION);
        const axes = handleAxes(quarterTurnZ, 2);
        expect(axes.length).toBe(2);
        expectVector(axes[0], [0, 1, 0]);
        expectVector(axes[1], [-1, 0, 0]);
        expect(handleAxes(IDENTITY_QUATERNION, 3)).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    });
});
