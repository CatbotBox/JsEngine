import {NULL_PTR, rawIndexPtr} from "./types/pointer";
import {align8, Allocator} from "./allocator";
import {Memory} from "./memory";


export type Handle = number;

const INDEX_BITS = 24;
const INDEX_MASK = (1 << INDEX_BITS) - 1;
const MAX_SLOTS = INDEX_MASK - 1;
export const INVALID_HANDLE: Handle = 0xffffffff;
/** Returned by index-based allocation when the pool cannot grow. */
export const INVALID_INDEX = -1;

function makeHandle(index: number, gen: number): Handle {
    return ((gen << INDEX_BITS) | index) >>> 0;
}

export interface FixedPoolOptions {
    /** Slots per chunk; must be a power of two. Default 1024. */
    slotsPerChunk?: number;
    /** Cap on chunks. Default 1024. */
    maxChunks?: number;
    /** Allocate the first chunk up front. Default true. */
    preallocate?: boolean;
    /** Validate slot indices and handles on access. Default true. */
    debug?: boolean;
}

export class FixedPool {
    readonly stride: number;

    private alloc_: Allocator;
    private mem: Memory;
    private slotsPerChunk: number;
    private chunkShift: number;
    private chunkMask: number;
    private maxChunks: number;
    private debug: boolean;

    // Chunk base offsets. Stored as raw numbers because they live in an
    // Int32Array — cast to/from rawIndexPtr at ptrOf()/addChunk().
    private chunkBase: Int32Array;
    private chunkCount = 0;

    private gens: Uint8Array = new Uint8Array(0);
    private liveBits: Uint32Array = new Uint32Array(0);

    private freeHead = INVALID_INDEX; // free-list head, threaded through slot memory
    private highWater = 0; // slots ever handed out
    private _live = 0;

    constructor(allocator: Allocator, slotBytes: number, opts: FixedPoolOptions = {}) {
        const spc = opts.slotsPerChunk ?? 1024;
        if (spc < 32 || (spc & (spc - 1)) !== 0) {
            throw new Error("slotsPerChunk must be a power of two >= 32");
        }
        this.alloc_ = allocator;
        this.mem = allocator.memory;
        this.stride = align8(Math.max(slotBytes, 4)); // >= 4 bytes to hold the free link
        this.slotsPerChunk = spc;
        this.chunkShift = 31 - Math.clz32(spc);
        this.chunkMask = spc - 1;
        this.maxChunks = opts.maxChunks ?? 1024;
        this.debug = opts.debug !== false;
        this.chunkBase = new Int32Array(this.maxChunks);
        if (opts.preallocate !== false) this.addChunk();
    }

    get live(): number {
        return this._live;
    }

    get capacity(): number {
        return this.chunkCount * this.slotsPerChunk;
    }

    get byteSize(): number {
        return this.chunkCount * this.slotsPerChunk * this.stride;
    }

    /** Byte offset of a slot. Stable for the life of the allocation. */
    ptrOf(index: number): rawIndexPtr {
        const offset =
            this.chunkBase[index >>> this.chunkShift] +
            (index & this.chunkMask) * this.stride;
        return offset as unknown as rawIndexPtr;
    }

    /** Allocate a slot. Returns its index, or INVALID_INDEX if the pool is full. */
    alloc(): number {
        let i = this.freeHead;
        if (i !== INVALID_INDEX) {
            this.freeHead = this.mem.i32[(this.ptrOf(i) as unknown as number) >> 2];
        } else {
            if (this.highWater === this.capacity && !this.addChunk()) return INVALID_INDEX;
            i = this.highWater++;
        }
        this._live++;
        this.liveBits[i >>> 5] |= 1 << (i & 31);
        return i;
    }

    /** Allocate and return a generational handle instead of a bare index. */
    allocHandle(): Handle {
        const i = this.alloc();
        return i === INVALID_INDEX ? INVALID_HANDLE : makeHandle(i, this.gens[i]);
    }

