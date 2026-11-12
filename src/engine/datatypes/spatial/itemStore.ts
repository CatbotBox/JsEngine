import {AABB} from "../aabb";

const DEFAULT_CAPACITY = 64;
const MIN_CAPACITY = 8;
const END_OF_FREE_LIST = -1;

export class ItemStore<P> {
    xMin: Float32Array;
    yMin: Float32Array;
    zMin: Float32Array;
    xMax: Float32Array;
    yMax: Float32Array;
    zMax: Float32Array;
    batch: Int32Array;
    payload: (P | undefined)[];

    private _slotsEverIssued = 0;
    private _count = 0;
    private _capacity: number;
    private freeListHeadInBatch = END_OF_FREE_LIST;

    constructor(capacity = DEFAULT_CAPACITY) {
        this._capacity = Math.max(MIN_CAPACITY, capacity);
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


    get capacity(): number {
        return this._capacity;
    }

    add(b: AABB, payload: P, batchId: number): number {
        let i: number;
        if (this.freeListHeadInBatch !== END_OF_FREE_LIST) {
            i = this.freeListHeadInBatch;
            this.freeListHeadInBatch = this.batch[i];
        } else {
            if (this._slotsEverIssued === this._capacity) this.grow();
            i = this._slotsEverIssued++;
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

    release(index: number): void {
        this.payload[index] = undefined;
        this.batch[index] = this.freeListHeadInBatch;
        this.freeListHeadInBatch = index;
        this._count--;
    }

    clear(): void {
        this.payload.fill(undefined);
        this._count = 0;
        this._slotsEverIssued = 0;
        this.freeListHeadInBatch = END_OF_FREE_LIST;
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
