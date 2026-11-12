import type {Entity} from "./entity";
import type {Component} from "./component";
import {ComponentType} from "./componentType";
import {getOwnerInferred} from "./ownership";

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

export function trackComponent<T extends Component>(target: T, modified: () => void): T {
    return new Proxy(target as T & object, {
        set(t, prop, value, receiver) {
            if (Reflect.get(t, prop, receiver) === value) return true;
            modified();
            return Reflect.set(t, prop, value, receiver);
        },
    }) as T;
}
