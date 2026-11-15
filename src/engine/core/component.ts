import type {Entity} from "./entity";
import type {EntityWriteOptions} from "./entityWriteOptions";
import {ComponentType} from "./componentType";

export {ComponentType} from "./componentType";
export type {ComponentCtor, ComponentOf} from "./componentType";

const CHANGE_SIGNAL: unique symbol = Symbol("changeSignal");

export abstract class Component {

    // noinspection JSUnusedLocalSymbols
    private set trackingProxySetTrapTrigger(value: typeof CHANGE_SIGNAL) {
    }

    protected notifyChanged() {
        this.trackingProxySetTrapTrigger = CHANGE_SIGNAL;
    }

    public setup(entity: Entity, writeOnlyEntityManager: EntityWriteOptions): void {
    }

    static type<T extends Component>(this: new (...args: any[]) => T): ComponentType<T> {
        return ComponentType.of(this);
    }
}
