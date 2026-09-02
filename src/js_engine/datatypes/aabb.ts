import {fromFloat32Array, Vec3} from "../math/types/vec";

declare const AABBTag: unique symbol;

/** Runtime representation: Float32Array(6), [xMin,yMin,zMin,xMax,yMax,zMax]. */
export type AABB = { readonly [AABBTag]: true };

export const AABB_STRIDE = 6;

const castAsFloat32Array = (b: AABB): Float32Array => b as unknown as Float32Array;

export namespace AABB {
    export function wrap(raw: Float32Array): AABB {
        if (raw.length < AABB_STRIDE) {
            throw new Error(`AABB.wrap: need at least ${AABB_STRIDE} floats, got ${raw.length}`);
        }
        return raw as unknown as AABB;
    }

    /** Escape hatch for code that must touch the backing store. */
    export function asFloat32Array(b: AABB): Float32Array {
        return castAsFloat32Array(b);
    }

    export function alloc(): AABB {
        return new Float32Array(AABB_STRIDE) as unknown as AABB;
    }

    /** Allocate and fill. Prefer `writeInto` where an `out` already exists. */
    export function of(
        xMin: number, yMin: number, zMin: number,
        xMax: number, yMax: number, zMax: number,
    ): AABB {
        const b = new Float32Array(AABB_STRIDE);
        b[0] = xMin;
        b[1] = yMin;
        b[2] = zMin;
        b[3] = xMax;
        b[4] = yMax;
        b[5] = zMax;
        return b as unknown as AABB;
    }

    export function writeInto(
        out: AABB,
        xMin: number, yMin: number, zMin: number,
        xMax: number, yMax: number, zMax: number,
    ): AABB {
        const o = castAsFloat32Array(out);
        o[0] = xMin;
        o[1] = yMin;
        o[2] = zMin;
        o[3] = xMax;
        o[4] = yMax;
        o[5] = zMax;
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

    // access

    export function xMin(b: AABB): number {
        return castAsFloat32Array(b)[0];
    }

    export function yMin(b: AABB): number {
        return castAsFloat32Array(b)[1];
    }

    export function zMin(b: AABB): number {
        return castAsFloat32Array(b)[2];
    }

    export function xMax(b: AABB): number {
        return castAsFloat32Array(b)[3];
    }

    export function yMax(b: AABB): number {
        return castAsFloat32Array(b)[4];
    }

    export function zMax(b: AABB): number {
        return castAsFloat32Array(b)[5];
    }

    export function min(b: AABB): Vec3 {
        return fromFloat32Array<3>(castAsFloat32Array(b).subarray(0, 3));
    }

    export function max(b: AABB): Vec3 {
        return fromFloat32Array<3>(castAsFloat32Array(b).subarray(3, 6));
    }

    export function equals(a: AABB, b: AABB): boolean {
        const x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        return x[0] === y[0] && x[1] === y[1] && x[2] === y[2]
            && x[3] === y[3] && x[4] === y[4] && x[5] === y[5];
    }

    export function intersects(a: AABB, b: AABB): boolean {
        const x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        return !(
            y[3] < x[0] || y[0] > x[3] ||
            y[4] < x[1] || y[1] > x[4] ||
            y[5] < x[2] || y[2] > x[5]
        );
    }

    export function contains(a: AABB, b: AABB): boolean {
        const x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        return (
            y[0] >= x[0] && y[3] <= x[3] &&
            y[1] >= x[1] && y[4] <= x[4] &&
            y[2] >= x[2] && y[5] <= x[5]
        );
    }

    export function unionInto(out: AABB, a: AABB, b: AABB): AABB {
        const o = castAsFloat32Array(out), x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        const xMin = x[0] < y[0] ? x[0] : y[0];
        const yMin = x[1] < y[1] ? x[1] : y[1];
        const zMin = x[2] < y[2] ? x[2] : y[2];
        const xMax = x[3] > y[3] ? x[3] : y[3];
        const yMax = x[4] > y[4] ? x[4] : y[4];
        const zMax = x[5] > y[5] ? x[5] : y[5];
        o[0] = xMin;
        o[1] = yMin;
        o[2] = zMin;
        o[3] = xMax;
        o[4] = yMax;
        o[5] = zMax;
        return out;
    }

    export function inflateInto(out: AABB, b: AABB, factor: number): AABB {
        const s = castAsFloat32Array(b);
        const cx = (s[0] + s[3]) * 0.5;
        const cy = (s[1] + s[4]) * 0.5;
        const cz = (s[2] + s[5]) * 0.5;
        const hx = Math.max(0.5, (s[3] - s[0]) * 0.5 * factor);
        const hy = Math.max(0.5, (s[4] - s[1]) * 0.5 * factor);
        const hz = Math.max(0.5, (s[5] - s[2]) * 0.5 * factor);
        const o = castAsFloat32Array(out);
        o[0] = cx - hx;
        o[1] = cy - hy;
        o[2] = cz - hz;
        o[3] = cx + hx;
        o[4] = cy + hy;
        o[5] = cz + hz;
        return out;
    }
}