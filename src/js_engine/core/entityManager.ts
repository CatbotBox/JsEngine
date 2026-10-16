import {World} from "./world";
import {Entity} from "./entity";
import type {ComponentCtor} from "./component";
import {Component, ComponentType} from "./component";
import {persistentTrackComponent} from "./trackedComponent";
import type {EntityArchetype} from "./entityArchetype";
import {AnyCT, TokenOrCtor, TokensOfList} from "../util/tokenUtils";
import {EntityQuery} from "./entityQuery";
import {EntityWriteOptions} from "./entityWriteOptions";
import {allocEntityHandle, freeEntityHandle, getOwner, requireOwner, setOwner} from "./ownership";
import {EntityReadOptions} from "./entityReadOptions";

export class EntityManager implements EntityWriteOptions, EntityReadOptions {

    constructor(
        private _world: World,
    ) {
    }

    public get world(): World {
        return this._world;
    }

    // creation / destruction

    private static emptyMap: Map<AnyCT, Component> = new Map();
    private static noTypes: readonly AnyCT[] = [];

    /**
     * Create an entity directly in the archetype of `components`, then run their
     * setup() in array order. A type listed twice keeps its first instance; the
     * later ones are dropped without setup(), as a duplicate addComponent is.
     */
    public createEntity(name?: string, components?: readonly Component[]): Entity {
        const entity = allocEntityHandle(name);
        if (components === undefined || components.length === 0) return this.attachEntity(entity);

        const tokens = components.map(EntityManager.tokenOf);
        const arch = this._world.archetypes.getOrCreate(tokens);
        arch.addEntityFromList(entity, tokens, components, true, this._world.time);
        setOwner(this._world, entity, arch);
        for (let i = 0; i < components.length; i++) {
            if (tokens.indexOf(tokens[i]) === i) components[i].setup(entity, this);
        }
        return entity;
    }

    /**
     * Place an allocated handle holding exactly `components`, without running
     * setup(): the command buffer ran those when it recorded them.
     */
    public attachEntity(entity: Entity, components: Map<AnyCT, Component> = EntityManager.emptyMap, enabled: boolean = true): Entity {
        const arch = this._world.archetypes.getOrCreate(components.size === 0 ? EntityManager.noTypes : [...components.keys()]);
        arch.addEntity(entity, components, enabled, this._world.time);
        setOwner(this._world, entity, arch as EntityArchetype<AnyCT>);
        return entity;
    }

    /**
     * Destroy an entity: remove it from its archetype and retire the handle.
     * The generation bump makes every outstanding copy of this handle stale, so
     * a later create that recycles the slot cannot be aliased by it.
     */
    public destroyEntity(entity: Entity): void {
        const arch = getOwner(this._world, entity);
        if (arch) {
            arch.removeEntity(entity, this._world.time);
            setOwner(this._world, entity, undefined);
        }
        freeEntityHandle(entity);
    }

    public destroyQuery(entityQuery: EntityQuery<TokensOfList<any[]>, TokensOfList<any[]>>): void {
        // Free handles BEFORE removeAll empties the archetypes — the old order
        // iterated the query after clearing it, which visited nothing and left
        // every destroyed entity still registered as owned.
        for (const archetype of entityQuery.archetypes) {
            const n = archetype.entityCountUnfiltered;
            for (let i = 0; i < n; i++) {
                const e = archetype.getEntityAtIndex(i);
                setOwner(this._world, e, undefined);
                freeEntityHandle(e);
            }
            archetype.removeAll(this._world.time);
        }
    }

    public addComponent<T extends Component>(entity: Entity, component: T): Readonly<T> {
        this.addComponentInternal(entity, component);
        return component;
    }

    public addTrackedComponent<T extends Component>(entity: Entity, component: T): T {
        this.addComponentInternal(entity, component);
        return persistentTrackComponent(entity, component);
    }

    /**
     * Add every component whose type the entity lacks in one move, then run their
     * setup() in array order. Types already present, or listed twice, keep the
     * first instance, as with addComponent.
     */
    public addComponents(entity: Entity, components: readonly Component[]): void {
        const currentArch = requireOwner(this._world, entity);
        const tokens = components.map(EntityManager.tokenOf);
        const added: number[] = [];
        for (let i = 0; i < tokens.length; i++) {
            if (currentArch.getColumn(tokens[i]) === undefined && tokens.indexOf(tokens[i]) === i) added.push(i);
        }
        if (added.length === 0) return;
        if (added.length === 1) {
            this.addComponentInternal(entity, components[added[0]]);
            return;
        }

        const data = currentArch.getDataAtEntityUntracked(entity) as Map<AnyCT, Component>;
        for (const i of added) data.set(tokens[i], components[i]);
        const target = this._world.archetypes.getOrCreate([...data.keys()]);
        const enabled = currentArch.isEntityEnabled(entity);
        currentArch.removeEntity(entity, this._world.time);
        target.addEntity(entity, data, enabled, this._world.time);
        setOwner(this._world, entity, target);

        for (const i of added) components[i].setup(entity, this);
    }

