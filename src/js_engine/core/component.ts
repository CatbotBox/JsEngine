import type {Entity} from "./entity";
import type {EntityWriteOptions} from "./entityWriteOptions";
import {ComponentType} from "./componentType";

export {ComponentType} from "./componentType";
export type {ComponentCtor, ComponentOf} from "./componentType";

export abstract class Component {

    // noinspection JSUnusedLocalSymbols
    private set trackingProxySetTrapTrigger(value: void) {
    }

    protected notifyChanged() {
        this.trackingProxySetTrapTrigger = undefined;
    }

    public setup(entity: Entity, writeOnlyEntityManager: EntityWriteOptions): void {
    }

    static type<T extends Component>(this: new (...args: any[]) => T): ComponentType<T> {
        return ComponentType.of(this);
    }
}
