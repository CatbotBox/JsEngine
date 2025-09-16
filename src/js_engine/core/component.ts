import {Entity} from "./entity";
import {getOwnerInferred} from "./ownership";

export abstract class Component {
    static clone<T extends Component>(clone: T) {
        const ctor = clone.constructor as ComponentCtor<T>;
        const copy = new ctor();
        return Object.assign(copy, clone);
    }

    // Static helper: fetch the ComponentType token for this class.
    static type<T extends Component>(this: ComponentCtor<T>): ComponentType<T> {
        return ComponentType.of(this);
    }

    static persistentTrack<T extends Component>(entitySource: Entity, target: T): T {
        const ctor = target.constructor as ComponentCtor<T>;
        const componentType = ComponentType.of(ctor);
        const updateLastUpdateTime = () => {
            const ownership = getOwnerInferred(entitySource);
            if (ownership) {
                const col = ownership.getColumn(componentType)
                if (col !== undefined) {
                    col.lastUpdatedTime = performance.now();
                }
            }
        }
        return this.track(target, updateLastUpdateTime)
    }

    static track<T extends Component>(target: T, modified: () => void): T {
        return new Proxy(target as T & object, {
            get(t, prop, receiver) {
                const v = Reflect.get(t, prop, receiver);
                return typeof v === "function" ? v.bind(t) : v;
            },
            set(t, prop, value, receiver) {
                modified();
                return Reflect.set(t, prop, value, receiver);
            },
            has(t, prop) {
                return prop in t;
            },
            ownKeys(t) {
                return Reflect.ownKeys(t);
            },
            getOwnPropertyDescriptor(t, prop) {
                return Object.getOwnPropertyDescriptor(t, prop);
            },
            // If target is callable, forward calls.
            apply(t: any, thisArg, argArray) {
                return Reflect.apply(t, t, argArray);
            },
            // If target is a class/constructable function, forward `new`.
            construct(t: any, argArray, newTarget) {
                return Reflect.construct(t, argArray, newTarget);
            },
        }) as T;
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

