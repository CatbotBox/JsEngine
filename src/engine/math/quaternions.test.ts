import {describe, expect, test} from "../testing/harness";
import {Quaternions} from "./quaternions";
import {Vec, Vec3, Vec4} from "./types/vec";
import type {ReadonlyVec4} from "./types/vec";

const ANGLE_DIGITS = 4;
const QUATERNION_TOLERANCE = 1e-5;
const QUARTER_TURN = Math.PI / 2;
const DEGREES_PER_HALF_TURN = 180;
const ROLLS = [-3, -1.2, 0, 0.4, 2.9];
const PITCHES = [-1.4, -0.7, 0, 0.5, 1.3];
const YAWS = [-2.8, -0.3, 0, 1.1, 3.1];
const SCALE_OF_NON_UNIT_QUATERNION = 3;
const IN_DEGREES = {deg: true};

function largestDifference(a: ReadonlyVec4, b: ReadonlyVec4, sign: number): number {
    let largest = 0;
    for (let i = 0; i < 4; i++) largest = Math.max(largest, Math.abs(Vec.get(a, i) - sign * Vec.get(b, i)));
    return largest;
}

function sameRotation(a: ReadonlyVec4, b: ReadonlyVec4): boolean {
    return Math.min(largestDifference(a, b, 1), largestDifference(a, b, -1)) < QUATERNION_TOLERANCE;
}

describe("Quaternions.quatToEulerZYXInto", () => {
    test("inverts eulerToQuatInto's default ZYX order across the whole range away from gimbal lock", () => {
        for (const roll of ROLLS) for (const pitch of PITCHES) for (const yaw of YAWS) {
            const euler = Quaternions.quatToEulerZYXInto(Vec3.alloc(), Quaternions.eulerToQuat(Vec3.alloc(roll, pitch, yaw)));
            expect(Vec.x(euler)).toBeCloseTo(roll, ANGLE_DIGITS);
            expect(Vec.y(euler)).toBeCloseTo(pitch, ANGLE_DIGITS);
            expect(Vec.z(euler)).toBeCloseTo(yaw, ANGLE_DIGITS);
        }
    });

    test("quaternion -> euler -> quaternion gives back q or -q", () => {
        const quaternions = [
            Vec4.alloc(0.1, 0.2, 0.3, 0.927),
            Vec4.alloc(-0.5, 0.5, -0.5, 0.5),
            Vec4.alloc(0, 0, 1, 0),
            Vec4.alloc(0.7, -0.1, 0.1, -0.7),
        ].map(q => Quaternions.qNormalize(q));
        for (const q of quaternions) {
            const back = Quaternions.eulerToQuat(Quaternions.quatToEulerZYXInto(Vec3.alloc(), q));
            expect(sameRotation(back, q)).toBe(true);
        }
    });

    test("at gimbal lock it reports roll 0, pitch +-90 degrees and a yaw that rebuilds the same rotation", () => {
        for (const pitch of [QUARTER_TURN, -QUARTER_TURN]) {
            const q = Quaternions.eulerToQuat(Vec3.alloc(0.3, pitch, 0.8));
            const euler = Quaternions.quatToEulerZYXInto(Vec3.alloc(), q);
            expect(Vec.x(euler)).toBe(0);
            expect(Vec.y(euler)).toBeCloseTo(pitch, ANGLE_DIGITS);
            expect(sameRotation(Quaternions.eulerToQuat(euler), q)).toBe(true);
        }
    });

    test("the gimbal-lock yaw stays in (-180, 180] degrees and works for -q", () => {
        const q = Quaternions.eulerToQuat(Vec3.alloc(-2.5, QUARTER_TURN, 2.5));
        const negated = Vec4.alloc(-Vec.x(q), -Vec.y(q), -Vec.z(q), -Vec.w(q));
        for (const candidate of [q, negated]) {
            const euler = Quaternions.quatToEulerZYXInto(Vec3.alloc(), candidate);
            expect(Vec.z(euler) > -Math.PI && Vec.z(euler) <= Math.PI).toBe(true);
            expect(sameRotation(Quaternions.eulerToQuat(euler), q)).toBe(true);
        }
    });

    test("normalizes its input and reports degrees on request", () => {
        const q = Quaternions.eulerToQuat(Vec3.alloc(0.2, -0.4, 1.0));
        const scaled = Vec4.alloc(...Vec.toArray(q).map(c => c * SCALE_OF_NON_UNIT_QUATERNION) as [number, number, number, number]);
        const degrees = Quaternions.quatToEulerZYXInto(Vec3.alloc(), scaled, IN_DEGREES);
        expect(Vec.x(degrees)).toBeCloseTo(0.2 * DEGREES_PER_HALF_TURN / Math.PI, 2);
        expect(Vec.y(degrees)).toBeCloseTo(-0.4 * DEGREES_PER_HALF_TURN / Math.PI, 2);
        expect(Vec.z(degrees)).toBeCloseTo(1.0 * DEGREES_PER_HALF_TURN / Math.PI, 2);
    });

    test("writes into and returns out", () => {
        const out = Vec3.alloc();
        expect(Quaternions.quatToEulerZYXInto(out, Vec4.alloc(0, 0, 0, 1))).toBe(out);
        expect(Vec.toArray(out)).toEqual([0, 0, 0]);
    });
});
