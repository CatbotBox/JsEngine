import {AABB} from "../aabb";
import {ItemStore} from "./itemStore";
import {ensureHit, QueryHit, SpatialIndex} from "./spatialIndex";

/**
 * No tree at all: every item in six flat columns, queried by a linear scan.
 *
 * This is the control the octrees have to beat, and it is not a formality. A scan
 * over six SoA columns with the query hoisted runs ~74 µs per 100k boxes, and it
 * has none of the failure modes that made the original octree degrade — nothing
 * to subdivide, nothing to collapse, no structure that outlives the items.
 *
 * Its weakness is `removeBatch`, which walks every live slot. `batchSizes` gives
 * an O(1) bail-out for unknown batches, but a real removal is still O(n).
 */
export class LinearIndex<P> implements SpatialIndex<P> {
    private store: ItemStore<P>;
    /** Live slot indices, densely packed. Iterating this beats scanning holes. */
    private slots: Int32Array;
    private slotCount = 0;
    private batchSizes = new Map<number, number>();

    constructor(capacity = 64) {
        this.store = new ItemStore<P>(capacity);
        this.slots = new Int32Array(Math.max(8, capacity));
    }

    get count(): number {
        return this.store.count;
    }

    replaceBatch(batchId: number, bounds: readonly AABB[], payloads: readonly P[]): void {
        this.removeBatch(batchId);
        this.insertBatch(batchId, bounds, payloads);
    }

    insertBatch(batchId: number, bounds: readonly AABB[], payloads: readonly P[]): void {
        if (bounds.length === 0) return;
        this.reserve(this.slotCount + bounds.length);
        for (let i = 0; i < bounds.length; i++) {
            this.slots[this.slotCount++] = this.store.add(bounds[i], payloads[i], batchId);
        }
        this.batchSizes.set(batchId, (this.batchSizes.get(batchId) ?? 0) + bounds.length);
    }

    removeBatch(batchId: number): void {
        if (!this.batchSizes.has(batchId)) return;
        const {batch} = this.store;
        const slots = this.slots;

        // Compact in place with a read/write cursor rather than building a new
        // array — this runs per changed batch per frame.
        let w = 0;
        for (let r = 0; r < this.slotCount; r++) {
            const slot = slots[r];
            if (batch[slot] === batchId) {
                this.store.release(slot);
            } else {
                slots[w++] = slot;
            }
        }
        this.slotCount = w;
        this.batchSizes.delete(batchId);
    }

    query(range: AABB, out: QueryHit<P>[]): number {
        const q = AABB.asFloat32Array(range);
        // Hoist the query bounds and every column: the measured difference between
        // this and reading through `this.` each iteration is roughly 10x.
        const qx0 = q[0], qy0 = q[1], qz0 = q[2], qx1 = q[3], qy1 = q[4], qz1 = q[5];
        const {xMin, yMin, zMin, xMax, yMax, zMax, payload} = this.store;
        const slots = this.slots;
        const n = this.slotCount;

        let found = 0;
        for (let i = 0; i < n; i++) {
            const s = slots[i];
            if (xMax[s] < qx0 || xMin[s] > qx1) continue;
            if (yMax[s] < qy0 || yMin[s] > qy1) continue;
            if (zMax[s] < qz0 || zMin[s] > qz1) continue;

            const hit = ensureHit(out, found++);
            hit.xMin = xMin[s];
            hit.yMin = yMin[s];
            hit.zMin = zMin[s];
            hit.xMax = xMax[s];
            hit.yMax = yMax[s];
            hit.zMax = zMax[s];
            hit.payload = payload[s] as P;
        }
        return found;
    }

    clear(): void {
        this.store.clear();
        this.slotCount = 0;
        this.batchSizes.clear();
    }

    private reserve(n: number): void {
        if (n <= this.slots.length) return;
        let cap = this.slots.length;
        while (cap < n) cap *= 2;
        const next = new Int32Array(cap);
        next.set(this.slots.subarray(0, this.slotCount));
        this.slots = next;
    }
}
