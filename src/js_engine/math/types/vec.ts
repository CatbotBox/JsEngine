// Build a tuple of length N with element type T
type BuildTuple<N extends number, T, R extends unknown[] = []> =
    R['length'] extends N ? R : BuildTuple<N, T, [...R, T]>;

// Generic vector: fixed-length numeric tuple
// and also compatible with Float32Array or number[] at runtime.
// NOTE: labels are not included here (TS can't compute them).
export type Vec<N extends number> =
// BuildTuple<N, number> &
    (Float32Array | number[]) &
    { length: N };

// Concrete aliases
export type Vec2 = Vec<2>;
export type Vec3 = Vec<3>;
export type Vec4 = Vec<4>;
export type Vec16 = Vec<16>;

// export type Vec = [x: number, y: number, z: number] & (Float32Array | Array<number>) & { length: 3 };

function equals(vec1: Vec<any>, vec2: Vec<any>): boolean {
    if (vec1 == vec2) return true;
    if (vec1.length !== vec2.length) {
        return false;
    }
    for (let i = 0; i < vec1.length; i++) {
        if (vec1[i] !== vec2[i]) {
            return false;
        }
    }
    return true;
}

export const VecMath = {
    equals
}