    free(index: number): void {
        if (this.debug && !this.isLive(index)) {
            throw new Error(`FixedPool.free: slot ${index} is not live (double free?)`);
        }
        this.liveBits[index >>> 5] &= ~(1 << (index & 31));
        this.gens[index] = (this.gens[index] + 1) & 0xff; // invalidates outstanding handles
        this.mem.i32[(this.ptrOf(index) as unknown as number) >> 2] = this.freeHead;
        this.freeHead = index;
        this._live--;
    }

    freeHandle(h: Handle): void {
        this.free(this.resolve(h));
    }

    isLive(index: number): boolean {
        return (
            index >= 0 &&
            index < this.highWater &&
            (this.liveBits[index >>> 5] & (1 << (index & 31))) !== 0
        );
    }

    handleOf(index: number): Handle {
        return makeHandle(index, this.gens[index]);
    }

    isValid(h: Handle): boolean {
        const i = h & INDEX_MASK;
        return this.isLive(i) && this.gens[i] === h >>> INDEX_BITS;
    }

    /** Handle -> slot index. Throws on a stale handle when debug is on. */
    resolve(h: Handle): number {
        const i = h & INDEX_MASK;
        if (this.debug && (!this.isLive(i) || this.gens[i] !== h >>> INDEX_BITS)) {
            throw new Error(`FixedPool: stale handle (slot ${i}, gen ${h >>> INDEX_BITS})`);
        }
        return i;
    }

    ptrOfHandle(h: Handle): rawIndexPtr {
        return this.ptrOf(this.resolve(h));
    }

    /**
     * Visit every live slot. Walks the liveness bitset, so cost is proportional
     * to capacity/32 plus the number of live slots — cheap even when sparse.
     * Safe to free the current slot during the walk; do not allocate.
     */
    forEach(fn: (index: number, ptr: rawIndexPtr) => void): void {
        const bits = this.liveBits;
        const words = (this.highWater + 31) >>> 5;
        for (let w = 0; w < words; w++) {
            let m = bits[w];
            while (m !== 0) {
                const low = m & -m;
                const i = (w << 5) | (31 - Math.clz32(low));
                m ^= low;
                fn(i, this.ptrOf(i));
            }
        }
    }

    /** Next live slot at or after `index`, or -1. For manual loops. */
    nextLive(index: number): number {
        if (index < 0) index = 0;
        let w = index >>> 5;
        const words = (this.highWater + 31) >>> 5;
        if (w >= words) return -1;
        let m = this.liveBits[w] & (-1 << (index & 31));
        while (m === 0) {
            if (++w >= words) return -1;
            m = this.liveBits[w];
        }
        const low = m & -m;
        return (w << 5) | (31 - Math.clz32(low));
    }

    /** Drop every allocation. Chunks stay owned, so no heap traffic. */
    clear(): void {
        this.liveBits.fill(0);
        this.freeHead = INVALID_INDEX;
        this.highWater = 0;
        this._live = 0;
    }

    /** Return all chunks to the heap. The pool is unusable afterwards. */
    destroy(): void {
        for (let c = 0; c < this.chunkCount; c++) this.alloc_.free(this.chunkBase[c] as unknown as rawIndexPtr);
        this.chunkCount = 0;
        this.clear();
    }

    private addChunk(): boolean {
        if (this.chunkCount >= this.maxChunks) return false;
        if (this.capacity + this.slotsPerChunk > MAX_SLOTS) return false;
        const base = this.alloc_.alloc(this.slotsPerChunk * this.stride);
        if (base === NULL_PTR) return false;

        this.chunkBase[this.chunkCount++] = base as unknown as number;
        const cap = this.capacity;

        const g = new Uint8Array(cap);
        g.set(this.gens);
        this.gens = g;

        const b = new Uint32Array(cap >>> 5);
        b.set(this.liveBits);
        this.liveBits = b;
        return true;
    }
}

