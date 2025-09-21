import {Component} from "../core";
import {Vec16, Vec3, Vec4} from "../math/types/vec";

// Column-major index helpers (OpenGL/GLSL style)
export const M4 = {
    m00: 0, m10: 1, m20: 2, m30: 3,
    m01: 4, m11: 5, m21: 6, m31: 7,
    m02: 8, m12: 9, m22: 10, m32: 11,
    m03: 12, m13: 13, m23: 14, m33: 15,

    tx: 12, ty: 13, tz: 14, one: 15,
} as const;

const identity = new Float32Array(16);
identity[0] = 1;
identity[1] = 0;
identity[2] = 0;
identity[3] = 0;
identity[4] = 0;
identity[5] = 1;
identity[6] = 0;
identity[7] = 0;
identity[8] = 0;
identity[9] = 0;
identity[10] = 1;
identity[11] = 0;
identity[12] = 0;
identity[13] = 0;
identity[14] = 0;
identity[15] = 1;

export class LocalToWorld extends Component {
    /**
     * Column-major:
     * [  0,  4,  8, 12,
     *    1,  5,  9, 13,
     *    2,  6, 10, 14,
     *    3,  7, 11, 15 ]
     * 0,1,2   → X basis (Right.x, Right.y, Right.z)
     * 4,5,6   → Y basis (Up.x,    Up.y,    Up.z)
     * 8,9,10  → Z basis (Fwd.x,   Fwd.y,   Fwd.z)
     * 12,13,14→ Translation (tx, ty, tz)
     * 3,7,11  → 0 (affine)
     * 15      → 1 (affine)
     */
    private readonly _matrix: Float32Array;

    public get matrix(): Vec16 & Float32Array {
        return this._matrix as Vec16 & Float32Array;
    }

    // ---------- Position ----------
    public get position(): Vec3 {
        const m = this._matrix;
        return m.subarray(M4.tx, M4.tz + 1) as Vec3;
    }

    public set position(p: Vec3) {
        const m = this._matrix;
        m.subarray(M4.tx, M4.tz + 1).set(p)
    }

    // ---------- Scale ----------
    public get scale(): Vec3 {
        const m = this._matrix;
        // column lengths (|basis|)
        const sx = Math.hypot(...m.subarray(0, 3));
        const sy = Math.hypot(...m.subarray(4, 7));
        const sz = Math.hypot(...m.subarray(8, 11));

        // Handle possible reflection: ensure right-handed by absorbing sign into X scale
        const nx0 = sx > 0 ? m[0] / sx : 0, ny0 = sx > 0 ? m[1] / sx : 0, nz0 = sx > 0 ? m[2] / sx : 0;
        const nx1 = sy > 0 ? m[4] / sy : 0, ny1 = sy > 0 ? m[5] / sy : 0, nz1 = sy > 0 ? m[6] / sy : 0;
        const nx2 = sz > 0 ? m[8] / sz : 0, ny2 = sz > 0 ? m[9] / sz : 0, nz2 = sz > 0 ? m[10] / sz : 0;

        const cx = ny0 * nz1 - nz0 * ny1;
        const cy = nz0 * nx1 - nx0 * nz1;
        const cz = nx0 * ny1 - ny0 * nx1;
        const handedDot = cx * nx2 + cy * ny2 + cz * nz2; // ~det sign


        const returnValue = handedDot < 0 ? new Float32Array([-sx, sy, sz]) : new Float32Array([sx, sy, sz]);
        return returnValue as Vec3;
    }

    public set scale(s: Vec3) {
        // Keep current rotation & position; rebuild matrix from TRS
        const r = this.rotation;
        const p = this.position;
        LocalToWorld.fromTRS(this.matrix, p, r, s);
    }

