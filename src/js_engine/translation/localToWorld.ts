import {Component} from "../core";
import {asFloat32Array, fromFloat32Array, Vec, Vec16, Vec3, Vec4} from "../math/types/vec";

const raw = (v: Vec<number>): Float32Array => asFloat32Array(v);

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

    /** Live view over this component's storage — writes land in the matrix. */
    public get matrix(): Vec16 {
        return fromFloat32Array<16>(this._matrix);
    }

    public set matrix(value: Vec16) {
        this._matrix.set(raw(value));
    }

    // ---------- Position ----------
    /** Live view over the translation column — writes land in the matrix. */
    public get position(): Vec3 {
        return fromFloat32Array<3>(this._matrix.subarray(M4.tx, M4.tz + 1));
    }

    public set position(p: Vec3) {
        this._matrix.set(raw(p), M4.tx);
    }

    // ---------- Scale ----------
    /** Allocates. Use scaleInto() on any path that runs per frame. */
    public get scale(): Vec3 {
        return this.scaleInto(Vec.alloc3());
    }

    /** Decompose scale from the basis columns into `out`, allocating nothing. */
    public scaleInto(out: Vec3): Vec3 {
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


        return Vec.set3(out, handedDot < 0 ? -sx : sx, sy, sz);
    }

    public set scale(s: Vec3) {
        // Keep current rotation & position; rebuild matrix from TRS
        const r = this.rotation;
        const p = this.position;
        LocalToWorld.fromTRS(this.matrix, p, r, s);
    }

    // ---------- Rotation (as quaternion [x,y,z,w]) ----------
    /** Allocates. Use rotationInto() on any path that runs per frame. */
    public get rotation(): Vec4 {
        return this.rotationInto(Vec.alloc4());
    }

    /** Decompose rotation as a quaternion [x,y,z,w] into `out`, allocating nothing. */
    public rotationInto(out: Vec4): Vec4 {
        const m = this._matrix;

        // Extract and normalize basis (remove scale, handle reflection)
        let sx = Math.hypot(m[0], m[1], m[2]);
        let sy = Math.hypot(m[4], m[5], m[6]);
        let sz = Math.hypot(m[8], m[9], m[10]);

        if (sx === 0 || sy === 0 || sz === 0) return Vec.copy(out, [0, 0, 0, 1]);

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
        const o = raw(out);
        o[0] = x / n;
        o[1] = y / n;
        o[2] = z / n;
        o[3] = w / n;
        return out;
    }

    public set rotation(q: Vec4) {
        const p = this.position;
        const s = this.scale;
        LocalToWorld.fromTRS(this.matrix, p, q, s);
    }

    // ---------- Set full TRS ----------
    public setTRS(position: Vec3, rotation: Vec4, scale: Vec3): void {
        LocalToWorld.fromTRS(this.matrix, position, rotation, scale);
        this.setDirty();
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
    public static identity(out: Vec16 = Vec.alloc<16>(16)): Vec16 {
        // A Vec is always Float32Array-backed now, so the old plain-array branch
        // is gone along with the union type that made it necessary.
        raw(out).set(identity);
        return out;
    }

    /** Build column-major mat4 from TRS (vec4 is [x,y,z,w]) */
    public static fromTRS(out: Vec16, p: Vec3, q: Vec4, s: Vec3): Vec16 {
        const qv = raw(q), pv = raw(p), sv = raw(s), out_ = raw(out);
        const x = qv[0], y = qv[1], z = qv[2], w = qv[3];
        const x2 = x + x, y2 = y + y, z2 = z + z;
        const xx = x * x2, yy = y * y2, zz = z * z2;
        const xy = x * y2, xz = x * z2, yz = y * z2;
        const wx = w * x2, wy = w * y2, wz = w * z2;
        const sx = sv[0], sy = sv[1], sz = sv[2];

        // Upper-left 3x3 (column-major)
        out_[0] = (1 - (yy + zz)) * sx;
        out_[1] = (xy + wz) * sx;
        out_[2] = (xz - wy) * sx;
        out_[3] = 0;

        out_[4] = (xy - wz) * sy;
        out_[5] = (1 - (xx + zz)) * sy;
        out_[6] = (yz + wx) * sy;
        out_[7] = 0;

        out_[8] = (xz + wy) * sz;
        out_[9] = (yz - wx) * sz;
        out_[10] = (1 - (xx + yy)) * sz;
        out_[11] = 0;

        out_[12] = pv[0];
        out_[13] = pv[1];
        out_[14] = pv[2];
        out_[15] = 1;
        return out;
    }

    public mul(other: Vec16) {
        LocalToWorld.mul(other, this.matrix, this.matrix);
        this.setDirty();
    }

    /** out = a * b (column-major) */
    static mul(a: Vec16, b: Vec16, out: Vec16 = this.identity()): Vec16 {
        const av = raw(a), bv = raw(b), o = raw(out);
        const a0 = av[0], a1 = av[1], a2 = av[2], a3 = av[3];
        const a4 = av[4], a5 = av[5], a6 = av[6], a7 = av[7];
        const a8 = av[8], a9 = av[9], a10 = av[10], a11 = av[11];
        const a12 = av[12], a13 = av[13], a14 = av[14], a15 = av[15];

        // col 0
        let b0 = bv[0], b1 = bv[1], b2 = bv[2], b3 = bv[3];
        o[0] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
        o[1] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
        o[2] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
        o[3] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;

        // col 1
        b0 = bv[4];
        b1 = bv[5];
        b2 = bv[6];
        b3 = bv[7];
        o[4] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
        o[5] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
        o[6] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
        o[7] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;

        // col 2
        b0 = bv[8];
        b1 = bv[9];
        b2 = bv[10];
        b3 = bv[11];
        o[8] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
        o[9] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
        o[10] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
        o[11] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;

        // col 3
        b0 = bv[12];
        b1 = bv[13];
        b2 = bv[14];
        b3 = bv[15];
        o[12] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
        o[13] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
        o[14] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
        o[15] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;
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

    /** Transform a point (x,y,z,1). Pass `out` on per-frame paths to avoid allocating. */
    public static transformPoint(m: Vec16, point: Vec3, out: Vec3 = Vec.alloc3()): Vec3 {
        const mm = raw(m), p = raw(point), o = raw(out);
        const ox = mm[0] * p[0] + mm[4] * p[1] + mm[8] * p[2] + mm[12];
        const oy = mm[1] * p[0] + mm[5] * p[1] + mm[9] * p[2] + mm[13];
        const oz = mm[2] * p[0] + mm[6] * p[1] + mm[10] * p[2] + mm[14];
        o[0] = ox;  // via locals, so out may alias point
        o[1] = oy;
        o[2] = oz;
        return out;
    }

    /** Transform a direction (x,y,z,0). Pass `out` on per-frame paths. */
    public static transformDir(m: Vec16, direction: Vec3, out: Vec3 = Vec.alloc3()): Vec3 {
        const mm = raw(m), d = raw(direction), o = raw(out);
        const ox = mm[0] * d[0] + mm[4] * d[1] + mm[8] * d[2];
        const oy = mm[1] * d[0] + mm[5] * d[1] + mm[9] * d[2];
        const oz = mm[2] * d[0] + mm[6] * d[1] + mm[10] * d[2];
        o[0] = ox;
        o[1] = oy;
        o[2] = oz;
        return out;
    }

    /** Invert an affine matrix (ignores perspective) */
    public static invertAffine(mat: Vec16, out: Vec16 = this.identity()): Vec16 {
        const m = raw(mat), o = raw(out);
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

        o[0] = i00;
        o[4] = i01;
        o[8] = i02;
        o[3] = 0;
        o[1] = i10;
        o[5] = i11;
        o[9] = i12;
        o[7] = 0;
        o[2] = i20;
        o[6] = i21;
        o[10] = i22;
        o[11] = 0;

        const tx = m[12], ty = m[13], tz = m[14];
        o[12] = -(i00 * tx + i01 * ty + i02 * tz);
        o[13] = -(i10 * tx + i11 * ty + i12 * tz);
        o[14] = -(i20 * tx + i21 * ty + i22 * tz);
        o[15] = 1;
        return out as Vec16;
    }
}