// ===========================================================================
// PackedPool — dense storage, swap-remove, handle indirection
// ===========================================================================

export interface PackedPoolOptions {
    /** Double capacity when full (reallocates the block). Default true. */
    growable?: boolean;
    /** Cap on capacity when growing. Default 1 << 20. */
    maxCapacity?: number;
    /** Validate handles on access. Default true. */
    debug?: boolean;
}

export class PackedPool {
    readonly stride: number;

    private alloc_: Allocator;
    private mem: Memory;
    private _base: rawIndexPtr;
    private _capacity: number;
    private _count = 0;
    private growable: boolean;
    private maxCapacity: number;
    private debug: boolean;

    private sparse: Int32Array; // handle index -> dense slot (or free-list link)
    private dense: Int32Array; // dense slot -> handle index
    private gens: Uint8Array;
    private freeHead = INVALID_INDEX;
    private highWater = 0;

    constructor(allocator: Allocator, slotBytes: number, capacity: number, opts: PackedPoolOptions = {}) {
        this.alloc_ = allocator;
        this.mem = allocator.memory;
        this.stride = align8(Math.max(slotBytes, 1));
        this._capacity = capacity;
        this.growable = opts.growable !== false;
        this.maxCapacity = opts.maxCapacity ?? 1 << 20;
        this.debug = opts.debug !== false;

        this._base = allocator.alloc(this.stride * capacity);
        if (this._base === NULL_PTR) throw new Error("PackedPool: heap out of memory");

        this.sparse = new Int32Array(capacity);
        this.dense = new Int32Array(capacity);
        this.gens = new Uint8Array(capacity);
    }

    /** Byte offset of the dense array. CHANGES on grow — never cache it. */
    get base(): rawIndexPtr {
        return this._base;
    }

    get count(): number {
        return this._count;
    }

    get capacity(): number {
        return this._capacity;
    }

    /** Byte offset of dense slot i, for i in [0, count). */
    ptrAt(slot: number): rawIndexPtr {
        return ((this._base as unknown as number) + slot * this.stride) as unknown as rawIndexPtr;
    }

    alloc(): Handle {
        if (this._count === this._capacity && !this.grow()) return INVALID_HANDLE;

        let hi = this.freeHead;
        if (hi !== INVALID_INDEX) this.freeHead = this.sparse[hi];
        else hi = this.highWater++;

        const slot = this._count++;
        this.sparse[hi] = slot;
        this.dense[slot] = hi;
        return makeHandle(hi, this.gens[hi]);
    }

    free(h: Handle): void {
        const hi = this.resolveIndex(h);
        const slot = this.sparse[hi];
        const last = --this._count;

        if (slot !== last) {
            // Move the tail item into the hole to keep [0, count) dense.
            const u8 = this.mem.u8;
            const baseOff = this._base as unknown as number;
            const dst = baseOff + slot * this.stride;
            const src = baseOff + last * this.stride;
            u8.copyWithin(dst, src, src + this.stride);

            const movedHi = this.dense[last];
            this.dense[slot] = movedHi;
            this.sparse[movedHi] = slot; // the moved item keeps its handle
        }

        this.gens[hi] = (this.gens[hi] + 1) & 0xff;
        this.sparse[hi] = this.freeHead;
        this.freeHead = hi;
    }

    isValid(h: Handle): boolean {
        const hi = h & INDEX_MASK;
        if (hi >= this.highWater || this.gens[hi] !== h >>> INDEX_BITS) return false;
        const slot = this.sparse[hi];
        return slot >= 0 && slot < this._count && this.dense[slot] === hi;
    }

    /** Handle -> dense slot. The slot moves when other items are freed. */
    slotOf(h: Handle): number {
        return this.sparse[this.resolveIndex(h)];
    }

    ptrOf(h: Handle): rawIndexPtr {
        return ((this._base as unknown as number) + this.sparse[this.resolveIndex(h)] * this.stride) as unknown as rawIndexPtr;
    }

