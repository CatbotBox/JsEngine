import {World} from "./world";
import {Entity} from "./entity";
import type {ComponentCtor} from "./component";
import {Component, ComponentType} from "./component";
import type {EntityArchetype} from "./entityArchetype";
import {AnyCT, TokenOrCtor, TokensOfList} from "../util/tokenUtils";
import {EntityQuery} from "./entityQuery";
import {NAME} from "./symbols";
import {EntityWriteOptions} from "./entityWriteOptions";
import {getOwner, requireOwner, setOwner} from "./ownership";
import {EntityReadOptions} from "./entityReadOptions";


export class EntityManager implements EntityWriteOptions, EntityReadOptions {


    constructor(
        private _world: World,
    ) {
    }

    public get world(): World {
        return this._world;
    }

    // ---------- creation / destruction ----------

    /** Create an entity with the given components (keys can be tokens or constructors). */
        // public createEntity(components: Map<TokenOrCtor, Component> = new Map()): Entity {
    private static emptyMap: Map<AnyCT, Component> = new Map();

    public createEntity(name?: string): Entity {
        const arch = this._world.archetypes.getOrCreate([] as AnyCT[]);
        const e = new Entity();
        (e as any)[NAME] = name;
        // arch.addEntity(e, map as Map<AnyCT, Component>);
        arch.addEntity(e, EntityManager.emptyMap, true, this._world.time);
        setOwner(this._world, e, arch as EntityArchetype<AnyCT>);
        return e;
    }

    public realizeEntity(entity: Entity) {
        // const {types, map} = this.normalizeComponents(components);
        const arch = this._world.archetypes.getOrCreate([] as AnyCT[]);
        arch.addEntity(entity, EntityManager.emptyMap, true, this._world.time);
        setOwner(this._world, entity, arch as EntityArchetype<AnyCT>);
        return entity;
    }

    /** Destroy an entity (remove from its archetype). */
    public destroyEntity(entity: Entity): void {
        const arch = getOwner(this._world, entity);
        if (arch) {
            arch.removeEntity(entity, this._world.time);
            setOwner(this._world, entity, undefined);
            return;
        }
        // Fallback scan if owner not tracked (should be rare)
        for (const a of this._world.archetypes.values() as Iterable<EntityArchetype<AnyCT>>) {
            try {
                a.getDataAtEntity(entity); // throws if not there
                a.removeEntity(entity, this._world.time);
                break;
            } catch {
            }
        }
        setOwner(this._world, entity, undefined);
    }

    public destroyQuery(entityQuery: EntityQuery<TokensOfList<any[]>, TokensOfList<any[]>>): void {
        for (const archetype of entityQuery.archetypes) {
            archetype.removeAll(this._world.time);
        }
        for (const entity of entityQuery) {
            setOwner(this._world, entity, undefined);
        }
    }


    public addComponent<T extends Component>(entity: Entity, component: T): Readonly<T> {
        this.setComponent(entity, component);
        return component;
    }

    public addTrackedComponent<T extends Component>(entity: Entity, component: T): T {
        this.setComponent(entity, component)
        return Component.persistentTrack(entity, component);
    }

    public setEnabledState(entity: Entity, enabled: boolean): void {
        const arch = requireOwner(this._world, entity);
        arch.setEnabledState(entity, enabled, this._world.time);
    }

    public setEnabledStateForQuery(entityQuery: EntityQuery<TokensOfList<any[]>, TokensOfList<any[]>>, enabled: boolean): void {
        console.log("setEnabledStateForQuery", entityQuery, enabled);
        for (const archetype of entityQuery.archetypes) {
            archetype.setEnabledStateForAll(enabled, this._world.time);
        }
    }

    public setComponent<T extends Component>(entity: Entity, component: T): void {
        const token = ComponentType.of<T>(component.constructor as ComponentCtor<T>);
        const currentArch = requireOwner(this._world, entity);
        const componentStore = currentArch.getColumn(token);
        if (componentStore === undefined) {
            throw new Error("component doesnt exist on entity");
        }
        const index = currentArch.getIndexOfEntity(entity)!;

        componentStore.set(index, component, this._world.time);
    }

    /**
     * Remove a component from an entity (no error if it didn't exist).
     * Moves to the correct archetype in one step.
     */
    public removeComponent(entity: Entity, key: TokenOrCtor): void {
        const token = this.toToken(key);
        const currentArch = requireOwner(this._world, entity);
        const currentData = currentArch.getDataAtEntity(entity) as Map<AnyCT, Component>;
        if (!currentData.has(token)) return; // nothing to do

        // next tokens = current \ {token}
        const nextTokens = (currentArch.componentTypes as AnyCT[]).filter(t => t !== token);
        const targetArch = this._world.archetypes.getOrCreate(nextTokens);

        const nextComponents = new Map<AnyCT, Component>();
        for (const t of targetArch.componentTypes as AnyCT[]) {
            const c = currentData.get(t);
            if (!c) throw new Error(`Missing component for required type during removal`);
            nextComponents.set(t, c);
        }
        this.moveEntityInternal(entity, currentArch, targetArch, nextComponents);
    }


    // ---------- simple queries (immediate) ----------

    public hasComponent<T extends Component>(entity: Entity, key: TokenOrCtor): boolean {
        const token = this.toToken(key);
        const arch = getOwner(this._world, entity);
        if (!arch) return false;
        const data = arch.getDataAtEntity(entity) as Map<AnyCT, Component>;
        return data.has(token);
    }

    public getComponent<T extends Component>(entity: Entity, key: TokenOrCtor): T | undefined {
        const token = this.toToken(key);
        const arch = getOwner(this._world, entity);
        if (!arch) return undefined;
        const data = arch.getDataAtEntity(entity) as Map<AnyCT, Component>;
        return data.get(token) as T | undefined;
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

    // ---------- internals ----------

    private moveEntityInternal(
        entity: Entity,
        from: EntityArchetype<AnyCT>,
        to: EntityArchetype<AnyCT>,
        components: Map<AnyCT, Component>
    ): void {
        if (from === to) {
            to.setEntity(entity, components as Map<AnyCT, Component>, undefined, this._world.time);
            setOwner(this._world, entity, to);
            return;
        }
        const isEnabled = from.isEntityEnabled(entity);
        from.removeEntity(entity, this._world.time);
        to.addEntity(entity, components as Map<AnyCT, Component>, isEnabled, this._world.time);
        setOwner(this._world, entity, to);
    }

    private toToken(key: TokenOrCtor): AnyCT {
        return (typeof key === "function")
            ? ComponentType.of(key as ComponentCtor<Component>)
            : (key as AnyCT);
    }
}
