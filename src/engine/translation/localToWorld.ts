import {Component} from "../core";
import type {F32Backed} from "../core/componentType";
import {asFloat32Array, fromFloat32Array, ReadonlyVec, ReadonlyVec16, ReadonlyVec3, ReadonlyVec4, Vec, Vec16, Vec3, Vec4} from "../math/types/vec";
import {MAT4_FLOATS, MAT4_TRANSLATION_X, MAT4_TRANSLATION_Y, MAT4_TRANSLATION_Z} from "../math/mat4Layout";

const raw = (v: ReadonlyVec<number>): Float32Array => asFloat32Array(v);

export const M4 = {
    m00: 0, m10: 1, m20: 2, m30: 3,
    m01: 4, m11: 5, m21: 6, m31: 7,
    m02: 8, m12: 9, m22: 10, m32: 11,
    m03: 12, m13: 13, m23: 14, m33: 15,

    tx: 12, ty: 13, tz: 14, one: 15,
} as const;

const identity = asFloat32Array(Vec16.alloc());
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

const normalMatrixScratch = Vec16.alloc();
const SINGULAR_DETERMINANT_EPSILON = 1e-8;

export class LocalToWorld extends Component implements F32Backed {
    static readonly f32Width = MAT4_FLOATS;

    private _matrix: Vec16;

    public get matrix(): Vec16 {
        return this._matrix;
    }

    public set matrix(value: ReadonlyVec16) {
        Vec.copy(this._matrix, value);
    }

    public get position(): Vec3 {
        return fromFloat32Array<3>(asFloat32Array(this._matrix).subarray(M4.tx, M4.tz + 1));
    }

    public set position(p: ReadonlyVec3) {
        asFloat32Array(this._matrix).set(raw(p), M4.tx);
    }

    public get scale(): Vec3 {
        return this.decomposeScaleInto(Vec.alloc3());
    }

    public decomposeScaleInto(out: Vec3): Vec3 {
        const m = raw(this._matrix);
        const sx = Math.hypot(...m.subarray(M4.m00, M4.m30));
        const sy = Math.hypot(...m.subarray(M4.m01, M4.m31));
        const sz = Math.hypot(...m.subarray(M4.m02, M4.m32));

        const nx0 = sx > 0 ? m[0] / sx : 0, ny0 = sx > 0 ? m[1] / sx : 0, nz0 = sx > 0 ? m[2] / sx : 0;
        const nx1 = sy > 0 ? m[4] / sy : 0, ny1 = sy > 0 ? m[5] / sy : 0, nz1 = sy > 0 ? m[6] / sy : 0;
        const nx2 = sz > 0 ? m[8] / sz : 0, ny2 = sz > 0 ? m[9] / sz : 0, nz2 = sz > 0 ? m[10] / sz : 0;

        const cx = ny0 * nz1 - nz0 * ny1;
        const cy = nz0 * nx1 - nx0 * nz1;
        const cz = nx0 * ny1 - ny0 * nx1;
        const basisDeterminant = cx * nx2 + cy * ny2 + cz * nz2;

        return Vec.set3(out, basisDeterminant < 0 ? -sx : sx, sy, sz);
    }

    public set scale(s: ReadonlyVec3) {
        const r = this.rotation;
        const p = this.position;
        LocalToWorld.fromTRS(this.matrix, p, r, s);
    }

    public get rotation(): Vec4 {
        return this.rotationInto(Vec.alloc4());
    }

    public rotationInto(out: Vec4): Vec4 {
        const m = raw(this._matrix);

        let sx = Math.hypot(m[0], m[1], m[2]);
        let sy = Math.hypot(m[4], m[5], m[6]);
        let sz = Math.hypot(m[8], m[9], m[10]);

        if (sx === 0 || sy === 0 || sz === 0) return Vec.copy(out, [0, 0, 0, 1]);

        let r00 = m[0] / sx, r10 = m[1] / sx, r20 = m[2] / sx;
        let r01 = m[4] / sy, r11 = m[5] / sy, r21 = m[6] / sy;
        let r02 = m[8] / sz, r12 = m[9] / sz, r22 = m[10] / sz;

        const cx = r10 * r21 - r20 * r11;
        const cy = r20 * r01 - r00 * r21;
        const cz = r00 * r11 - r10 * r01;
        const basisDeterminant = cx * r02 + cy * r12 + cz * r22;
        if (basisDeterminant < 0) {
            r00 = -r00;
            r10 = -r10;
            r20 = -r20;
        }

        const trace = r00 + r11 + r22;
        let x: number, y: number, z: number, w: number;
        if (trace > 0) {
            const fourW = Math.sqrt(trace + 1.0) * 2;
            w = 0.25 * fourW;
            x = (r21 - r12) / fourW;
            y = (r02 - r20) / fourW;
            z = (r10 - r01) / fourW;
        } else if (r00 > r11 && r00 > r22) {
            const fourX = Math.sqrt(1.0 + r00 - r11 - r22) * 2;
            w = (r21 - r12) / fourX;
            x = 0.25 * fourX;
            y = (r01 + r10) / fourX;
            z = (r02 + r20) / fourX;
        } else if (r11 > r22) {
            const fourY = Math.sqrt(1.0 + r11 - r00 - r22) * 2;
            w = (r02 - r20) / fourY;
            x = (r01 + r10) / fourY;
            y = 0.25 * fourY;
            z = (r12 + r21) / fourY;
        } else {
            const fourZ = Math.sqrt(1.0 + r22 - r00 - r11) * 2;
            w = (r10 - r01) / fourZ;
            x = (r02 + r20) / fourZ;
            y = (r12 + r21) / fourZ;
            z = 0.25 * fourZ;
        }
        const n = Math.hypot(x, y, z, w) || 1;
        const o = raw(out);
        o[0] = x / n;
        o[1] = y / n;
        o[2] = z / n;
        o[3] = w / n;
        return out;
    }

