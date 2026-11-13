import {asFloat32Array, ReadonlyVec3, ReadonlyVec4, Vec, Vec3, Vec4} from "./types/vec";

export namespace Quaternions {
    export type Quaternion = Vec4;
    export type ReadonlyQuaternion = ReadonlyVec4;

    const raw = asFloat32Array;
    const HALF_TURN_DEGREES = 180;
    const FULL_TURN_RADIANS = 2 * Math.PI;
    const QUARTER_TURN_RADIANS = Math.PI / 2;
    const GIMBAL_LOCK_SIN_PITCH = 1 - 1e-6;

    function deg2rad(a: number) {
        return a * Math.PI / HALF_TURN_DEGREES;
    }

    function rad2deg(a: number) {
        return a * HALF_TURN_DEGREES / Math.PI;
    }

    function wrapToHalfTurn(radians: number): number {
        if (radians > Math.PI) return radians - FULL_TURN_RADIANS;
        if (radians <= -Math.PI) return radians + FULL_TURN_RADIANS;
        return radians;
    }

    export type EulerOrder =
        | "XYZ" | "XZY"
        | "YXZ" | "YZX"
        | "ZXY" | "ZYX";

    const YAW_PITCH_ROLL: EulerOrder = "ZYX";

    export function qMulInto(out: Quaternion, a: ReadonlyQuaternion, b: ReadonlyQuaternion): Quaternion {
        const av = raw(a), bv = raw(b);
        const ax = av[0], ay = av[1], az = av[2], aw = av[3];
        const bx = bv[0], by = bv[1], bz = bv[2], bw = bv[3];
        const o = raw(out);
        const x = aw * bx + ax * bw + ay * bz - az * by;
        const y = aw * by - ax * bz + ay * bw + az * bx;
        const z = aw * bz + ax * by - ay * bx + az * bw;
        const w = aw * bw - ax * bx - ay * by - az * bz;
        o[0] = x;
        o[1] = y;
        o[2] = z;
        o[3] = w;
        return out;
    }

    export function qMul(a: ReadonlyQuaternion, b: ReadonlyQuaternion): Quaternion {
        return qMulInto(Vec.alloc4(), a, b);
    }

    export function qNormalizeInto(out: Quaternion, q: ReadonlyQuaternion): Quaternion {
        const v = raw(q);
        const s = Math.hypot(v[0], v[1], v[2], v[3]) || 1;
        const o = raw(out);
        o[0] = v[0] / s;
        o[1] = v[1] / s;
        o[2] = v[2] / s;
        o[3] = v[3] / s;
        return out;
    }

    export function qNormalize(q: ReadonlyQuaternion): Quaternion {
        return qNormalizeInto(Vec.alloc4(), q);
    }

    export function qFromAxisAngleInto(out: Quaternion, unitAxis: ReadonlyVec3, angle: number): Quaternion {
        const a = raw(unitAxis);
        const h = angle * 0.5, s = Math.sin(h), c = Math.cos(h);
        const o = raw(out);
        o[0] = a[0] * s;
        o[1] = a[1] * s;
        o[2] = a[2] * s;
        o[3] = c;
        return out;
    }

    export function qFromAxisAngle(unitAxis: ReadonlyVec3, angle: number): Quaternion {
        return qFromAxisAngleInto(Vec.alloc4(), unitAxis, angle);
    }

    const AXIS_X = Vec.alloc3(1, 0, 0);
    const AXIS_Y = Vec.alloc3(0, 1, 0);
    const AXIS_Z = Vec.alloc3(0, 0, 1);
    const scratchQx = Vec.alloc4();
    const scratchQy = Vec.alloc4();
    const scratchQz = Vec.alloc4();
    const scratchAB = Vec.alloc4();

    export function eulerToQuatInto(
        out: Quaternion,
        euler: ReadonlyVec3,
        order: EulerOrder = YAW_PITCH_ROLL,
        opts?: { deg?: boolean },
    ): Quaternion {
        const e = raw(euler);
        const ex = opts?.deg ? deg2rad(e[0]) : e[0];
        const ey = opts?.deg ? deg2rad(e[1]) : e[1];
        const ez = opts?.deg ? deg2rad(e[2]) : e[2];

        const qx = qFromAxisAngleInto(scratchQx, AXIS_X, ex);
        const qy = qFromAxisAngleInto(scratchQy, AXIS_Y, ey);
        const qz = qFromAxisAngleInto(scratchQz, AXIS_Z, ez);

        switch (order) {
            case "XYZ":
                qMulInto(out, qMulInto(scratchAB, qx, qy), qz);
                break;
            case "XZY":
                qMulInto(out, qMulInto(scratchAB, qx, qz), qy);
                break;
            case "YXZ":
                qMulInto(out, qMulInto(scratchAB, qy, qx), qz);
                break;
            case "YZX":
                qMulInto(out, qMulInto(scratchAB, qy, qz), qx);
                break;
            case "ZXY":
                qMulInto(out, qMulInto(scratchAB, qz, qx), qy);
                break;
            case "ZYX":
            default:
                qMulInto(out, qMulInto(scratchAB, qz, qy), qx);
                break;
        }
        return qNormalizeInto(out, out);
    }

    export function eulerToQuat(
        euler: ReadonlyVec3,
        order: EulerOrder = YAW_PITCH_ROLL,
        opts?: { deg?: boolean },
    ): Quaternion {
        return eulerToQuatInto(Vec.alloc4(), euler, order, opts);
    }

    export function quatToEulerZYXInto(out: Vec3, q: ReadonlyQuaternion, opts?: { deg?: boolean }): Vec3 {
        const v = raw(q);
        const length = Math.hypot(v[0], v[1], v[2], v[3]) || 1;
        const x = v[0] / length, y = v[1] / length, z = v[2] / length, w = v[3] / length;
        const sinPitch = 2 * (w * y - z * x);
        let roll: number, pitch: number, yaw: number;
        if (Math.abs(sinPitch) >= GIMBAL_LOCK_SIN_PITCH) {
            roll = 0;
            pitch = Math.sign(sinPitch) * QUARTER_TURN_RADIANS;
            yaw = wrapToHalfTurn(2 * Math.atan2(z, w));
        } else {
            roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
            pitch = Math.asin(sinPitch);
            yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
        }
        const o = raw(out);
        o[0] = opts?.deg ? rad2deg(roll) : roll;
        o[1] = opts?.deg ? rad2deg(pitch) : pitch;
        o[2] = opts?.deg ? rad2deg(yaw) : yaw;
        return out;
    }
}
