import {Memory} from "./memory";
import {rawIndexPtr} from "./types/pointer";

export function align8(n: number): number {
    return (n + 7) & ~7;
}

export interface Allocator {
    readonly memory: Memory;

    alloc(bytes: number): rawIndexPtr;

    free(ptr: rawIndexPtr): void;

    realloc(ptr: rawIndexPtr, bytes: number): rawIndexPtr;
}