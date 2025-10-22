import {Vec3, Vec4} from "./types/vec";

export namespace Quaternions {
    // x,y,z,w convention
    export type Quaternion = Vec4;

    function deg2rad(a: number) {
        return a * Math.PI / 180;
    }

    export type EulerOrder =
        | "XYZ" | "XZY"
        | "YXZ" | "YZX"
        | "ZXY" | "ZYX"; // default (yaw Z, pitch Y, roll X)

    /** Quaternion multiply: q = a ⊗ b (apply b, then a) */
    export function qMul(a: Quaternion, b: Quaternion): Quaternion {
        const [ax, ay, az, aw] = a;
        const [bx, by, bz, bw] = b;
        return [
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz,
        ];
    }

    export function qNormalize(q: Quaternion): Quaternion {
        const [x, y, z, w] = q;
        const s = Math.hypot(x, y, z, w) || 1;
        return [x / s, y / s, z / s, w / s];
    }

    /** Axis-angle -> quat (axis must be unit length) */
    export function qFromAxisAngle(axis: Vec3, angle: number): Quaternion {
        const [ax, ay, az] = axis;
        const h = angle * 0.5, s = Math.sin(h), c = Math.cos(h);
        return [ax * s, ay * s, az * s, c];
    }

    /**
     * Euler -> Quaternion.
     * @param euler rotation angle (in rad)
     * @param order rotation order (applied right-to-left), default "ZYX"
     * @param opts {deg?: boolean} set deg=true if inputs are degrees
     *
     * Conventions:
     * - Right-handed; positive angles use right-hand rule around +X,+Y,+Z.
     * - Quaternion layout is [x,y,z,w].
     * - Order "ZYX" means q = Rz(ez) ⊗ Ry(ey) ⊗ Rx(ex)
     */
    export function eulerToQuat(
        euler: Vec3,
        order: EulerOrder = "ZYX",
        opts?: { deg?: boolean }
    ): Quaternion {
        if (opts?.deg) {
            euler = [deg2rad(euler[0]), deg2rad(euler[1]), deg2rad(euler[2])]
        }

        const qx = qFromAxisAngle([1, 0, 0], euler[0]);
        const qy = qFromAxisAngle([0, 1, 0], euler[1]);
        const qz = qFromAxisAngle([0, 0, 1], euler[2]);

        // compose according to order (right-to-left application)
        let q: Quaternion;
        switch (order) {
            case "XYZ":
                q = qMul(qMul(qx, qy), qz);
                break;
            case "XZY":
                q = qMul(qMul(qx, qz), qy);
                break;
            case "YXZ":
                q = qMul(qMul(qy, qx), qz);
                break;
            case "YZX":
                q = qMul(qMul(qy, qz), qx);
                break;
            case "ZXY":
                q = qMul(qMul(qz, qx), qy);
                break;
            case "ZYX": // yaw-pitch-roll (default)
            default:
                q = qMul(qMul(qz, qy), qx);
                break;
        }
        return qNormalize(q);
    }

}
