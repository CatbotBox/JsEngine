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

    // Static helper: fetch the ComponentType token for this class.
    static type<T extends Component>(this: new (...args: any[]) => T): ComponentType<T> {
        return ComponentType.of(this);
    }
}
