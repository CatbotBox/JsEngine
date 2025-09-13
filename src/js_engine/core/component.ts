import {Event} from "../util/event";

const OBSERVED = Symbol("observed");

/** If you write to _message inside a setter, we report as 'message' when possible. */
function publicKeyFor(target: object, key: string): string {
  if (key.startsWith("_")) {
    const pub = key.slice(1);
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), pub);
    if (desc && (desc.get || desc.set)) return pub;
  }
  return key;
}

export function setupComponentEvents<T extends Component>(comp: T): T {
  return comp
  // if ((comp as any)[OBSERVED]) return comp;
  //
  // const proxy = new Proxy(comp, {
  //   set(target, p, value, receiver) {
  //     // ignore symbol keys and non-string props
  //     if (typeof p !== "string") return Reflect.set(target, p, value, receiver);
  //
  //     const oldVal = (target as any)[p];
  //     const ok = Reflect.set(target, p, value, receiver);
  //
  //     if (ok && oldVal !== value) {
  //       // map private backing field _x -> 'x' if there's an accessor
  //       const key = publicKeyFor(target, p);
  //       (target as any).onChange.invoke({
  //         component: receiver as T,
  //         key,
  //         oldValue: oldVal,
  //         newValue: value,
  //       });
  //     }
  //     return ok;
  //   }
  // });
  //
  // Object.defineProperty(proxy, OBSERVED, {value: true});
  // return proxy as T;
}

export type ComponentChange = {
  component: Component;
  key: string;
  oldValue: unknown;
  newValue: unknown;
};

export class Component {
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

// export class ComponentType<C extends Component = Component> {
//   private static _registry = new WeakMap<Function, ComponentType<any>>();
//
//   private constructor(public readonly ctor: ComponentCtor<C>) {
//   }
//
//   static of<T extends Component>(ctor: ComponentCtor<T>): ComponentType<T> {
//     let t = this._registry.get(ctor) as ComponentType<T> | undefined;
//     if (!t) {
//       t = new ComponentType<T>(ctor);
//       this._registry.set(ctor, t);
//     }
//     return t;
//   }
// }

export class ComponentType<C extends Component = Component> {
  private static _registry = new WeakMap<Function, ComponentType<any>>();
  // 👇 brand so ComponentType<A> is NOT compatible with ComponentType<B>
  private readonly __brand!: C;

  private constructor(public readonly ctor: ComponentCtor<C>) {}

  static of<T extends Component>(ctor: ComponentCtor<T>): ComponentType<T> {
    let t = this._registry.get(ctor) as ComponentType<T> | undefined;
    if (!t) { t = new ComponentType<T>(ctor); this._registry.set(ctor, t); }
    return t;
  }
}

// helper: extract instance type carried by a ComponentType
export type ComponentOf<T extends ComponentType<any>> =
  T extends ComponentType<infer C> ? C : never;