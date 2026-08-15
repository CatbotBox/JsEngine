import {align8} from "./allocator";
import {NULL_PTR, rawIndexPtr} from "./types/pointer";
import {PointerKindRegistry} from "./types/pointerRegistry";

export interface MemoryOptions {
    /** Enable growth up to this many bytes (resizable ArrayBuffer). */
    maxByteLength?: number;
}


export type GrowthMode = "auto" | "resize" | "transfer" | "none";

export interface MemoryOptions {
    /** Enable growth up to this many bytes (resizable ArrayBuffer). */
    maxByteLength?: number;
    /** Default: "none" without maxByteLength, "auto" with it. */
    growth?: GrowthMode;
    /** Called after every successful growth. Log this — it is your leak detector. */
    onGrow?: (from: number, to: number) => void;
}

export class Memory {
    buffer: ArrayBuffer;

    // Views
    u8!: Uint8Array;
    i32!: Int32Array;
    u32!: Uint32Array;
    f32!: Float32Array;
    f64!: Float64Array;

    private cursor = 8; // leave [0,8) unused so NULL === 0 is unambiguous
    private readonly maxByteLength: number;
    private readonly onGrow?: (from: number, to: number) => void;
    readonly growth: GrowthMode;

    readonly pointerKinds: PointerKindRegistry;

    constructor(byteLength: number, opts: MemoryOptions = {}) {
        const cap = align8(byteLength);
        this.maxByteLength = opts.maxByteLength ? align8(opts.maxByteLength) : 0;
        this.onGrow = opts.onGrow;
        this.pointerKinds = new PointerKindRegistry(this);

        const canTransfer = typeof (ArrayBuffer.prototype as any).transfer === "function";
        let want = opts.growth ?? (this.maxByteLength > cap ? "auto" : "none");
        if (want === "auto") want = canTransfer ? "transfer" : "resize";
        if (want === "transfer" && !canTransfer) want = "resize";

        if (want === "resize" && this.maxByteLength > cap) {
            try {
                this.buffer = new ArrayBuffer(cap, {maxByteLength: this.maxByteLength} as any);
                this.growth = "resize";
            } catch {
                // Reservation refused. Fall back rather than dying at boot.
                this.buffer = new ArrayBuffer(cap);
                this.growth = canTransfer ? "transfer" : "none";
            }
        } else {
            this.buffer = new ArrayBuffer(cap);
            this.growth = want === "transfer" ? "transfer" : "none";
        }
        this.rebindViews();
    }


    get byteLength(): number {
        return this.buffer.byteLength;
    }

    get reserved(): number {
        return this.cursor - 8;
    }

    get available(): number {
        return Math.max(this.maxByteLength, this.byteLength) - this.cursor;
    }

    private rebindViews(): void {
        const b = this.buffer;
        this.u8 = new Uint8Array(b);
        this.i32 = new Int32Array(b);
        this.u32 = new Uint32Array(b);
        this.f32 = new Float32Array(b);
        this.f64 = new Float64Array(b);
    }

    reserve(bytes: number): rawIndexPtr {
        const size = align8(bytes);
        if (this.cursor + size > this.byteLength && !this.expand(this.cursor + size)) {
            return NULL_PTR;
        }
        const base = this.cursor;
        this.cursor += size;
        return base as unknown as rawIndexPtr;
    }

    canExtend(base: number, size: number): boolean {
        if (base + size !== this.cursor || this.growth === "none") return false;
        return this.maxByteLength === 0 || this.maxByteLength > this.byteLength;
    }

    ensureHeadroom(bytes: number): boolean {
        const needed = this.cursor + align8(bytes);
        return needed <= this.byteLength || this.expand(needed);
    }

    extend(base: number, size: number, extra: number): boolean {
        if (base + size !== this.cursor) return false;
        const add = align8(extra);
        if (this.cursor + add > this.byteLength && !this.expand(this.cursor + add)) {
            return false;
        }
        this.cursor += add;
        return true;
    }

    private expand(needed: number): boolean {
        if (this.growth === "none") return false;
        const ceiling = this.maxByteLength || Number.MAX_SAFE_INTEGER;
        if (this.byteLength >= ceiling) return false;

        const from = this.byteLength;
        let cap = from;
        while (cap < needed && cap < ceiling) cap = Math.min(cap * 2, ceiling);
        if (cap < needed) return false;

        if (this.growth === "resize") {
            (this.buffer as any).resize(cap);
        } else {
            // transfer preserves byte offsets and detaches the old buffer; every
            // pointer stays valid, which is why views are centralized here.
            this.buffer = (this.buffer as any).transfer(cap);
        }
        if (cap < needed) return false;
        (this.buffer as any).resize(cap);
        this.rebindViews();
        this.onGrow?.(from, cap);
        return true;
    }

    // Views over an allocation. These mint a JS object per call — fine at setup,
    // not in a hot loop. Index the shared views directly there.
    f32At(ptr: rawIndexPtr, count: number): Float32Array {
        return new Float32Array(this.buffer, ptr as unknown as number, count);
    }

    i32At(ptr: rawIndexPtr, count: number): Int32Array {
        return new Int32Array(this.buffer, ptr as unknown as number, count);
    }

    u32At(ptr: rawIndexPtr, count: number): Uint32Array {
        return new Uint32Array(this.buffer, ptr as unknown as number, count);
    }

    u8At(ptr: rawIndexPtr, count: number): Uint8Array {
        return new Uint8Array(this.buffer, ptr as unknown as number, count);
    }

    f64At(ptr: rawIndexPtr, count: number): Float64Array {
        return new Float64Array(this.buffer, ptr as unknown as number, count);
    }
}