import type {Memory} from "../memory";

export type rawIndexPtr = { __rawIndexPointer: true }

export interface MemoryPointerHandler<T> {
    readonly stride: number;

    get(pointer: ptr<T>, out: T): T;

    set(pointer: ptr<T>, value: T): void;

    getRW(pointer: ptr<T>, out: T): T;
}

export class NullPointerHandler implements MemoryPointerHandler<null> {
    readonly stride = 0;

    get(pointer: ptr<null>, out: null): null {
        return null;
    }

    set(pointer: ptr<null>, value: null): void {
        // Do nothing or throw an error
    }

    getRW(pointer: ptr<null>, out: null): null {
        return null;
    }
}

export class F32PointerHandler implements MemoryPointerHandler<number> {
    readonly stride = 4;

    constructor(private readonly memory: Memory) {
    }

    get(pointer: ptr<number>, out: number): number {
        return this.memory.f32[(pointer as unknown as number) >> 2];
    }

    getRW(pointer: ptr<number>, out: number): number {
        return this.get(pointer, out);
    }

    set(pointer: ptr<number>, value: number): void {
        this.memory.f32[(pointer as unknown as number) >> 2] = value;
    }
}

export class I32PointerHandler implements MemoryPointerHandler<number> {
    readonly stride = 4;

    constructor(private readonly memory: Memory) {
    }

    get(pointer: ptr<number>, out: number): number {
        return this.memory.i32[(pointer as unknown as number) >> 2];
    }

    getRW(pointer: ptr<number>, out: number): number {
        return this.get(pointer, out);
    }

    set(pointer: ptr<number>, value: number): void {
        this.memory.i32[(pointer as unknown as number) >> 2] = value;
    }
}

export class U32PointerHandler implements MemoryPointerHandler<number> {
    readonly stride = 4;

    constructor(private readonly memory: Memory) {
    }

    get(pointer: ptr<number>, out: number): number {
        return this.memory.u32[(pointer as unknown as number) >> 2];
    }

    getRW(pointer: ptr<number>, out: number): number {
        return this.get(pointer, out);
    }

    set(pointer: ptr<number>, value: number): void {
        this.memory.u32[(pointer as unknown as number) >> 2] = value;
    }
}

export class F64PointerHandler implements MemoryPointerHandler<number> {
    readonly stride = 8;

    constructor(private readonly memory: Memory) {
    }

    get(pointer: ptr<number>, out: number): number {
        return this.memory.f64[(pointer as unknown as number) >> 3];
    }

    getRW(pointer: ptr<number>, out: number): number {
        return this.get(pointer, out);
    }

    set(pointer: ptr<number>, value: number): void {
        this.memory.f64[(pointer as unknown as number) >> 3] = value;
    }
}

/**
 * One byte per instance — align8() still rounds every create() up to 8
 * bytes of payload plus TAG_SIZE (8) more for the kind tag, so routing single
 * bytes through the registry costs 16 bytes to store 1. Fine for a handful of
 * flags; batch bytes into your own struct (or a plain Heap/StackScope alloc)
 * instead of minting one of these per byte in a loop.
 */
export class U8PointerHandler implements MemoryPointerHandler<number> {
    readonly stride = 1;

    constructor(private readonly memory: Memory) {
    }

    get(pointer: ptr<number>, out: number): number {
        return this.memory.u8[pointer as unknown as number];
    }

    getRW(pointer: ptr<number>, out: number): number {
        return this.get(pointer, out);
    }

    set(pointer: ptr<number>, value: number): void {
        this.memory.u8[pointer as unknown as number] = value;
    }
}

export type ptr<T> = rawIndexPtr & { __ptrType: T }

export type null_ptr = ptr<null>;

/**
 * This is used over null as null auto-converts to 0 when "saved" as a pointer
 */
export const NULL_PTR: null_ptr = 0 as unknown as null_ptr;

export namespace ptr {

}