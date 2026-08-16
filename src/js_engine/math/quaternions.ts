import {asFloat32Array, Vec, Vec3, Vec4} from "./types/vec";

export namespace Quaternions {
    // x,y,z,w convention
    export type Quaternion = Vec4;

    const raw = asFloat32Array;

    function deg2rad(a: number) {
        return a * Math.PI / 180;
    }

    export type EulerOrder =
        | "XYZ" | "XZY"
        | "YXZ" | "YZX"
        | "ZXY" | "ZYX"; // default (yaw Z, pitch Y, roll X)


    export function qMulInto(out: Quaternion, a: Quaternion, b: Quaternion): Quaternion {
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

    /** Allocating convenience. Prefer qMulInto on per-frame paths. */
    export function qMul(a: Quaternion, b: Quaternion): Quaternion {
        return qMulInto(Vec.alloc4(), a, b);
    }

    export function qNormalizeInto(out: Quaternion, q: Quaternion): Quaternion {
        const v = raw(q);
        const s = Math.hypot(v[0], v[1], v[2], v[3]) || 1;
        const o = raw(out);
        o[0] = v[0] / s;
        o[1] = v[1] / s;
        o[2] = v[2] / s;
        o[3] = v[3] / s;
        return out;
    }

    export function qNormalize(q: Quaternion): Quaternion {
        return qNormalizeInto(Vec.alloc4(), q);
    }

    /** Axis-angle -> quat (axis must be unit length). */
    export function qFromAxisAngleInto(out: Quaternion, axis: Vec3, angle: number): Quaternion {
        const a = raw(axis);
        const h = angle * 0.5, s = Math.sin(h), c = Math.cos(h);
        const o = raw(out);
        o[0] = a[0] * s;
        o[1] = a[1] * s;
        o[2] = a[2] * s;
        o[3] = c;
        return out;
    }

    export function qFromAxisAngle(axis: Vec3, angle: number): Quaternion {
        return qFromAxisAngleInto(Vec.alloc4(), axis, angle);
    }

    // Reused across eulerToQuat calls — the function is not re-entrant, but it is
    // never called from one of its own arguments, and this keeps it allocation-free.
    const AXIS_X = Vec.alloc3(1, 0, 0);
    const AXIS_Y = Vec.alloc3(0, 1, 0);
    const AXIS_Z = Vec.alloc3(0, 0, 1);
    const scratchQx = Vec.alloc4();
    const scratchQy = Vec.alloc4();
    const scratchQz = Vec.alloc4();
    const scratchAB = Vec.alloc4();

    /**
     * Euler -> Quaternion, written into `out`.
     * @param out    destination quaternion
     * @param euler  rotation angles (radians unless opts.deg)
     * @param order  rotation order (applied right-to-left), default "ZYX"
     * @param opts   {deg?: boolean} set deg=true if inputs are degrees
     *
     * Conventions:
     * - Right-handed; positive angles use right-hand rule around +X,+Y,+Z.
     * - Quaternion layout is [x,y,z,w].
     * - Order "ZYX" means q = Rz(ez) ⊗ Ry(ey) ⊗ Rx(ex)
     */
    export function eulerToQuatInto(
        out: Quaternion,
        euler: Vec3,
        order: EulerOrder = "ZYX",
        opts?: { deg?: boolean },
    ): Quaternion {
        const e = raw(euler);
        const ex = opts?.deg ? deg2rad(e[0]) : e[0];
        const ey = opts?.deg ? deg2rad(e[1]) : e[1];
        const ez = opts?.deg ? deg2rad(e[2]) : e[2];

        const qx = qFromAxisAngleInto(scratchQx, AXIS_X, ex);
        const qy = qFromAxisAngleInto(scratchQy, AXIS_Y, ey);
        const qz = qFromAxisAngleInto(scratchQz, AXIS_Z, ez);

        // compose according to order (right-to-left application)
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
            case "ZYX": // yaw-pitch-roll (default)
            default:
                qMulInto(out, qMulInto(scratchAB, qz, qy), qx);
                break;
        }
        return qNormalizeInto(out, out);
    }

    /** Allocating convenience. Prefer eulerToQuatInto on per-frame paths. */
    export function eulerToQuat(
        euler: Vec3,
        order: EulerOrder = "ZYX",
        opts?: { deg?: boolean },
    ): Quaternion {
        return eulerToQuatInto(Vec.alloc4(), euler, order, opts);
    }
}
