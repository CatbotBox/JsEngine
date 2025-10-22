type UnionToIntersection<U> =
    (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never

type NoUnion<Key> =
// If this is a simple type UnionToIntersection<Key> will be the same type, otherwise it will an intersection of all types in the union and probably will not extend `Key`
    [Key] extends [UnionToIntersection<Key>] ? Key : never;

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
export namespace Vec {
    export function equals(vec1: Vec<any>, vec2: Vec<any>): boolean {
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

    export function dot<N extends number>(...vectors: Vec<NoUnion<N>>[]): number {
        const multiplied = mul(...vectors);
        let sum: number = 0;
        for (let i = 0; i < multiplied.length; i++) {
            sum += multiplied[i];
        }
        return sum;
    }

    export function mul<N extends number>(...vectors: Vec<NoUnion<N>>[]): Vec<NoUnion<N>> {
        if (vectors.length === 1) return vectors[0];
        if (vectors.length === 0) throw new Error('No vectors provided');
        const result: Vec<NoUnion<N>> = [...vectors[0]] as Vec<NoUnion<N>>;
        for (let i = 1; i < vectors.length; i++) {
            for (let j = 0; j < vectors[i].length; j++) {
                result[j] *= vectors[i][j];
            }
        }
        return result;
    }

    export function add<N extends number>(...vectors: Vec<NoUnion<N>>[]): Vec<NoUnion<N>> {
        if (vectors.length === 1) return vectors[0];
        if (vectors.length === 0) throw new Error('No vectors provided');
        const result: Vec<NoUnion<N>> = [...vectors[0]] as Vec<NoUnion<N>>;
        for (let i = 1; i < vectors.length; i++) {
            for (let j = 0; j < vectors[i].length; j++) {
                result[j] += vectors[i][j];
            }
        }
        return result;
    }

    export function div<N extends number>(vector: Vec<NoUnion<N>>, ...vectors: Vec<NoUnion<N>>[]): Vec<NoUnion<N>> {
        const result: Vec<NoUnion<N>> = [...vector] as Vec<NoUnion<N>>;
        for (let i = 0; i < vectors.length; i++) {
            for (let j = 0; j < vectors[i].length; j++) {
                result[j] /= vectors[i][j];
            }
        }
        return result;
    }

    export function sub<N extends number>(vector: Vec<NoUnion<N>>, ...vectors: Vec<NoUnion<N>>[]): Vec<NoUnion<N>> {
        const result: Vec<NoUnion<N>> = [...vector] as Vec<NoUnion<N>>;

        for (let i = 0; i < vectors.length; i++) {
            for (let j = 0; j < vectors[i].length; j++) {
                result[j] -= vectors[i][j];
            }
        }
        return result;
    }

    export function min<N extends number>(...vectors: Vec<NoUnion<N>>[]): Vec<NoUnion<N>> {
        if (vectors.length === 1) return vectors[0];
        if (vectors.length === 0) throw new Error('No vectors provided');
        const result: Vec<NoUnion<N>> = [...vectors[0]] as Vec<NoUnion<N>>;
        for (let i = 1; i < vectors.length; i++) {
            for (let j = 0; j < vectors[i].length; j++) {
                if (result[j] > vectors[i][j])
                    result[j] = vectors[i][j];
            }
        }
        return result;
    }

    export function max<N extends number>(...vectors: Vec<NoUnion<N>>[]): Vec<NoUnion<N>> {
        if (vectors.length === 1) return vectors[0];
        if (vectors.length === 0) throw new Error('No vectors provided');
        const result: Vec<NoUnion<N>> = [...vectors[0]] as Vec<NoUnion<N>>;
        for (let i = 1; i < vectors.length; i++) {
            for (let j = 0; j < vectors[i].length; j++) {
                if (result[j] < vectors[i][j])
                    result[j] = vectors[i][j];
            }
        }
        return result;
    }
}

