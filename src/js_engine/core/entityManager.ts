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

const PLACE_ENABLED = true;

export class EntityManager implements EntityWriteOptions, EntityReadOptions {

    constructor(
        private _world: World,
    ) {
    }

    public get world(): World {
        return this._world;
    }

    private static emptyMap: Map<AnyCT, Component> = new Map();
    private static noTypes: readonly AnyCT[] = [];

    public createEntity(name?: string, components?: readonly Component[]): Entity {
        const entity = allocEntityHandle(name);
        if (components === undefined || components.length === 0) return this.attachEntity(entity);

        const tokens = components.map(EntityManager.tokenOf);
        const arch = this._world.archetypes.getOrCreate(tokens);
        arch.addEntityFromList(entity, tokens, components, PLACE_ENABLED, this._world.time);
        setOwner(this._world, entity, arch);
        for (let i = 0; i < components.length; i++) {
            if (tokens.indexOf(tokens[i]) === i) components[i].setup(entity, this);
        }
        return entity;
    }

    public attachEntity(entity: Entity, components: Map<AnyCT, Component> = EntityManager.emptyMap, enabled: boolean = true): Entity {
        const arch = this._world.archetypes.getOrCreate(components.size === 0 ? EntityManager.noTypes : [...components.keys()]);
        arch.addEntity(entity, components, enabled, this._world.time);
        setOwner(this._world, entity, arch as EntityArchetype<AnyCT>);
        return entity;
    }

    public destroyEntity(entity: Entity): void {
        const arch = getOwner(this._world, entity);
        if (arch) {
            arch.removeEntity(entity, this._world.time);
            setOwner(this._world, entity, undefined);
        }
        freeEntityHandle(entity);
    }

    public destroyQuery(entityQuery: EntityQuery<TokensOfList<any[]>, TokensOfList<any[]>>): void {
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
        this.addComponentUnlessPresent(entity, component);
        return component;
    }

    public addTrackedComponent<T extends Component>(entity: Entity, component: T): T {
        this.addComponentUnlessPresent(entity, component);
        return persistentTrackComponent(entity, component);
    }

    public addComponents(entity: Entity, components: readonly Component[]): void {
        const currentArch = requireOwner(this._world, entity);
        const tokens = components.map(EntityManager.tokenOf);
        const added: number[] = [];
        for (let i = 0; i < tokens.length; i++) {
            if (currentArch.getColumn(tokens[i]) === undefined && tokens.indexOf(tokens[i]) === i) added.push(i);
        }
        if (added.length === 0) return;
        if (added.length === 1) {
            this.addComponentUnlessPresent(entity, components[added[0]]);
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

    private addComponentUnlessPresent<T extends Component>(entity: Entity, component: T): void {
        const token = ComponentType.of<T>(component.constructor as ComponentCtor<T>);
        const currentArch = requireOwner(this.world, entity);
        if (currentArch.getColumn(token) !== undefined) {
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

    public removeComponent(entity: Entity, key: TokenOrCtor): void {
        const token = this.toToken(key);
        const currentArch = requireOwner(this._world, entity);
        if (currentArch.getColumn(token) === undefined) return;
        const edge = this._world.archetypes.withRemoved(currentArch, token);
        currentArch.moveRowTo(entity, edge.target, edge, undefined, this._world.time);
        setOwner(this._world, entity, edge.target);
    }

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

    private static tokenOf(component: Component): AnyCT {
        return ComponentType.of(component.constructor as ComponentCtor<Component>);
    }

    private toToken(key: TokenOrCtor): AnyCT {
        return (typeof key === "function")
            ? ComponentType.of(key as ComponentCtor<Component>)
            : (key as AnyCT);
    }
}
