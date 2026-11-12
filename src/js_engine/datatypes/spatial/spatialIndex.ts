import {AABB} from "../aabb";

export interface QueryHit<P> {
    xMin: number;
    yMin: number;
    zMin: number;
    xMax: number;
    yMax: number;
    zMax: number;
    payload: P;
}

export interface SpatialIndex<P> {
    readonly count: number;

    replaceBatch(batchId: number, bounds: readonly AABB[], payloads: readonly P[]): void;

    insertBatch(batchId: number, bounds: readonly AABB[], payloads: readonly P[]): void;

    removeBatch(batchId: number): void;

    query(range: AABB, out: QueryHit<P>[]): number;

    clear(): void;
}

export function ensureHit<P>(out: QueryHit<P>[], i: number): QueryHit<P> {
    let hit = out[i];
    if (hit === undefined) {
        hit = {xMin: 0, yMin: 0, zMin: 0, xMax: 0, yMax: 0, zMax: 0, payload: undefined as unknown as P};
        out[i] = hit;
    }
    return hit;
}