    // ---------- Rotation (as quaternion [x,y,z,w]) ----------
    public get rotation(): Vec4 {
        const m = this._matrix;

        // Extract and normalize basis (remove scale, handle reflection)
        let sx = Math.hypot(m[0], m[1], m[2]);
        let sy = Math.hypot(m[4], m[5], m[6]);
        let sz = Math.hypot(m[8], m[9], m[10]);

        if (sx === 0 || sy === 0 || sz === 0) return [0, 0, 0, 1];

        let r00 = m[0] / sx, r10 = m[1] / sx, r20 = m[2] / sx;
        let r01 = m[4] / sy, r11 = m[5] / sy, r21 = m[6] / sy;
        let r02 = m[8] / sz, r12 = m[9] / sz, r22 = m[10] / sz;

        // Fix reflection (ensure right-handed)
        const cx = r10 * r21 - r20 * r11;
        const cy = r20 * r01 - r00 * r21;
        const cz = r00 * r11 - r10 * r01;
        const handedDot = cx * r02 + cy * r12 + cz * r22;
        if (handedDot < 0) {
            // Flip X column
            r00 = -r00;
            r10 = -r10;
            r20 = -r20;
        }

        // Convert 3x3 rotation (column-major) to quaternion
        const trace = r00 + r11 + r22;
        let x: number, y: number, z: number, w: number;
        if (trace > 0) {
            const S = Math.sqrt(trace + 1.0) * 2; // S = 4*qw
            w = 0.25 * S;
            x = (r21 - r12) / S;
            y = (r02 - r20) / S;
            z = (r10 - r01) / S;
        } else if (r00 > r11 && r00 > r22) {
            const S = Math.sqrt(1.0 + r00 - r11 - r22) * 2; // S = 4*qx
            w = (r21 - r12) / S;
            x = 0.25 * S;
            y = (r01 + r10) / S;
            z = (r02 + r20) / S;
        } else if (r11 > r22) {
            const S = Math.sqrt(1.0 + r11 - r00 - r22) * 2; // S = 4*qy
            w = (r02 - r20) / S;
            x = (r01 + r10) / S;
            y = 0.25 * S;
            z = (r12 + r21) / S;
        } else {
            const S = Math.sqrt(1.0 + r22 - r00 - r11) * 2; // S = 4*qz
            w = (r10 - r01) / S;
            x = (r02 + r20) / S;
            y = (r12 + r21) / S;
            z = 0.25 * S;
        }
        // normalize (numeric safety)
        const n = Math.hypot(x, y, z, w) || 1;
        return [x / n, y / n, z / n, w / n];
    }

    public set rotation(q: Vec4) {
        const p = this.position;
        const s = this.scale;
        LocalToWorld.fromTRS(this.matrix, p, q, s);
    }

    // ---------- Set full TRS ----------
    public setTRS(position: Vec3, rotation: Vec4, scale: Vec3): void {
        LocalToWorld.fromTRS(this.matrix, position, rotation, scale);
        this.dirty = undefined;
    }

    // ---------- ctor ----------
    public constructor() {
        super();
        this._matrix = new Float32Array(16);
        LocalToWorld.identity(this.matrix);
    }

    // ======================================================
    // ============== Static utility functions ==============
    // ======================================================

    /** out = Identity */
    public static identity(out: Float32Array): Vec16 {
        out.set(identity)
        return out as Vec16;
    }

    /** Build column-major mat4 from TRS (vec4 is [x,y,z,w]) */
    public static fromTRS(out: Vec16, p: Vec3, q: Vec4, s: Vec3): Vec16 {
        const [x, y, z, w] = q;
        const x2 = x + x, y2 = y + y, z2 = z + z;
        const xx = x * x2, yy = y * y2, zz = z * z2;
        const xy = x * y2, xz = x * z2, yz = y * z2;
        const wx = w * x2, wy = w * y2, wz = w * z2;
        const sx = s[0], sy = s[1], sz = s[2];

        // Upper-left 3x3 (column-major)
        out[0] = (1 - (yy + zz)) * sx;
        out[1] = (xy + wz) * sx;
        out[2] = (xz - wy) * sx;
        out[3] = 0;

        out[4] = (xy - wz) * sy;
        out[5] = (1 - (xx + zz)) * sy;
        out[6] = (yz + wx) * sy;
        out[7] = 0;

        out[8] = (xz + wy) * sz;
        out[9] = (yz - wx) * sz;
        out[10] = (1 - (xx + yy)) * sz;
        out[11] = 0;

        out[12] = p[0];
        out[13] = p[1];
        out[14] = p[2];
        out[15] = 1;
        return out;
    }

    public mul(other: LocalToWorld) {
        LocalToWorld._mul(this.matrix, other.matrix, this.matrix);
        this.dirty = undefined
    }