    public set rotation(q: ReadonlyVec4) {
        const p = this.position;
        const s = this.scale;
        LocalToWorld.fromTRS(this.matrix, p, q, s);
    }

    public setTRS(position: ReadonlyVec3, rotation: ReadonlyVec4, scale: ReadonlyVec3): void {
        LocalToWorld.fromTRS(this.matrix, position, rotation, scale);
        this.notifyChanged();
    }

    public constructor() {
        super();
        this._matrix = Vec16.alloc();
        LocalToWorld.identity(this.matrix);
    }

    writeF32(dst: Float32Array, offset: number): void {
        dst.set(asFloat32Array(this._matrix), offset);
    }

    bindF32(rowView: Float32Array): void {
        this._matrix = fromFloat32Array<16>(rowView);
    }

    detachF32(): void {
        const own = new Float32Array(LocalToWorld.f32Width);
        own.set(asFloat32Array(this._matrix));
        this._matrix = fromFloat32Array<16>(own);
    }

    public static identity(out: Vec16 = Vec.alloc<16>(LocalToWorld.f32Width)): Vec16 {
        raw(out).set(identity);
        return out;
    }

    public static fromTRS(out: Vec16, p: ReadonlyVec3, q: ReadonlyVec4, s: ReadonlyVec3): Vec16 {
        const qv = raw(q), pv = raw(p), sv = raw(s), out_ = raw(out);
        const x = qv[0], y = qv[1], z = qv[2], w = qv[3];
        const x2 = x + x, y2 = y + y, z2 = z + z;
        const xx = x * x2, yy = y * y2, zz = z * z2;
        const xy = x * y2, xz = x * z2, yz = y * z2;
        const wx = w * x2, wy = w * y2, wz = w * z2;
        const sx = sv[0], sy = sv[1], sz = sv[2];

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

    public mul(other: ReadonlyVec16) {
        LocalToWorld.mul(other, this.matrix, this.matrix);
        this.notifyChanged();
    }

    public static fromTRSAt(
        out: Float32Array, off: number,
        px: number, py: number, pz: number,
        qx: number, qy: number, qz: number, qw: number,
        sx: number, sy: number, sz: number,
    ): void {
        const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
        const xx = qx * x2, yy = qy * y2, zz = qz * z2;
        const xy = qx * y2, xz = qx * z2, yz = qy * z2;
        const wx = qw * x2, wy = qw * y2, wz = qw * z2;

        out[off] = (1 - (yy + zz)) * sx;
        out[off + 1] = (xy + wz) * sx;
        out[off + 2] = (xz - wy) * sx;
        out[off + 3] = 0;

        out[off + 4] = (xy - wz) * sy;
        out[off + 5] = (1 - (xx + zz)) * sy;
        out[off + 6] = (yz + wx) * sy;
        out[off + 7] = 0;

        out[off + 8] = (xz + wy) * sz;
        out[off + 9] = (yz - wx) * sz;
        out[off + 10] = (1 - (xx + yy)) * sz;
        out[off + 11] = 0;

        out[off + MAT4_TRANSLATION_X] = px;
        out[off + MAT4_TRANSLATION_Y] = py;
        out[off + MAT4_TRANSLATION_Z] = pz;
        out[off + 15] = 1;
    }

    public static mulAt(
        a: Float32Array, aOff: number,
        b: Float32Array, bOff: number,
        out: Float32Array, oOff: number,
    ): void {
        const a0 = a[aOff], a1 = a[aOff + 1], a2 = a[aOff + 2], a3 = a[aOff + 3];
        const a4 = a[aOff + 4], a5 = a[aOff + 5], a6 = a[aOff + 6], a7 = a[aOff + 7];
        const a8 = a[aOff + 8], a9 = a[aOff + 9], a10 = a[aOff + 10], a11 = a[aOff + 11];
        const a12 = a[aOff + 12], a13 = a[aOff + 13], a14 = a[aOff + 14], a15 = a[aOff + 15];

        let b0 = b[bOff], b1 = b[bOff + 1], b2 = b[bOff + 2], b3 = b[bOff + 3];
        out[oOff] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
        out[oOff + 1] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
        out[oOff + 2] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
        out[oOff + 3] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;

        b0 = b[bOff + 4];
        b1 = b[bOff + 5];
        b2 = b[bOff + 6];
        b3 = b[bOff + 7];
        out[oOff + 4] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
        out[oOff + 5] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
        out[oOff + 6] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
        out[oOff + 7] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;

        b0 = b[bOff + 8];
        b1 = b[bOff + 9];
        b2 = b[bOff + 10];
        b3 = b[bOff + 11];
        out[oOff + 8] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
        out[oOff + 9] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
        out[oOff + 10] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
        out[oOff + 11] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;

        b0 = b[bOff + 12];
        b1 = b[bOff + 13];
        b2 = b[bOff + 14];
        b3 = b[bOff + 15];
        out[oOff + 12] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
        out[oOff + 13] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
        out[oOff + 14] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
        out[oOff + 15] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;
    }

    static mul(a: ReadonlyVec16, b: ReadonlyVec16, out: Vec16 = this.identity()): Vec16 {
        const av = raw(a), bv = raw(b), o = raw(out);
        const a0 = av[0], a1 = av[1], a2 = av[2], a3 = av[3];
        const a4 = av[4], a5 = av[5], a6 = av[6], a7 = av[7];
        const a8 = av[8], a9 = av[9], a10 = av[10], a11 = av[11];
        const a12 = av[12], a13 = av[13], a14 = av[14], a15 = av[15];

        let b0 = bv[0], b1 = bv[1], b2 = bv[2], b3 = bv[3];
        o[0] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
        o[1] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
        o[2] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
        o[3] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;

        b0 = bv[4];
        b1 = bv[5];
        b2 = bv[6];
        b3 = bv[7];
        o[4] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
        o[5] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
        o[6] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
        o[7] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;

        b0 = bv[8];
        b1 = bv[9];
        b2 = bv[10];
        b3 = bv[11];
        o[8] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
        o[9] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
        o[10] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
        o[11] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;

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

    public static transformPoint(m: ReadonlyVec16, point: ReadonlyVec3, out: Vec3 = Vec3.alloc()): Vec3 {
        const mm = raw(m), p = raw(point), o = raw(out);
        const ox = mm[0] * p[0] + mm[4] * p[1] + mm[8] * p[2] + mm[12];
        const oy = mm[1] * p[0] + mm[5] * p[1] + mm[9] * p[2] + mm[13];
        const oz = mm[2] * p[0] + mm[6] * p[1] + mm[10] * p[2] + mm[14];
        o[0] = ox;
        o[1] = oy;
        o[2] = oz;
        return out;
    }

    public static transformDirection(m: ReadonlyVec16, direction: ReadonlyVec3, out: Vec3 = Vec3.alloc()): Vec3 {
        const mm = raw(m), d = raw(direction), o = raw(out);
        const ox = mm[0] * d[0] + mm[4] * d[1] + mm[8] * d[2];
        const oy = mm[1] * d[0] + mm[5] * d[1] + mm[9] * d[2];
        const oz = mm[2] * d[0] + mm[6] * d[1] + mm[10] * d[2];
        o[0] = ox;
        o[1] = oy;
        o[2] = oz;
        return out;
    }

    public static normalMatrix3(m: ReadonlyVec16, out: Float32Array): Float32Array {
        const inverse = raw(LocalToWorld.invertAffine(m, normalMatrixScratch));
        out[0] = inverse[0];
        out[1] = inverse[4];
        out[2] = inverse[8];
        out[3] = inverse[1];
        out[4] = inverse[5];
        out[5] = inverse[9];
        out[6] = inverse[2];
        out[7] = inverse[6];
        out[8] = inverse[10];
        return out;
    }

    public static invertAffine(mat: ReadonlyVec16, out: Vec16 = this.identity()): Vec16 {
        const m = raw(mat), o = raw(out);
        const a00 = m[0], a01 = m[4], a02 = m[8];
        const a10 = m[1], a11 = m[5], a12 = m[9];
        const a20 = m[2], a21 = m[6], a22 = m[10];

        const b01 = a22 * a11 - a12 * a21;
        const b11 = -a22 * a10 + a12 * a20;
        const b21 = a21 * a10 - a11 * a20;

        let det = a00 * b01 + a01 * b11 + a02 * b21;
        if (Math.abs(det) < SINGULAR_DETERMINANT_EPSILON) return LocalToWorld.identity(out);
        det = 1.0 / det;

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
