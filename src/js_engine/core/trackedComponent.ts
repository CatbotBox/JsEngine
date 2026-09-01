import type {Entity} from "./entity";
import type {Component} from "./component";
import {ComponentType} from "./componentType";
import {getOwnerInferred} from "./ownership";

/**
 * Change-tracking Proxies for long-lived component handles.
 *
 * Split out of component.ts, which is the Component base class and should stay
 * about what a component *is*. It also drops component.ts's dependency on
 * ownership.ts, removing a `component -> ownership -> entityArchetype` edge from
 * the core import graph.
 *
 * This is for handles you keep and mutate from *outside* a system (an input
 * callback, say) — created once per component, so the Proxy costs nothing per
 * frame. Systems do not use these: `query.stream(...)` is 5-11x faster. Any
 * proxied access is ~4-5x a raw property access, so never put one in a loop.
 *
 * Mutation through a *method* is tracked too, because calling it through the
 * Proxy makes `this` the Proxy, so the internal field assignment still hits the
 * set trap. The exception is `#private` fields: those are keyed to the target
 * object, so any access through the Proxy **throws** — a component using
 * `#private` cannot be tracked. Use TS `private`. Both are pinned in core.test.ts.
 */

/** Wrap `target` so property sets mark the owning archetype column dirty. */
export function persistentTrackComponent<T extends Component>(entitySource: Entity, target: T): T {
    const ctor = target.constructor as new (...args: any[]) => T;
    const componentType = ComponentType.of(ctor);
    const updateLastUpdateTime = () => {
        const ownership = getOwnerInferred(entitySource);
        if (ownership) {
            const col = ownership.getColumn(componentType);
            if (col !== undefined) {
                col.lastUpdatedTime = performance.now();
            }
        }
    };
    return trackComponent(target, updateLastUpdateTime);
}

/** Wrap `target` so property sets (that actually change a value) call `modified`. */
export function trackComponent<T extends Component>(target: T, modified: () => void): T {
    // Only `set` is trapped. Forwarding traps for get/has/ownKeys/etc. were
    // measured against this form and came out identical (37-42 ms vs 40-50 ms
    // over 3M accesses), so the omitted traps cost nothing and the engine's
    // default behaviour is exactly what they were spelling out by hand. `apply`
    // and `construct` were dead outright: a component is never callable.
    return new Proxy(target as T & object, {
        set(t, prop, value, receiver) {
            if (Reflect.get(t, prop, receiver) === value) return true;
            modified();
            return Reflect.set(t, prop, value, receiver);
        },
    }) as T;
}
