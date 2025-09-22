import {Entity} from "./entity";
import {getOwnerInferred} from "./ownership";
import {EntityWriteOptions} from "./entityWriteOptions";

export abstract class Component {

    /**
     * this must be used as only setters are tracked to minimise complexity
     */
    // noinspection JSUnusedLocalSymbols
    private set dirty(value: void) {
    }

    /**
     * call this to force last update
     * this is useful as only setter trigger it, function calls do not
     * hence if a function performs write operations, call this setter to prevent undetected changes
     * @protected
     */
    protected setDirty() {
        this.dirty = undefined;
    }

    /**
     * add setup logic here
     * note that it may run multiple time and might run in the middle of the entity's lifespan
     * it is recommended to use it for adding other required components only
     * @param entity the entity getting added
     * @param entityManager write-only entity manager
     */
    public setup(entity: Entity, entityManager: EntityWriteOptions): void {
    }

    protected copyTo(other: this) {
        return Object.assign(other, this);
    }

    static clone<T extends Component>(source: T) {
        const ctor = source.constructor as ComponentCtor<T>;
        const copy = new ctor();
        return source.copyTo(copy);
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
                return Reflect.get(t, prop, receiver);
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
    // noinspection JSUnusedLocalSymbols
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

