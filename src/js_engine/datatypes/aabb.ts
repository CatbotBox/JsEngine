import {fromFloat32Array, Vec3} from "../math/types/vec";

declare const AABBTag: unique symbol;

export type AABB = { readonly [AABBTag]: true };

export const AABB_STRIDE = 6;
const X_MIN = 0;
const Y_MIN = 1;
const Z_MIN = 2;
const X_MAX = 3;
const Y_MAX = 4;
const Z_MAX = 5;
const MIN_INFLATED_HALF_EXTENT = 0.5;

const castAsFloat32Array = (b: AABB): Float32Array => b as unknown as Float32Array;

export namespace AABB {
    export function wrap(raw: Float32Array): AABB {
        if (raw.length < AABB_STRIDE) {
            throw new Error(`AABB.wrap: need at least ${AABB_STRIDE} floats, got ${raw.length}`);
        }
        return raw as unknown as AABB;
    }

    export function asFloat32Array(b: AABB): Float32Array {
        return castAsFloat32Array(b);
    }

    export function alloc(): AABB {
        return new Float32Array(AABB_STRIDE) as unknown as AABB;
    }

    export function of(
        xMin: number, yMin: number, zMin: number,
        xMax: number, yMax: number, zMax: number,
    ): AABB {
        const b = new Float32Array(AABB_STRIDE);
        b[X_MIN] = xMin;
        b[Y_MIN] = yMin;
        b[Z_MIN] = zMin;
        b[X_MAX] = xMax;
        b[Y_MAX] = yMax;
        b[Z_MAX] = zMax;
        return b as unknown as AABB;
    }

    export function writeInto(
        out: AABB,
        xMin: number, yMin: number, zMin: number,
        xMax: number, yMax: number, zMax: number,
    ): AABB {
        const o = castAsFloat32Array(out);
        o[X_MIN] = xMin;
        o[Y_MIN] = yMin;
        o[Z_MIN] = zMin;
        o[X_MAX] = xMax;
        o[Y_MAX] = yMax;
        o[Z_MAX] = zMax;
        return out;
    }

    export function fromMinMax(min: Vec3, max: Vec3): AABB {
        const mn = min as unknown as Float32Array, mx = max as unknown as Float32Array;
        return of(mn[0], mn[1], mn[2], mx[0], mx[1], mx[2]);
    }

    export function copy(out: AABB, src: AABB): AABB {
        castAsFloat32Array(out).set(castAsFloat32Array(src));
        return out;
    }

    export function clone(src: AABB): AABB {
        const b = new Float32Array(AABB_STRIDE);
        b.set(castAsFloat32Array(src));
        return b as unknown as AABB;
    }

    export function xMin(b: AABB): number {
        return castAsFloat32Array(b)[X_MIN];
    }

    export function yMin(b: AABB): number {
        return castAsFloat32Array(b)[Y_MIN];
    }

    export function zMin(b: AABB): number {
        return castAsFloat32Array(b)[Z_MIN];
    }

    export function xMax(b: AABB): number {
        return castAsFloat32Array(b)[X_MAX];
    }

    export function yMax(b: AABB): number {
        return castAsFloat32Array(b)[Y_MAX];
    }

    export function zMax(b: AABB): number {
        return castAsFloat32Array(b)[Z_MAX];
    }

    export function min(b: AABB): Vec3 {
        return fromFloat32Array<3>(castAsFloat32Array(b).subarray(X_MIN, X_MAX));
    }

    export function max(b: AABB): Vec3 {
        return fromFloat32Array<3>(castAsFloat32Array(b).subarray(X_MAX, AABB_STRIDE));
    }

    export function equals(a: AABB, b: AABB): boolean {
        const x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        return x[X_MIN] === y[X_MIN] && x[Y_MIN] === y[Y_MIN] && x[Z_MIN] === y[Z_MIN]
            && x[X_MAX] === y[X_MAX] && x[Y_MAX] === y[Y_MAX] && x[Z_MAX] === y[Z_MAX];
    }

    export function intersects(a: AABB, b: AABB): boolean {
        const x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        return !(
            y[X_MAX] < x[X_MIN] || y[X_MIN] > x[X_MAX] ||
            y[Y_MAX] < x[Y_MIN] || y[Y_MIN] > x[Y_MAX] ||
            y[Z_MAX] < x[Z_MIN] || y[Z_MIN] > x[Z_MAX]
        );
    }

    export function contains(a: AABB, b: AABB): boolean {
        const x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        return (
            y[X_MIN] >= x[X_MIN] && y[X_MAX] <= x[X_MAX] &&
            y[Y_MIN] >= x[Y_MIN] && y[Y_MAX] <= x[Y_MAX] &&
            y[Z_MIN] >= x[Z_MIN] && y[Z_MAX] <= x[Z_MAX]
        );
    }

    export function unionInto(out: AABB, a: AABB, b: AABB): AABB {
        const o = castAsFloat32Array(out), x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        const xMin = x[X_MIN] < y[X_MIN] ? x[X_MIN] : y[X_MIN];
        const yMin = x[Y_MIN] < y[Y_MIN] ? x[Y_MIN] : y[Y_MIN];
        const zMin = x[Z_MIN] < y[Z_MIN] ? x[Z_MIN] : y[Z_MIN];
        const xMax = x[X_MAX] > y[X_MAX] ? x[X_MAX] : y[X_MAX];
        const yMax = x[Y_MAX] > y[Y_MAX] ? x[Y_MAX] : y[Y_MAX];
        const zMax = x[Z_MAX] > y[Z_MAX] ? x[Z_MAX] : y[Z_MAX];
        o[X_MIN] = xMin;
        o[Y_MIN] = yMin;
        o[Z_MIN] = zMin;
        o[X_MAX] = xMax;
        o[Y_MAX] = yMax;
        o[Z_MAX] = zMax;
        return out;
    }

    export function inflateInto(out: AABB, b: AABB, factor: number): AABB {
        const s = castAsFloat32Array(b);
        const cx = (s[X_MIN] + s[X_MAX]) * 0.5;
        const cy = (s[Y_MIN] + s[Y_MAX]) * 0.5;
        const cz = (s[Z_MIN] + s[Z_MAX]) * 0.5;
        const hx = Math.max(MIN_INFLATED_HALF_EXTENT, (s[X_MAX] - s[X_MIN]) * 0.5 * factor);
        const hy = Math.max(MIN_INFLATED_HALF_EXTENT, (s[Y_MAX] - s[Y_MIN]) * 0.5 * factor);
        const hz = Math.max(MIN_INFLATED_HALF_EXTENT, (s[Z_MAX] - s[Z_MIN]) * 0.5 * factor);
        const o = castAsFloat32Array(out);
        o[X_MIN] = cx - hx;
        o[Y_MIN] = cy - hy;
        o[Z_MIN] = cz - hz;
        o[X_MAX] = cx + hx;
        o[Y_MAX] = cy + hy;
        o[Z_MAX] = cz + hz;
        return out;
    }
}