    /** out = a * b (column-major) */
    private static _mul(out: Float32Array, a: Float32Array, b: Float32Array): Float32Array {
        const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
        const a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7];
        const a8 = a[8], a9 = a[9], a10 = a[10], a11 = a[11];
        const a12 = a[12], a13 = a[13], a14 = a[14], a15 = a[15];

        // col 0
        let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
        out[0] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
        out[1] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
        out[2] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
        out[3] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;

        // col 1
        b0 = b[4];
        b1 = b[5];
        b2 = b[6];
        b3 = b[7];
        out[4] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
        out[5] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
        out[6] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
        out[7] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;

        // col 2
        b0 = b[8];
        b1 = b[9];
        b2 = b[10];
        b3 = b[11];
        out[8] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
        out[9] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
        out[10] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
        out[11] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;

        // col 3
        b0 = b[12];
        b1 = b[13];
        b2 = b[14];
        b3 = b[15];
        out[12] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
        out[13] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
        out[14] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
        out[15] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;
        return out;
    }

    /** out = a * T(tx,ty,tz) */
    public static translate(out: Float32Array, a: Float32Array, tx: number, ty: number, tz: number): Float32Array {
        out.set(a);
        out[12] = a[0] * tx + a[4] * ty + a[8] * tz + a[12];
        out[13] = a[1] * tx + a[5] * ty + a[9] * tz + a[13];
        out[14] = a[2] * tx + a[6] * ty + a[10] * tz + a[14];
        out[15] = a[3] * tx + a[7] * ty + a[11] * tz + a[15];
        return out;
    }

    /** Transform a point (x,y,z,1) */
    public static transformPoint(out: Vec3, m: Float32Array, x: number, y: number, z: number): Vec3 {
        const ox = m[0] * x + m[4] * y + m[8] * z + m[12];
        const oy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const oz = m[2] * x + m[6] * y + m[10] * z + m[14];
        out[0] = ox;
        out[1] = oy;
        out[2] = oz;
        return out;
    }

    /** Transform a direction (x,y,z,0) */
    public static transformDir(out: Vec3, m: Float32Array, x: number, y: number, z: number): Vec3 {
        const ox = m[0] * x + m[4] * y + m[8] * z;
        const oy = m[1] * x + m[5] * y + m[9] * z;
        const oz = m[2] * x + m[6] * y + m[10] * z;
        out[0] = ox;
        out[1] = oy;
        out[2] = oz;
        return out;
    }

    /** Invert an affine matrix (ignores perspective) */
    public static invertAffine(out: Float32Array, m: Float32Array): Vec16 {
        const a00 = m[0], a01 = m[4], a02 = m[8];
        const a10 = m[1], a11 = m[5], a12 = m[9];
        const a20 = m[2], a21 = m[6], a22 = m[10];

        const b01 = a22 * a11 - a12 * a21;
        const b11 = -a22 * a10 + a12 * a20;
        const b21 = a21 * a10 - a11 * a20;

        let det = a00 * b01 + a01 * b11 + a02 * b21;
        if (Math.abs(det) < 1e-8) return LocalToWorld.identity(out);
        det = 1.0 / det;

        // inverse 3x3 (column-major)
        const i00 = b01 * det;
        const i01 = (-a22 * a01 + a02 * a21) * det;
        const i02 = (a12 * a01 - a02 * a11) * det;

        const i10 = b11 * det;
        const i11 = (a22 * a00 - a02 * a20) * det;
        const i12 = (-a12 * a00 + a02 * a10) * det;

        const i20 = b21 * det;
        const i21 = (-a21 * a00 + a01 * a20) * det;
        const i22 = (a11 * a00 - a01 * a10) * det;

        out[0] = i00;
        out[4] = i01;
        out[8] = i02;
        out[3] = 0;
        out[1] = i10;
        out[5] = i11;
        out[9] = i12;
        out[7] = 0;
        out[2] = i20;
        out[6] = i21;
        out[10] = i22;
        out[11] = 0;

        const tx = m[12], ty = m[13], tz = m[14];
        out[12] = -(i00 * tx + i01 * ty + i02 * tz);
        out[13] = -(i10 * tx + i11 * ty + i12 * tz);
        out[14] = -(i20 * tx + i21 * ty + i22 * tz);
        out[15] = 1;
        return out as Vec16;
    }
}