    /** Handle for the item currently in dense slot `slot`. */
    handleAt(slot: number): Handle {
        const hi = this.dense[slot];
        return makeHandle(hi, this.gens[hi]);
    }

    clear(): void {
        this._count = 0;
        this.freeHead = INVALID_INDEX;
        this.highWater = 0;
        this.gens.fill(0);
    }

    destroy(): void {
        this.alloc_.free(this._base);
        this._base = NULL_PTR;
        this._count = 0;
    }

    private resolveIndex(h: Handle): number {
        const hi = h & INDEX_MASK;
        if (this.debug && !this.isValid(h)) {
            throw new Error(`PackedPool: stale handle (slot ${hi}, gen ${h >>> INDEX_BITS})`);
        }
        return hi;
    }

    private grow(): boolean {
        if (!this.growable || this._capacity >= this.maxCapacity) return false;
        const cap = Math.min(this._capacity * 2, this.maxCapacity);

        // realloc keeps the bytes; the offset may move, which is exactly why
        // callers hold handles rather than pointers.
        const np = this.alloc_.realloc(this._base, cap * this.stride);
        if (np === NULL_PTR) return false;
        this._base = np;
        this._capacity = cap;

        const s = new Int32Array(cap);
        s.set(this.sparse);
        this.sparse = s;
        const d = new Int32Array(cap);
        d.set(this.dense);
        this.dense = d;
        const g = new Uint8Array(cap);
        g.set(this.gens);
        this.gens = g;
        return true;
    }
}

export class SoAStore {
    private alloc_: Allocator;
    private mem: Memory;
    private ptrs: rawIndexPtr[] = [];
    private elemBytes: number[] = [];
    private _capacity: number;
    private _count = 0;

    constructor(allocator: Allocator, capacity: number) {
        this.alloc_ = allocator;
        this.mem = allocator.memory;
        this._capacity = capacity;
    }

    get count(): number {
        return this._count;
    }

    get capacity(): number {
        return this._capacity;
    }

    /** Add a column; returns its id. Call all addColumn()s before allocating. */
    addColumn(bytesPerElement: number): number {
        const p = this.alloc_.alloc(bytesPerElement * this._capacity);
        if (p === NULL_PTR) throw new Error("SoAStore: heap out of memory");
        this.ptrs.push(p);
        this.elemBytes.push(bytesPerElement);
        return this.ptrs.length - 1;
    }

    /** Base byte offset of a column. Re-read after grow(). */
    columnPtr(col: number): rawIndexPtr {
        return this.ptrs[col];
    }

    /** Float32 view over a column, valid for [0, capacity). */
    f32Column(col: number): Float32Array {
        return this.mem.f32At(this.ptrs[col], this._capacity);
    }

    i32Column(col: number): Int32Array {
        return this.mem.i32At(this.ptrs[col], this._capacity);
    }

    /** Append an item; returns its index, or -1 if full. */
    push(): number {
        if (this._count === this._capacity && !this.grow()) return INVALID_INDEX;
        return this._count++;
    }

    /** Swap-remove: the last item moves into `index`. Returns the moved index. */
    remove(index: number): number {
        const last = --this._count;
        if (index !== last) {
            const u8 = this.mem.u8;
            for (let c = 0; c < this.ptrs.length; c++) {
                const eb = this.elemBytes[c];
                const base = this.ptrs[c] as unknown as number;
                const src = base + last * eb;
                u8.copyWithin(base + index * eb, src, src + eb);
            }
        }
        return last;
    }

    private grow(): boolean {
        const cap = this._capacity * 2;
        for (let c = 0; c < this.ptrs.length; c++) {
            const np = this.alloc_.realloc(this.ptrs[c], this.elemBytes[c] * cap);
            if (np === NULL_PTR) return false;
            this.ptrs[c] = np;
        }
        this._capacity = cap;
        return true;
    }
}
