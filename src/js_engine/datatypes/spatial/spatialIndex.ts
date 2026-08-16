import {AABB} from "../AABB";

/**
 * A single query result. These are pooled and reused inside the caller's output
 * buffer — copy anything you need to keep beyond the next query.
 */
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
    /** Number of items currently stored. */
    readonly count: number;

    /**
     * Replace everything under `batchId` with the given items. This is the call
     * almost every caller wants: `insertBatch` twice for the same id silently
     * duplicates, which is exactly the bug this rebuild exists to fix.
     */
    replaceBatch(batchId: number, bounds: readonly AABB[], payloads: readonly P[]): void;

    /** Add items under `batchId` without removing what is already there. */
    insertBatch(batchId: number, bounds: readonly AABB[], payloads: readonly P[]): void;

    /** Remove every item under `batchId`. No-op if the batch is unknown. */
    removeBatch(batchId: number): void;

    /**
     * Fill `out` with every item overlapping `range` and return how many.
     * `out` is grown as needed and its entries are reused between calls.
     */
    query(range: AABB, out: QueryHit<P>[]): number;

    /** Drop everything. */
    clear(): void;
}

export function hitAt<P>(out: QueryHit<P>[], i: number): QueryHit<P> {
    let hit = out[i];
    if (hit === undefined) {
        hit = {xMin: 0, yMin: 0, zMin: 0, xMax: 0, yMax: 0, zMax: 0, payload: undefined as unknown as P};
        out[i] = hit;
    }
    return hit;
}