    public setEnabledState(entity: Entity, enabled: boolean): void {
        const arch = requireOwner(this._world, entity);
        arch.setEnabledState(entity, enabled, this._world.time);
    }

    public setEnabledStateForQuery(entityQuery: EntityQuery<TokensOfList<any[]>, TokensOfList<any[]>>, enabled: boolean): void {
        for (const archetype of entityQuery.archetypes) {
            archetype.setEnabledStateForAll(enabled, this._world.time);
        }
    }

    private addComponentInternal<T extends Component>(entity: Entity, component: T): void {
        const token = ComponentType.of<T>(component.constructor as ComponentCtor<T>);
        const currentArch = requireOwner(this.world, entity);
        if (currentArch.getColumn(token) !== undefined) {
            // Keep the existing one and discard the new instance — use setComponent()
            // to replace.
            //
            // Deliberately silent. This is normal operation, not a mistake:
            // Component.setup() routinely adds companions, so duplicates are
            // expected. Parent.setup() adds Children *to the parent*, so every
            // child after the first lands here; RenderMesh and ConsoleImage both
            // add RenderBounds. Logging (which fans out to fileLogger, i.e. disk)
            // on each was pure noise, and throwing would break the engine outright.
            return;
        }
        const edge = this._world.archetypes.withAdded(currentArch, token);
        currentArch.moveRowTo(entity, edge.target, edge, component, this._world.time);
        setOwner(this._world, entity, edge.target);

        component.setup(entity, this);
    }

    public setComponent<T extends Component>(entity: Entity, component: T): void {
        const token = ComponentType.of<T>(component.constructor as ComponentCtor<T>);

        const currentArch = requireOwner(this._world, entity);
        const componentStore = currentArch.getColumn(token);
        if (componentStore === undefined) {
            throw new Error("component doesnt exist on entity");
        }
        const index = currentArch.getIndexOfEntity(entity)!;

        componentStore.set(index, component, this._world.time.elapsedTime);
        component.setup(entity, this);
    }

    /**
     * Remove a component from an entity (no error if it didn't exist).
     * Moves to the correct archetype in one step.
     */
    public removeComponent(entity: Entity, key: TokenOrCtor): void {
        const token = this.toToken(key);
        const currentArch = requireOwner(this._world, entity);
        if (currentArch.getColumn(token) === undefined) return;
        const edge = this._world.archetypes.withRemoved(currentArch, token);
        currentArch.moveRowTo(entity, edge.target, edge, undefined, this._world.time);
        setOwner(this._world, entity, edge.target);
    }

    // simple queries (immediate)

    public hasComponent<T extends Component>(entity: Entity, key: TokenOrCtor): boolean {
        return requireOwner(this._world, entity).getColumn(this.toToken(key)) !== undefined;
    }

    public getComponent<T extends Component>(entity: Entity, key: TokenOrCtor): T | undefined {
        const token = this.toToken(key);
        const arch = getOwner(this._world, entity);
        if (!arch) return undefined;

        const store = arch.getColumn(token);
        if (store === undefined) return undefined;
        const index = arch.getIndexOfEntity(entity);
        if (index === undefined) return undefined;
        const component = store.get(index);
        if (component === undefined) return undefined;
        return persistentTrackComponent(entity, component) as T;
    }

    public isEnabled(entity: Entity): boolean {
        const arch = getOwner(this._world, entity);
        if (!arch) throw new Error("Has entity been created by the EntityManager?");
        return arch.isEntityEnabled(entity);
    }

    public exists(entity: Entity): boolean {
        const arch = getOwner(this._world, entity);
        return arch !== undefined;

    }

    // internals

    private static tokenOf(component: Component): AnyCT {
        return ComponentType.of(component.constructor as ComponentCtor<Component>);
    }

    private toToken(key: TokenOrCtor): AnyCT {
        return (typeof key === "function")
            ? ComponentType.of(key as ComponentCtor<Component>)
            : (key as AnyCT);
    }
}
