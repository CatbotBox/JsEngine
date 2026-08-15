import {Memory} from "./memory";
import {align8, Allocator} from "./allocator";
import {NULL_PTR, ptr, rawIndexPtr} from "./types/pointer";


/**
 * Block layout (sizes are multiples of 8):
 *   [ header i32 ][ payload ... ][ footer i32 ]
 *   header/footer = blockSize | USED
 *   free blocks reuse the first 8 payload bytes as next/prev list links
 *
 * Payloads land on 8-byte boundaries because the region base is 8-aligned,
 * the first header sits at base+4, and every block size is a multiple of 8.
 *
 * NOT thread-safe. One heap per worker, or an Atomics lock around alloc/free.
 */

const HEADER = 4;
const FOOTER = 4;
const OVERHEAD = HEADER + FOOTER;
const MIN_BLOCK = 16; // header + next + prev + footer
const USED = 1;
const SIZE_MASK = ~7; // block sizes are multiples of 8 -> 3 spare low bits
const NBINS = 28; // bin i covers sizes [2^(i+4), 2^(i+5))

/**
 * "No block" sentinel for the free-list bookkeeping below. Block header
 * addresses here are raw byte offsets read straight out of an Int32Array
 * (next/prev links, bin heads) — internal plumbing, never handed to a
 * caller — so this is deliberately a plain number, distinct from NULL_PTR
 * (the branded rawIndexPtr callers see from alloc()/free()).
 */
const NO_BLOCK = 0;

function binIndex(size: number): number {
    const b = 31 - Math.clz32(size) - 4;
    return b < NBINS ? b : NBINS - 1;
}

export interface HeapOptions {
    /** Extend the region when full. Only possible if it's Memory's tail region. */
    growable?: boolean;
    /** Zero-fill payloads on alloc. Off by default (costs a memset). */
    zeroOnAlloc?: boolean;
    /** Throw on double free / bad pointer. Cheap; leave on outside ship builds. */
    debug?: boolean;
}

export interface HeapStats {
    capacity: number;
    used: number;
    free: number;
    liveBlocks: number;
    largestFree: number;
}

export class Heap implements Allocator {
    readonly memory: Memory;
    readonly base: rawIndexPtr;

    private end: number; // one past the last byte of the region (plain offset)
    private bins = new Int32Array(NBINS);
    private binMask = 0;
    private growable: boolean;
    private zeroOnAlloc: boolean;
    private debug: boolean;
    private usedBytes = 0;
    private liveBlocks = 0;

    constructor(memory: Memory, size: number, opts: HeapOptions = {}) {
        const base = memory.reserve(size);
        if (base === NULL_PTR) throw new Error("Heap: memory exhausted");
        const baseOff = base as unknown as number;
        this.memory = memory;
        this.base = base;
        this.end = baseOff + align8(size);
        this.growable = !!opts.growable;
        if (this.growable && !memory.canExtend(baseOff, this.end - baseOff)) {
            throw new Error(
                "Heap: growable requires this to be Memory's last region and Memory to " +
                "have a maxByteLength. Reserve the heap after every stack, or use createLayout().",
            );
        }
        this.zeroOnAlloc = !!opts.zeroOnAlloc;
        this.debug = opts.debug !== false;

        const i32 = memory.i32;
        i32[baseOff >> 2] = USED; // prologue footer: size 0, used -> stops left coalescing
        i32[(this.end - 4) >> 2] = USED; // epilogue header -> stops right coalescing

        const h = baseOff + HEADER;
        this.writeTags(h, this.end - 4 - h, 0);
        this.insertFree(h);
    }

    /** Convenience: build a Memory and a Heap that fills it. */
    static standalone(byteLength: number, opts: HeapOptions & { maxByteLength?: number } = {}): Heap {
        const mem = new Memory(byteLength + 8, {maxByteLength: opts.maxByteLength});
        return new Heap(mem, byteLength, {...opts, growable: !!opts.maxByteLength});
    }

    // Views live on Memory and are rebound when the buffer resizes, so always
    // read them through this.memory rather than caching one.
    get u8(): Uint8Array {
        return this.memory.u8;
    }

    get i32(): Int32Array {
        return this.memory.i32;
    }

    get f32(): Float32Array {
        return this.memory.f32;
    }

    get f64(): Float64Array {
        return this.memory.f64;
    }

    get capacity(): number {
        return this.end - (this.base as unknown as number);
    }

    f32At(ptr: rawIndexPtr, count: number): Float32Array {
        return this.memory.f32At(ptr, count);
    }

    i32At(ptr: rawIndexPtr, count: number): Int32Array {
        return this.memory.i32At(ptr, count);
    }

    u8At(ptr: rawIndexPtr, count: number): Uint8Array {
        return this.memory.u8At(ptr, count);
    }

    f64At(ptr: rawIndexPtr, count: number): Float64Array {
        return this.memory.f64At(ptr, count);
    }

    // ---------------------------------------------------------------- alloc

