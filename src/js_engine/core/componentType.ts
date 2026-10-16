import type {Component} from "./component";

export type ComponentCtor<T extends Component> = new (...args: any[]) => T;

/**
 * The global token for a component class, used as the archetype/column key
 * instead of the class itself. One per class, created lazily and cached.
 *
 * Split out of component.ts: this is the identity of a component *class*, not
 * behaviour of a component *instance*, and keeping it here lets modules that
 * only need the token (entityStream, entityArchetypeMap) import it without
 * dragging in the Component base class.
 */
export class ComponentType<C extends Component = Component> {
    private static _registry = new WeakMap<Function, ComponentType<any>>();
    private static _nextId = 1;
    // 👇 brand so ComponentType<A> is NOT compatible with ComponentType<B>
    // noinspection JSUnusedLocalSymbols
    private readonly __brand!: C;

    /** Process-wide and never reused; the archetype map keys type sets by these. */
    public readonly id: number;

    /**
     * Floats per entity when this component is column-backed (declared via a
     * static `f32Width` on the class, which must then implement {@link F32Backed});
     * 0 means object-backed storage, the default.
     */
    public readonly f32Width: number;

    private constructor(public readonly ctor: ComponentCtor<C>) {
        this.f32Width = (ctor as unknown as { f32Width?: number }).f32Width ?? 0;
        this.id = ComponentType._nextId++;
    }

    static of<T extends Component>(ctor: ComponentCtor<T>): ComponentType<T> {
        let t = this._registry.get(ctor) as ComponentType<T> | undefined;
        if (!t) {
            t = new ComponentType<T>(ctor);
            this._registry.set(ctor, t);
        }
        return t;
    }
}

/**
 * Implemented by components that declare `static f32Width = N`: their numeric
 * state lives in the owning archetype's Float32Array column ("structure of
 * arrays"), and the instance's typed-array fields are *views* into that column.
 *
 * The store drives the lifecycle — user code never calls these:
 *  - `writeF32` copies the instance's current values into the column,
 *  - `bindF32` re-points the instance's fields at the column (called on add,
 *    after swaps and row moves, after column growth, and on an archetype move,
 *    which hands it straight to the destination column), so outstanding handles
 *    stay live,
 *  - `detachF32` gives the instance back its own private buffer, preserving
 *    values (called when the instance leaves the store with no destination
 *    column: entity removal, or its component being removed or replaced).
 *
 * A detached instance behaves exactly like a plain component — `new Foo()` starts
 * detached and mutating a handle to a destroyed entity mutates an orphan.
 */
export interface F32Backed {
    writeF32(dst: Float32Array, offset: number): void;

    bindF32(src: Float32Array, offset: number): void;

    detachF32(): void;
}

// helper: extract instance type carried by a ComponentType
export type ComponentOf<T extends ComponentType<any>> =
    T extends ComponentType<infer C> ? C : never;
