export abstract class Component {
    static clone<T extends Component>(clone: T) {
        const ctor = clone.constructor as ComponentCtor<T>;
        const copy = new ctor();
        return Object.assign(copy, clone);
    }

    // /** Per-instance event; raised when a property on this component changes. */
    // public readonly onChange: Event<ComponentChange> = new Event();

    // Static helper: fetch the ComponentType token for this class.
    static type<T extends Component>(this: ComponentCtor<T>): ComponentType<T> {
        return ComponentType.of(this);
    }
}

export type ComponentCtor<T extends Component> = new (...args: any[]) => T;

export class ComponentType<C extends Component = Component> {
    private static _registry = new WeakMap<Function, ComponentType<any>>();
    // 👇 brand so ComponentType<A> is NOT compatible with ComponentType<B>
    private readonly __brand!: C;

    private constructor(public readonly ctor: ComponentCtor<C>) {
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

// helper: extract instance type carried by a ComponentType
export type ComponentOf<T extends ComponentType<any>> =
    T extends ComponentType<infer C> ? C : never;