    alloc(bytes: number): rawIndexPtr {
        let need = (bytes + OVERHEAD + 7) & ~7;
        if (need < MIN_BLOCK) need = MIN_BLOCK;

        let h = this.findFit(need);
        if (h === NO_BLOCK) {
            if (!this.grow(need)) return NULL_PTR;
            h = this.findFit(need);
            if (h === NO_BLOCK) return NULL_PTR;
        }

        const i32 = this.memory.i32;
        this.removeFree(h);
        const size = i32[h >> 2] & SIZE_MASK;
        const rem = size - need;

        if (rem >= MIN_BLOCK) {
            this.writeTags(h, need, USED);
            this.writeTags(h + need, rem, 0);
            this.insertFree(h + need);
            this.usedBytes += need;
        } else {
            this.writeTags(h, size, USED);
            this.usedBytes += size;
        }

        this.liveBlocks++;
        const ptr = h + HEADER;
        if (this.zeroOnAlloc) {
            this.memory.u8.fill(0, ptr, h + (i32[h >> 2] & SIZE_MASK) - FOOTER);
        }
        return ptr as unknown as rawIndexPtr;
    }

    allocF32(count: number): ptr<"f32Array"> {
        return this.alloc(count << 2) as ptr<"f32Array">;
    }

    allocI32(count: number): ptr<"i32Array"> {
        return this.alloc(count << 2) as ptr<"i32Array">;
    }

    allocU32(count: number): rawIndexPtr {
        return this.alloc(count << 2);
    }

    allocF64(count: number): rawIndexPtr {
        return this.alloc(count << 3);
    }

    allocU8(count: number): rawIndexPtr {
        return this.alloc(count);
    }

    /** Usable payload bytes at `ptr` (>= what you asked for, due to rounding). */
    sizeOf(ptr: rawIndexPtr): number {
        return (this.memory.i32[((ptr as unknown as number) - HEADER) >> 2] & SIZE_MASK) - OVERHEAD;
    }

    /** True if `ptr` is inside this heap's region — useful when mixing allocators. */
    owns(ptr: rawIndexPtr): boolean {
        const p = ptr as unknown as number;
        return p > (this.base as unknown as number) && p < this.end;
    }

    // ----------------------------------------------------------------- free

    free(ptr: rawIndexPtr): void {
        if (ptr === NULL_PTR) return;
        const i32 = this.memory.i32;
        let h = (ptr as unknown as number) - HEADER;

        if (this.debug) {
            const baseOff = this.base as unknown as number;
            if (h < baseOff + HEADER || h >= this.end - 4 || ((h - baseOff) & 7) !== 4) {
                throw new Error(`Heap.free: pointer ${ptr} is not from this heap`);
            }
            if ((i32[h >> 2] & USED) === 0) {
                throw new Error(`Heap.free: double free or corrupt block at ${ptr}`);
            }
        }

        let size = i32[h >> 2] & SIZE_MASK;
        this.usedBytes -= size;
        this.liveBlocks--;

        const nh = h + size;
        const nhdr = i32[nh >> 2];
        if ((nhdr & USED) === 0) {
            this.removeFree(nh);
            size += nhdr & SIZE_MASK;
        }

        const pftr = i32[(h - FOOTER) >> 2];
        if ((pftr & USED) === 0) {
            const psize = pftr & SIZE_MASK;
            h -= psize;
            this.removeFree(h);
            size += psize;
        }

        this.writeTags(h, size, 0);
        this.insertFree(h);
    }

    realloc(ptr: rawIndexPtr, bytes: number): rawIndexPtr {
        if (ptr === NULL_PTR) return this.alloc(bytes);

        const i32 = this.memory.i32;
        const p = ptr as unknown as number;
        const h = p - HEADER;
        const size = i32[h >> 2] & SIZE_MASK;
        let need = (bytes + OVERHEAD + 7) & ~7;
        if (need < MIN_BLOCK) need = MIN_BLOCK;

        if (need <= size) {
            const rem = size - need;
            if (rem >= MIN_BLOCK) {
                this.writeTags(h, need, USED);
                this.writeTags(h + need, rem, USED); // hand the tail to free() as a live block
                this.liveBlocks++;
                this.free((h + need + HEADER) as unknown as rawIndexPtr);
            }
            return ptr;
        }

        const nh = h + size;
        const nhdr = i32[nh >> 2];
        if ((nhdr & USED) === 0 && size + (nhdr & SIZE_MASK) >= need) {
            this.removeFree(nh);
            let total = size + (nhdr & SIZE_MASK);
            const rem = total - need;
            if (rem >= MIN_BLOCK) {
                this.writeTags(h, need, USED);
                this.writeTags(h + need, rem, 0);
                this.insertFree(h + need);
                total = need;
            } else {
                this.writeTags(h, total, USED);
            }
            this.usedBytes += total - size;
            return ptr;
        }

        const np = this.alloc(bytes);
        if (np === NULL_PTR) return NULL_PTR;
        const npOff = np as unknown as number;
        this.memory.u8.copyWithin(npOff, p, p + size - OVERHEAD);
        this.free(ptr);
        return np;
    }

