import {AABB} from "../AABB";

/**
 * Bound storage shared by every SpatialIndex implementation: six parallel f32
 * columns plus a batch id and a payload per item.
 *
 * SIX COLUMNS, NOT ONE INTERLEAVED BUFFER. Measured on the intersect test with
 * the query hoisted into locals (µs per 100k boxes, best of 5 after warmup):
 *
 *     plain objects        142.1
 *     subarray views       139.9
 *     flat interleaved      93.7
 *     six SoA columns       74.2
 *
 * STABLE INDICES. Items are never swap-removed; freed slots go on a free list and
 * get reused. Tree implementations hold item indices in their nodes, and a
 * swap-remove would mean fixing those up on every removal. Trading a little
 * density for stable indices makes the octrees dramatically simpler and is why
 * `count` (live) and `capacity` (slots ever used) are separate.
 */
export class ItemStore<P> {
    xMin: Float32Array;
    yMin: Float32Array;
    zMin: Float32Array;
    xMax: Float32Array;
    yMax: Float32Array;
    zMax: Float32Array;
    batch: Int32Array;
    payload: (P | undefined)[];

    /** Slots ever handed out; live items are a subset. */
    private _highWater = 0;
    private _count = 0;
    private _capacity: number;
    // Free list threaded through batch[]: a released slot stores the next free
    // index there, or -1 to end the chain. Batch ids are assigned from 0 upward,
    // so -1 is never a real id and is safe as the sentinel.
    private freeHead = -1;

    constructor(capacity = 64) {
        this._capacity = Math.max(8, capacity);
        this.xMin = new Float32Array(this._capacity);
        this.yMin = new Float32Array(this._capacity);
        this.zMin = new Float32Array(this._capacity);
        this.xMax = new Float32Array(this._capacity);
        this.yMax = new Float32Array(this._capacity);
        this.zMax = new Float32Array(this._capacity);
        this.batch = new Int32Array(this._capacity);
        this.payload = new Array(this._capacity);
    }

    get count(): number {
        return this._count;
    }

    get highWater(): number {
        return this._highWater;
    }

    get capacity(): number {
        return this._capacity;
    }

    /** Store one item, returning its stable index. */
    add(b: AABB, payload: P, batchId: number): number {
        let i: number;
        if (this.freeHead !== -1) {
            i = this.freeHead;
            this.freeHead = this.batch[i]; // link to the next free slot, or -1
        } else {
            if (this._highWater === this._capacity) this.grow();
            i = this._highWater++;
        }

        const raw = AABB.asFloat32Array(b);
        this.xMin[i] = raw[0];
        this.yMin[i] = raw[1];
        this.zMin[i] = raw[2];
        this.xMax[i] = raw[3];
        this.yMax[i] = raw[4];
        this.zMax[i] = raw[5];
        this.batch[i] = batchId;
        this.payload[i] = payload;
        this._count++;
        return i;
    }

    /** Release a slot. The index must not be used again until re-issued by add(). */
    release(index: number): void {
        this.payload[index] = undefined;   // drop the reference so it can be collected
        this.batch[index] = this.freeHead; // -1 when this becomes the only free slot
        this.freeHead = index;
        this._count--;
    }

    clear(): void {
        this.payload.fill(undefined);
        this._count = 0;
        this._highWater = 0;
        this.freeHead = -1;
    }

    private grow(): void {
        const cap = this._capacity * 2;
        const g = (src: Float32Array) => {
            const n = new Float32Array(cap);
            n.set(src);
            return n;
        };
        this.xMin = g(this.xMin);
        this.yMin = g(this.yMin);
        this.zMin = g(this.zMin);
        this.xMax = g(this.xMax);
        this.yMax = g(this.yMax);
        this.zMax = g(this.zMax);
        const b = new Int32Array(cap);
        b.set(this.batch);
        this.batch = b;
        this.payload.length = cap;
        this._capacity = cap;
    }
}
