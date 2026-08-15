import {Memory} from "./memory";
import {NULL_PTR, rawIndexPtr} from "./types/pointer";
import {align8} from "./allocator";

export class DoubleStack {
    readonly memory: Memory;
    readonly base: rawIndexPtr;

    private frontTop: number;
    private backTop: number;
    private end: number;
    private peakF = 0;
    private peakB = 0;

    // Arrow-function fields, not methods: they get handed to StackScope as bare
    // callbacks, so they must already be bound to this DoubleStack instance.
    // A plain method reference (`this.allocFront`) is unbound — calling it via
    // StackScope's `this.allocate(bytes)` would run it with `this` pointing at
    // the StackScope, not this DoubleStack, silently reading undefined cursors.
    private allocFront = (bytes: number): rawIndexPtr => {
        const p = this.frontTop;
        const next = (p + bytes + 7) & ~7;
        if (next > this.backTop) return NULL_PTR;
        this.frontTop = next;
        const baseOff = this.base as unknown as number;
        if (next - baseOff > this.peakF) this.peakF = next - baseOff;
        return p as unknown as rawIndexPtr;
    };

    private allocBack = (bytes: number): rawIndexPtr => {
        const p = (this.backTop - bytes) & ~7;
        if (p < this.frontTop) return NULL_PTR;
        this.backTop = p;
        if (this.end - p > this.peakB) this.peakB = this.end - p;
        return p as unknown as rawIndexPtr;
    };

    private markFront = (): rawIndexPtr => {
        return this.frontTop as unknown as rawIndexPtr;
    };

    private markBack = (): rawIndexPtr => {
        return this.backTop as unknown as rawIndexPtr;
    };

    private releaseFront = (mark: rawIndexPtr): void => {
        this.frontTop = mark as unknown as number;
    };

    private releaseBack = (mark: rawIndexPtr): void => {
        this.backTop = mark as unknown as number;
    };

    // These fields are declared after the arrow functions above on purpose:
    // instance field initializers run top-to-bottom, and scopeFront/scopeBack
    // capture allocFront/markFront/releaseFront at construction time.
    private scopeFront: StackScope = new StackScope(this.allocFront, this.markFront, this.releaseFront)
    private scopeBack: StackScope = new StackScope(this.allocBack, this.markBack, this.releaseBack)

    constructor(memory: Memory, size: number) {
        const base = memory.reserve(size);
        if (base === NULL_PTR) throw new Error("DoubleStack: memory exhausted");
        const baseOff = base as unknown as number;
        this.memory = memory;
        this.base = base;
        this.end = baseOff + align8(size);
        this.frontTop = baseOff;
        this.backTop = this.end;
    }

    get frontUsed(): number {
        return this.frontTop - (this.base as unknown as number);
    }

    get backUsed(): number {
        return this.end - this.backTop;
    }

    get free(): number {
        return this.backTop - this.frontTop;
    }

    get peakFront(): number {
        return this.peakF;
    }

    get peakBack(): number {
        return this.peakB;
    }

    private resetFront(): void {
        this.frontTop = this.base as unknown as number;
    }

    private resetBack(): void {
        this.backTop = this.end;
    }

    /** Front-facing Allocator view, for APIs that take an Allocator. */
    front(): StackScope {
        return this.scopeFront;
    }

    /** Back-facing Allocator view. */
    back(): StackScope {
        return this.scopeBack;
    }
}

export class StackScope {
    private inScope: boolean = false;
    private isDiscarded: boolean = false;
    private readonly allocate: (bytes: number) => rawIndexPtr;
    private readonly mark: () => rawIndexPtr;
    private readonly release: (mark: rawIndexPtr) => void;


    public constructor(allocate: (bytes: number) => rawIndexPtr, mark: () => rawIndexPtr, release: (mark: rawIndexPtr) => void) {
        this.allocate = allocate;
        this.mark = mark;
        this.release = release;
    }

    private alloc(bytes: number): rawIndexPtr {
        if (!this.inScope && this.isDiscarded) {
            throw new Error("This stack is no longer in scope");
        }
        return this.allocate(bytes);
    }

    /** Run fn with a scoped mark, releasing even if fn throws. */
    scope<T>(fn: (a: StackScope) => T): T {
        if (!this.inScope && this.isDiscarded) {
            throw new Error("This stack is no longer in scope");
        }
        const newScope = new StackScope(this.allocate, this.mark, this.release);
        newScope.inScope = true;
        const m = this.mark();
        try {
            return fn(newScope);
        } finally {
            newScope.inScope = false;
            newScope.isDiscarded = true;
            this.release(m);
        }
    }


    allocF32(count: number): rawIndexPtr {
        return this.alloc(count << 2);
    }

    allocI32(count: number): rawIndexPtr {
        return this.alloc(count << 2);
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
}
