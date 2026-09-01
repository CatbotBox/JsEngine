/**
 * Fixed-length numeric vectors. The runtime representation is Float32Array; the
 * types below are compile-time brands only, so none of this costs anything.
 *
 * MUTABILITY LIVES IN THE TYPE. `Readonly<SomeComponent>` alone cannot protect a
 * vector field, because Vec is opaque: `Vec.setX(row.pos.xyz, 5)` would still
 * mutate a "read-only" component. So there are two brands — every reader accepts
 * ReadonlyVec, every mutator demands Vec — and Vec widens to ReadonlyVec but not
 * the reverse. A read-only query row therefore rejects mutation at compile time.
 */

declare const VecTag: unique symbol;
declare const VecMut: unique symbol;

/** A vector you may read but not write. */
export type ReadonlyVec<N extends number> = { readonly [VecTag]: N };

/** A vector you may read and write. Assignable to ReadonlyVec<N>; not vice versa. */
export type Vec<N extends number> = ReadonlyVec<N> & { readonly [VecMut]: true };

export type Vec2 = Vec<2>;
export type Vec3 = Vec<3>;
export type Vec4 = Vec<4>;
export type Vec16 = Vec<16>;

export type ReadonlyVec3 = ReadonlyVec<3>;
export type ReadonlyVec4 = ReadonlyVec<4>;
export type ReadonlyVec16 = ReadonlyVec<16>;

/** Boolean companion for the comparison helpers. */
export type truthVec<N> = boolean[] & { length: N };

/**
 * Escape hatch to the backing store, for serialisation, GPU upload, and the
 * index-heavy math in this folder. It erases readonly-ness — only reach for it
 * where you already know the vector is yours to write.
 */
export function asFloat32Array<N extends number>(v: ReadonlyVec<N>): Float32Array {
    return v as unknown as Float32Array;
}

/** Adopt an existing Float32Array as a Vec without copying. The caller owns it. */
export function fromFloat32Array<N extends number>(raw: Float32Array): Vec<N> {
    return raw as unknown as Vec<N>;
}

const castAsFloat32Array = <N extends number>(v: ReadonlyVec<N>): Float32Array => v as unknown as Float32Array;

// Per-size namespaces, so a component writes `Vec3.alloc()` instead of allocating
// a Float32Array and casting it. Type-alias + namespace merging, same as AABB.
export namespace Vec2 {
    export function alloc(x = 0, y = 0): Vec2 {
        const v = new Float32Array(2);
        v[0] = x;
        v[1] = y;
        return v as unknown as Vec2;
    }
}

export namespace Vec3 {
    export function alloc(x = 0, y = 0, z = 0): Vec3 {
        const v = new Float32Array(3);
        v[0] = x;
        v[1] = y;
        v[2] = z;
        return v as unknown as Vec3;
    }
}

export namespace Vec4 {
    export function alloc(x = 0, y = 0, z = 0, w = 0): Vec4 {
        const v = new Float32Array(4);
        v[0] = x;
        v[1] = y;
        v[2] = z;
        v[3] = w;
        return v as unknown as Vec4;
    }
}

export namespace Vec16 {
    export function alloc(): Vec16 {
        return new Float32Array(16) as unknown as Vec16;
    }
}

export namespace Vec {

    // ---------------------------------------------------------------- create

    export function alloc<N extends number>(size: N): Vec<N> {
        return new Float32Array(size) as unknown as Vec<N>;
    }

    export const alloc2 = Vec2.alloc;
    export const alloc3 = Vec3.alloc;
    export const alloc4 = Vec4.alloc;

    export function clone<N extends number>(src: ReadonlyVec<N>): Vec<N> {
        const s = castAsFloat32Array(src);
        const v = new Float32Array(s.length);
        v.set(s);
        return v as unknown as Vec<N>;
    }

    /** Build from a plain array — for literals and config, not hot paths. */
    export function of<N extends number>(values: ArrayLike<number>): Vec<N> {
        const v = new Float32Array(values.length);
        v.set(values as never);
        return v as unknown as Vec<N>;
    }

    // ------------------------------------------------------------------ read

    export function size<N extends number>(v: ReadonlyVec<N>): number {
        return castAsFloat32Array(v).length;
    }

    export function get<N extends number>(v: ReadonlyVec<N>, index: number): number {
        return castAsFloat32Array(v)[index];
    }

    export function x<N extends number>(v: ReadonlyVec<N>): number {
        return castAsFloat32Array(v)[0];
    }

    export function y<N extends number>(v: ReadonlyVec<N>): number {
        return castAsFloat32Array(v)[1];
    }

    export function z<N extends number>(v: ReadonlyVec<N>): number {
        return castAsFloat32Array(v)[2];
    }

    export function w<N extends number>(v: ReadonlyVec<N>): number {
        return castAsFloat32Array(v)[3];
    }

    /** Spread into a plain array. Debugging and serialisation only — allocates. */
    export function toArray<N extends number>(v: ReadonlyVec<N>): number[] {
        return Array.from(castAsFloat32Array(v));
    }

    // ----------------------------------------------------------------- write

