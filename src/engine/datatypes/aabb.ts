import {fromFloat32Array, Vec3} from "../math/types/vec";

declare const AABBTag: unique symbol;

export type AABB = { readonly [AABBTag]: true };

export const AABB_STRIDE = 6;
export const AABB_MIN_X = 0;
export const AABB_MIN_Y = 1;
export const AABB_MIN_Z = 2;
export const AABB_MAX_X = 3;
export const AABB_MAX_Y = 4;
export const AABB_MAX_Z = 5;
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
        b[AABB_MIN_X] = xMin;
        b[AABB_MIN_Y] = yMin;
        b[AABB_MIN_Z] = zMin;
        b[AABB_MAX_X] = xMax;
        b[AABB_MAX_Y] = yMax;
        b[AABB_MAX_Z] = zMax;
        return b as unknown as AABB;
    }

    export function writeInto(
        out: AABB,
        xMin: number, yMin: number, zMin: number,
        xMax: number, yMax: number, zMax: number,
    ): AABB {
        const o = castAsFloat32Array(out);
        o[AABB_MIN_X] = xMin;
        o[AABB_MIN_Y] = yMin;
        o[AABB_MIN_Z] = zMin;
        o[AABB_MAX_X] = xMax;
        o[AABB_MAX_Y] = yMax;
        o[AABB_MAX_Z] = zMax;
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
        return castAsFloat32Array(b)[AABB_MIN_X];
    }

    export function yMin(b: AABB): number {
        return castAsFloat32Array(b)[AABB_MIN_Y];
    }

    export function zMin(b: AABB): number {
        return castAsFloat32Array(b)[AABB_MIN_Z];
    }

    export function xMax(b: AABB): number {
        return castAsFloat32Array(b)[AABB_MAX_X];
    }

    export function yMax(b: AABB): number {
        return castAsFloat32Array(b)[AABB_MAX_Y];
    }

    export function zMax(b: AABB): number {
        return castAsFloat32Array(b)[AABB_MAX_Z];
    }

    export function min(b: AABB): Vec3 {
        return fromFloat32Array<3>(castAsFloat32Array(b).subarray(AABB_MIN_X, AABB_MAX_X));
    }

    export function max(b: AABB): Vec3 {
        return fromFloat32Array<3>(castAsFloat32Array(b).subarray(AABB_MAX_X, AABB_STRIDE));
    }

    export function equals(a: AABB, b: AABB): boolean {
        const x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        return x[AABB_MIN_X] === y[AABB_MIN_X] && x[AABB_MIN_Y] === y[AABB_MIN_Y] && x[AABB_MIN_Z] === y[AABB_MIN_Z]
            && x[AABB_MAX_X] === y[AABB_MAX_X] && x[AABB_MAX_Y] === y[AABB_MAX_Y] && x[AABB_MAX_Z] === y[AABB_MAX_Z];
    }

    export function intersects(a: AABB, b: AABB): boolean {
        const x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        return !(
            y[AABB_MAX_X] < x[AABB_MIN_X] || y[AABB_MIN_X] > x[AABB_MAX_X] ||
            y[AABB_MAX_Y] < x[AABB_MIN_Y] || y[AABB_MIN_Y] > x[AABB_MAX_Y] ||
            y[AABB_MAX_Z] < x[AABB_MIN_Z] || y[AABB_MIN_Z] > x[AABB_MAX_Z]
        );
    }

    export function contains(a: AABB, b: AABB): boolean {
        const x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        return (
            y[AABB_MIN_X] >= x[AABB_MIN_X] && y[AABB_MAX_X] <= x[AABB_MAX_X] &&
            y[AABB_MIN_Y] >= x[AABB_MIN_Y] && y[AABB_MAX_Y] <= x[AABB_MAX_Y] &&
            y[AABB_MIN_Z] >= x[AABB_MIN_Z] && y[AABB_MAX_Z] <= x[AABB_MAX_Z]
        );
    }

    export function unionInto(out: AABB, a: AABB, b: AABB): AABB {
        const o = castAsFloat32Array(out), x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        const xMin = x[AABB_MIN_X] < y[AABB_MIN_X] ? x[AABB_MIN_X] : y[AABB_MIN_X];
        const yMin = x[AABB_MIN_Y] < y[AABB_MIN_Y] ? x[AABB_MIN_Y] : y[AABB_MIN_Y];
        const zMin = x[AABB_MIN_Z] < y[AABB_MIN_Z] ? x[AABB_MIN_Z] : y[AABB_MIN_Z];
        const xMax = x[AABB_MAX_X] > y[AABB_MAX_X] ? x[AABB_MAX_X] : y[AABB_MAX_X];
        const yMax = x[AABB_MAX_Y] > y[AABB_MAX_Y] ? x[AABB_MAX_Y] : y[AABB_MAX_Y];
        const zMax = x[AABB_MAX_Z] > y[AABB_MAX_Z] ? x[AABB_MAX_Z] : y[AABB_MAX_Z];
        o[AABB_MIN_X] = xMin;
        o[AABB_MIN_Y] = yMin;
        o[AABB_MIN_Z] = zMin;
        o[AABB_MAX_X] = xMax;
        o[AABB_MAX_Y] = yMax;
        o[AABB_MAX_Z] = zMax;
        return out;
    }

    export function inflateInto(out: AABB, b: AABB, factor: number): AABB {
        const s = castAsFloat32Array(b);
        const cx = (s[AABB_MIN_X] + s[AABB_MAX_X]) * 0.5;
        const cy = (s[AABB_MIN_Y] + s[AABB_MAX_Y]) * 0.5;
        const cz = (s[AABB_MIN_Z] + s[AABB_MAX_Z]) * 0.5;
        const hx = Math.max(MIN_INFLATED_HALF_EXTENT, (s[AABB_MAX_X] - s[AABB_MIN_X]) * 0.5 * factor);
        const hy = Math.max(MIN_INFLATED_HALF_EXTENT, (s[AABB_MAX_Y] - s[AABB_MIN_Y]) * 0.5 * factor);
        const hz = Math.max(MIN_INFLATED_HALF_EXTENT, (s[AABB_MAX_Z] - s[AABB_MIN_Z]) * 0.5 * factor);
        const o = castAsFloat32Array(out);
        o[AABB_MIN_X] = cx - hx;
        o[AABB_MIN_Y] = cy - hy;
        o[AABB_MIN_Z] = cz - hz;
        o[AABB_MAX_X] = cx + hx;
        o[AABB_MAX_Y] = cy + hy;
        o[AABB_MAX_Z] = cz + hz;
        return out;
    }
}