    // --------------------------------------------------------------- growth

    private grow(need: number): boolean {
        if (!this.growable) return false;
        const baseOff = this.base as unknown as number;
        const size = this.end - baseOff;
        let add = align8(need + MIN_BLOCK);
        if (add < size) add = size; // double, at minimum
        if (!this.memory.extend(baseOff, size, add)) return false;

        const i32 = this.memory.i32;
        const h = this.end - 4; // the old epilogue becomes a real block header
        this.end += add;
        i32[(this.end - 4) >> 2] = USED;
        this.writeTags(h, add, USED);
        this.usedBytes += add;
        this.liveBlocks++;
        this.free((h + HEADER) as unknown as rawIndexPtr); // reuse free()'s left-coalescing
        return true;
    }

    // ------------------------------------------------------------ internals

    private writeTags(h: number, size: number, flags: number): void {
        const tag = size | flags;
        const i32 = this.memory.i32;
        i32[h >> 2] = tag;
        i32[(h + size - FOOTER) >> 2] = tag;
    }

    private findFit(need: number): number {
        const i32 = this.memory.i32;
        const bin = binIndex(need);
        let n = this.bins[bin];
        while (n !== NO_BLOCK) {
            if ((i32[n >> 2] & SIZE_MASK) >= need) return n;
            n = i32[(n >> 2) + 1];
        }
        const mask = this.binMask & (-1 << (bin + 1));
        if (mask === 0) return NO_BLOCK;
        const low = mask & -mask;
        return this.bins[31 - Math.clz32(low)];
    }

    private insertFree(h: number): void {
        const i32 = this.memory.i32;
        const bin = binIndex(i32[h >> 2] & SIZE_MASK);
        const head = this.bins[bin];
        const w = h >> 2;
        i32[w + 1] = head;
        i32[w + 2] = NO_BLOCK;
        if (head !== NO_BLOCK) i32[(head >> 2) + 2] = h;
        this.bins[bin] = h;
        this.binMask |= 1 << bin;
    }

    private removeFree(h: number): void {
        const i32 = this.memory.i32;
        const w = h >> 2;
        const next = i32[w + 1];
        const prev = i32[w + 2];
        if (prev !== NO_BLOCK) i32[(prev >> 2) + 1] = next;
        else {
            const bin = binIndex(i32[w] & SIZE_MASK);
            this.bins[bin] = next;
            if (next === NO_BLOCK) this.binMask &= ~(1 << bin);
        }
        if (next !== NO_BLOCK) i32[(next >> 2) + 2] = prev;
    }

    // -------------------------------------------------------------- tooling

    stats(): HeapStats {
        const i32 = this.memory.i32;
        let largest = 0;
        for (let h = (this.base as unknown as number) + HEADER; h < this.end - 4;) {
            const hdr = i32[h >> 2];
            const size = hdr & SIZE_MASK;
            if ((hdr & USED) === 0 && size > largest) largest = size;
            h += size;
        }
        return {
            capacity: this.capacity,
            used: this.usedBytes,
            free: this.capacity - 8 - this.usedBytes,
            liveBlocks: this.liveBlocks,
            largestFree: largest > 0 ? largest - OVERHEAD : 0,
        };
    }

    /** Full walk: verifies tags, sizes and free-list membership. Dev builds only. */
    validate(): void {
        const i32 = this.memory.i32;
        let h = (this.base as unknown as number) + HEADER;
        let free = 0;
        let used = 0;
        while (h < this.end - 4) {
            const hdr = i32[h >> 2];
            const size = hdr & SIZE_MASK;
            if (size < MIN_BLOCK || h + size > this.end - 4) {
                throw new Error(`corrupt block header at ${h}: size ${size}`);
            }
            if (i32[(h + size - FOOTER) >> 2] !== hdr) {
                throw new Error(`header/footer mismatch at ${h}`);
            }
            if (hdr & USED) used += size;
            else {
                free++;
                const nhdr = i32[(h + size) >> 2];
                if ((nhdr & USED) === 0 && (nhdr & SIZE_MASK) !== 0) {
                    throw new Error(`adjacent free blocks at ${h} — coalescing broken`);
                }
            }
            h += size;
        }
        if (h !== this.end - 4) throw new Error(`block walk ended at ${h}`);
        if (used !== this.usedBytes) {
            throw new Error(`usedBytes ${this.usedBytes} != walked ${used}`);
        }
        let listed = 0;
        for (let b = 0; b < NBINS; b++) {
            for (let n = this.bins[b]; n !== NO_BLOCK; n = i32[(n >> 2) + 1]) {
                if (i32[n >> 2] & USED) throw new Error(`used block ${n} in bin ${b}`);
                if (binIndex(i32[n >> 2] & SIZE_MASK) !== b) throw new Error(`block ${n} in wrong bin`);
                listed++;
            }
        }
        if (listed !== free) throw new Error(`${free} free blocks, ${listed} in bins`);
    }
}
