// Build a tuple of length N with element type T
type BuildTuple<N extends number, T, R extends unknown[] = []> =
    R['length'] extends N ? R : BuildTuple<N, T, [...R, T]>;

// Generic vector: fixed-length numeric tuple
// and also compatible with Float32Array or number[] at runtime.
// NOTE: labels are not included here (TS can't compute them).
export type Vec<N extends number> =
    BuildTuple<N, number> &
    (Float32Array | number[]) &
    { length: N };

// Concrete aliases
export type Vec2 = Vec<2>;
export type Vec3 = Vec<3>;
export type Vec4 = Vec<4>;
export type Vec16 = Vec<16>;
// export type Vec = [x: number, y: number, z: number] & (Float32Array | Array<number>) & { length: 3 };