    export function set<N extends number>(v: Vec<N>, index: number, value: number): void {
        castAsFloat32Array(v)[index] = value;
    }

    export function setX<N extends number>(v: Vec<N>, value: number): void {
        castAsFloat32Array(v)[0] = value;
    }

    export function setY<N extends number>(v: Vec<N>, value: number): void {
        castAsFloat32Array(v)[1] = value;
    }

    export function setZ<N extends number>(v: Vec<N>, value: number): void {
        castAsFloat32Array(v)[2] = value;
    }

    export function setW<N extends number>(v: Vec<N>, value: number): void {
        castAsFloat32Array(v)[3] = value;
    }

    export function set3<N extends number>(v: Vec<N>, x: number, y: number, z: number): Vec<N> {
        const t = castAsFloat32Array(v);
        t[0] = x;
        t[1] = y;
        t[2] = z;
        return v;
    }

    /** Copy `src` into `out`. Accepts a plain array so callers can seed from literals. */
    export function copy<N extends number>(out: Vec<N>, src: ReadonlyVec<N> | ArrayLike<number>): Vec<N> {
        const s = src as unknown;
        castAsFloat32Array(out).set(s instanceof Float32Array ? s : (s as ArrayLike<number>) as never);
        return out;
    }

    export function fill<N extends number>(out: Vec<N>, value: number): Vec<N> {
        castAsFloat32Array(out).fill(value);
        return out;
    }

    // ------------------------------------------------------------ arithmetic
    // All write into `out` and return it. `out` may alias an input.

    export function addInto<N extends number>(out: Vec<N>, a: ReadonlyVec<N>, b: ReadonlyVec<N>): Vec<N> {
        const o = castAsFloat32Array(out), x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        for (let i = 0; i < o.length; i++) o[i] = x[i] + y[i];
        return out;
    }

    export function subInto<N extends number>(out: Vec<N>, a: ReadonlyVec<N>, b: ReadonlyVec<N>): Vec<N> {
        const o = castAsFloat32Array(out), x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        for (let i = 0; i < o.length; i++) o[i] = x[i] - y[i];
        return out;
    }

    export function mulInto<N extends number>(out: Vec<N>, a: ReadonlyVec<N>, b: ReadonlyVec<N>): Vec<N> {
        const o = castAsFloat32Array(out), x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        for (let i = 0; i < o.length; i++) o[i] = x[i] * y[i];
        return out;
    }

    export function divInto<N extends number>(out: Vec<N>, a: ReadonlyVec<N>, b: ReadonlyVec<N>): Vec<N> {
        const o = castAsFloat32Array(out), x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        for (let i = 0; i < o.length; i++) o[i] = x[i] / y[i];
        return out;
    }

    export function scaleInto<N extends number>(out: Vec<N>, a: ReadonlyVec<N>, scalar: number): Vec<N> {
        const o = castAsFloat32Array(out), x = castAsFloat32Array(a);
        for (let i = 0; i < o.length; i++) o[i] = x[i] * scalar;
        return out;
    }

    export function minInto<N extends number>(out: Vec<N>, a: ReadonlyVec<N>, b: ReadonlyVec<N>): Vec<N> {
        const o = castAsFloat32Array(out), x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        for (let i = 0; i < o.length; i++) o[i] = x[i] < y[i] ? x[i] : y[i];
        return out;
    }

    export function maxInto<N extends number>(out: Vec<N>, a: ReadonlyVec<N>, b: ReadonlyVec<N>): Vec<N> {
        const o = castAsFloat32Array(out), x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        for (let i = 0; i < o.length; i++) o[i] = x[i] > y[i] ? x[i] : y[i];
        return out;
    }

    // ---------------------------------------------------------------- reduce

    export function dot<N extends number>(a: ReadonlyVec<N>, b: ReadonlyVec<N>): number {
        const x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        let sum = 0;
        for (let i = 0; i < x.length; i++) sum += x[i] * y[i];
        return sum;
    }

    export function lengthSquared<N extends number>(v: ReadonlyVec<N>): number {
        return dot(v, v);
    }

    export function length<N extends number>(v: ReadonlyVec<N>): number {
        return Math.sqrt(dot(v, v));
    }

    export function normalizeInto<N extends number>(out: Vec<N>, a: ReadonlyVec<N>): Vec<N> {
        const len = length(a);
        return len === 0 ? copy(out, a) : scaleInto(out, a, 1 / len);
    }

    export function crossInto(out: Vec3, a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
        const x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        const cx = x[1] * y[2] - x[2] * y[1];
        const cy = x[2] * y[0] - x[0] * y[2];
        const cz = x[0] * y[1] - x[1] * y[0];
        const o = castAsFloat32Array(out);
        o[0] = cx;  // via locals, so out may alias a or b
        o[1] = cy;
        o[2] = cz;
        return out;
    }

    // ------------------------------------------------------------ comparison

    export function equals<N extends number>(a: ReadonlyVec<N>, b: ReadonlyVec<N>): boolean {
        if (a === b) return true;
        const x = castAsFloat32Array(a), y = castAsFloat32Array(b);
        if (x.length !== y.length) return false;
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
        return true;
    }
}
