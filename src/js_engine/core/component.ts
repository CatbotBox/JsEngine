import type {Entity} from "./entity";
import type {EntityWriteOptions} from "./entityWriteOptions";
import {ComponentType} from "./componentType";

// Re-exported so the many `from "./component"` import sites keep working; the
// declarations themselves live in componentType.ts.
export {ComponentType} from "./componentType";
export type {ComponentCtor, ComponentOf} from "./componentType";

/**
 * Base class for all component data.
 *
 * Declares **no instance fields**, so a subclass instance costs exactly its own
 * fields and nothing more. Keep it that way — components are stored one flat
 * column per type and are the highest-count objects in the engine.
 *
 * Class identity (`ComponentType`) lives in componentType.ts and change-tracking
 * Proxies in trackedComponent.ts; neither is per-instance behaviour.
 */
export abstract class Component {

    /**
     * Exists only to be assigned to: the change-tracking Proxy traps property *sets*, so
     * writing this no-op setter is what trips the trap. Never read.
     */
    // noinspection JSUnusedLocalSymbols
    private set changeSignal(value: void) {
    }

    /**
     * Announce a mutation the tracking Proxy cannot see.
     *
     * Assigning a field is already tracked, and so is a method that assigns one, because
     * calling it through the Proxy makes `this` the Proxy. What is *not* tracked is mutating
     * something the component merely holds: pushing into an array field, or writing through a
     * Float32Array view. Both leave the component's own properties untouched, so the set trap
     * never fires. `Children.addChild` and `LocalToWorld.setTRS` are the two cases in-tree.
     */
    protected notifyChanged() {
        this.changeSignal = undefined;
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

    // Static helper: fetch the ComponentType token for this class.
    static type<T extends Component>(this: new (...args: any[]) => T): ComponentType<T> {
        return ComponentType.of(this);
    }
}
