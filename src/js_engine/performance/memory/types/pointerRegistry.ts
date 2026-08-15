import type {Memory} from "../memory";
import {align8} from "../allocator";
import {
    F32PointerHandler,
    F64PointerHandler,
    I32PointerHandler,
    MemoryPointerHandler,
    NULL_PTR,
    ptr,
    rawIndexPtr,
    U32PointerHandler,
    U8PointerHandler,
} from "./pointer";


export type KindId = number;

/** id 0 is reserved for "no kind" — never assigned by register(). */
const NO_KIND: KindId = 0;

export const TAG_SIZE = 8;


export interface BytesSource {
    allocU8(bytes: number): rawIndexPtr;

    free?(pointer: rawIndexPtr): void;
}

export class PointerKindRegistry {
    private readonly memory: Memory;
    private handlers: MemoryPointerHandler<any>[] = [undefined as any]; // index 0 == NO_KIND, never resolved
    private nameToId = new Map<string, KindId>();

    constructor(memory: Memory) {
        this.memory = memory;
    }

    /** Register a handler under `name`, assigning it a stable KindId. */
    register<T>(name: string, handler: MemoryPointerHandler<T>): KindId {
        if (this.nameToId.has(name)) {
            throw new Error(`PointerKindRegistry: "${name}" is already registered`);
        }
        const id = this.handlers.length;
        this.handlers.push(handler);
        this.nameToId.set(name, id);
        return id;
    }

    idOf(name: string): KindId {
        const id = this.nameToId.get(name);
        if (id === undefined) throw new Error(`PointerKindRegistry: no handler registered as "${name}"`);
        return id;
    }

    handlerFor(id: KindId): MemoryPointerHandler<any> {
        const handler = this.handlers[id];
        if (!handler) throw new Error(`PointerKindRegistry: no handler for kind id ${id}`);
        return handler;
    }

    /**
     * Allocate one instance of `name` from `source` (a Heap for something
     * individually freeable, or a StackScope — level.front()/level.back() —
     * for scratch that goes away with the enclosing scope) and tag it.
     */
    create<T>(name: string, source: BytesSource): ptr<T> {
        const id = this.idOf(name);
        const stride = align8(this.handlers[id].stride);
        const raw = source.allocU8(stride + TAG_SIZE) as unknown as number;
        if (raw === (NULL_PTR as unknown as number)) {
            throw new Error(`PointerKindRegistry: allocation failed for "${name}"`);
        }
        this.memory.i32[raw >> 2] = id;
        return (raw + TAG_SIZE) as unknown as ptr<T>;
    }

    release<T>(pointer: ptr<T>, source: BytesSource): void {
        if (!source.free) {
            throw new Error("PointerKindRegistry.destroy: source has no free() — release the stack scope instead");
        }
        const raw = ((pointer as unknown as number) - TAG_SIZE) as unknown as rawIndexPtr;
        source.free(raw);
    }

    /** Read the kind id stamped before `pointer`, with no allocation. */
    kindOf(pointer: rawIndexPtr): KindId {
        return this.memory.i32[((pointer as unknown as number) - TAG_SIZE) >> 2];
    }

    /** Find the handler for `pointer` — the whole point of this class. */
    resolve<T>(pointer: ptr<T>): MemoryPointerHandler<T> {
        return this.handlerFor(this.kindOf(pointer as unknown as rawIndexPtr));
    }
}

export function registerDefaultPointerHandlers(memory: Memory): void {
    memory.pointerKinds.register("f32", new F32PointerHandler(memory));
    memory.pointerKinds.register("i32", new I32PointerHandler(memory));
    memory.pointerKinds.register("u32", new U32PointerHandler(memory));
    memory.pointerKinds.register("f64", new F64PointerHandler(memory));
    memory.pointerKinds.register("u8", new U8PointerHandler(memory));
}
