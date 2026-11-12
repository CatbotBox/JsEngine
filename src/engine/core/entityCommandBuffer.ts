import {Entity} from "./entity";
import {Component} from "./component";
import {persistentTrackComponent} from "./trackedComponent";
import {ComponentType} from "./component";
import type {ComponentCtor} from "./component";
import {EntityManager} from "./entityManager";
import {AnyCT, TokenOrCtor, TokensOfList} from "../util/tokenUtils";
import {EntityWriteOptions} from "./entityWriteOptions";
import {EntityQuery} from "./entityQuery";
import {World} from "./world";
import {NO_SOURCE_COLUMN} from "./entityArchetype";
import type {EntityArchetype} from "./entityArchetype";
import {allocEntityHandle, requireOwner, setOwner} from "./ownership";

const INITIAL_MOVE_COLUMN_CAPACITY = 16;
const ENABLED_BY_DEFAULT = true;

type Pending = {
    set: Map<AnyCT, Component>;
    add: Map<AnyCT, Component>;
    remove: Set<AnyCT>;
    enabled?: boolean;
};

export class EntityCommandBuffer implements EntityWriteOptions {
    private createOps: Set<Entity> = new Set();
    private destroyOps: Set<Entity> = new Set();
    private destroyQueries: Array<EntityQuery<TokensOfList<any[]>, TokensOfList<any[]>>> = [];
    private enabledQueries: Array<{
        query: EntityQuery<TokensOfList<any[]>, TokensOfList<any[]>>,
        enabled: boolean
    }> = [];
    private perEntity: Map<Entity, Pending> = new Map();
    private moveTypes: AnyCT[] = [];
    private moveColumnMap: Int32Array = new Int32Array(INITIAL_MOVE_COLUMN_CAPACITY);
    private moveSupplied: (Component | undefined)[] = [];

    public get isEmpty(): boolean {
        return !
            (this.createOps.size > 0
                || this.destroyOps.size > 0
                || this.destroyQueries.length > 0
                || this.enabledQueries.length > 0
                || this.perEntity.size > 0);

    }

    public createEntity(name?: string, components?: readonly Component[]): Entity {
        const entity = allocEntityHandle(name);
        this.createOps.add(entity);
        if (components !== undefined) this.addComponents(entity, components);
        return entity;
    }

    public destroyEntity(entity: Entity): void {
        this.destroyOps.add(entity);
    }

    destroyQuery(entityQuery: EntityQuery<TokensOfList<any[]>, TokensOfList<any[]>>): void {
        this.destroyQueries.push(entityQuery);
    }

    public addComponent<T extends Component>(entity: Entity, component: T): Readonly<T> {
        this.recordAdd(this.pendingFor(entity), this.tokenOf(component), component);
        component.setup(entity, this);
        return component
    }

    public addTrackedComponent<T extends Component>(entity: Entity, component: T): T {
        this.recordAdd(this.pendingFor(entity), this.tokenOf(component), component);
        component.setup(entity, this);
        return persistentTrackComponent(entity, component);
    }

    public addComponents(entity: Entity, components: readonly Component[]): void {
        if (components.length === 0) return;
        const pending = this.pendingFor(entity);
        const tokens = components.map(c => this.tokenOf(c));
        this.recordFirstInstances(pending, tokens, components);
        for (let i = 0; i < tokens.length; i++) {
            if (tokens.indexOf(tokens[i]) === i) components[i].setup(entity, this);
        }
        this.recordFirstInstances(pending, tokens, components);
    }

    private recordFirstInstances(pending: Pending, tokens: readonly AnyCT[], components: readonly Component[]): void {
        for (let i = 0; i < tokens.length; i++) {
            if (tokens.indexOf(tokens[i]) === i) this.recordAdd(pending, tokens[i], components[i]);
        }
    }

    public setComponent<T extends Component>(entity: Entity, component: Component): void {
        const pending = this.pendingFor(entity);
        const token = ComponentType.of<T>(component.constructor as ComponentCtor<T>);
        pending.remove.delete(token);
        pending.set.set(token, component);
        component.setup(entity, this);
    }

    public setEnabledState(entity: Entity, enabled: boolean): void {
        const pending = this.pendingFor(entity);
        pending.enabled = enabled;
    }

    public setEnabledStateForQuery(entityQuery: EntityQuery<TokensOfList<any[]>, TokensOfList<any[]>>, enabled: boolean): void {
        this.enabledQueries.push({query: entityQuery, enabled});
    }

    public removeComponent(entity: Entity, key: TokenOrCtor): void {
        const pending = this.pendingFor(entity);
        const token = this.toToken(key);
        pending.set.delete(token);
        pending.add.delete(token);
        pending.remove.add(token);
    }

    public playback(em: EntityManager): void {
        for (const entity of this.createOps) {
            if (!this.perEntity.has(entity) && !this.destroyOps.has(entity)) em.attachEntity(entity);
        }

        const world = em.world;
        for (const [entity, pending] of this.perEntity) {
            if (this.destroyOps.has(entity)) continue;
            if (this.createOps.has(entity)) {
                em.attachEntity(entity, this.createdComponents(pending), pending.enabled ?? ENABLED_BY_DEFAULT);
                continue;
            }

            this.applyToExisting(world, entity, pending);
            if (pending.enabled !== undefined) em.setEnabledState(entity, pending.enabled);
        }

        for (const {query, enabled} of this.enabledQueries) {
            em.setEnabledStateForQuery(query, enabled);
        }

        this.playbackDestroy(em)

        this.reset()
    }

    private playbackDestroy(entityManager: EntityManager) {
        for (const e of this.destroyOps) {
            entityManager.destroyEntity(e);
        }

        for (const query of this.destroyQueries) {
            entityManager.destroyQuery(query);
        }
    }

    private createdComponents(pending: Pending): Map<AnyCT, Component> {
        if (pending.set.size === 0) return pending.add;
        const components = new Map(pending.add);
        for (const [token, component] of pending.set) {
            if (!components.has(token)) components.set(token, component);
        }
        return components;
    }

    private recordAdd(pending: Pending, token: AnyCT, component: Component) {
        pending.remove.delete(token);
        pending.add.set(token, component);
    }

    private tokenOf(component: Component): AnyCT {
        return ComponentType.of(component.constructor as ComponentCtor<Component>);
    }

    private reset() {
        this.createOps.clear();
        this.destroyOps.clear();
        this.perEntity.clear();
        this.destroyQueries = [];
        this.enabledQueries = [];
    }

    private applyToExisting(world: World, entity: Entity, pending: Pending) {
        const arch = requireOwner(world, entity);
        const target = world.archetypes.getOrCreate(this.finalTypesInColumnOrder(arch, pending));
        if (target === arch) {
            this.rewriteInPlace(world, entity, arch, pending);
            return;
        }

        const types = target.componentTypes;
        if (this.moveColumnMap.length < types.length) this.moveColumnMap = new Int32Array(types.length * 2);
        const columnMap = this.moveColumnMap, supplied = this.moveSupplied;
        for (let i = 0; i < types.length; i++) {
            const from = arch.columnIndexOf(types[i]);
            const given = from >= 0 ? pending.set.get(types[i]) : pending.add.get(types[i]) ?? pending.set.get(types[i]);
            columnMap[i] = given === undefined ? from : NO_SOURCE_COLUMN;
            supplied[i] = given;
        }
        arch.moveRowWith(entity, target, columnMap, supplied, world.time);
        setOwner(world, entity, target);
        for (let i = 0; i < types.length; i++) supplied[i] = undefined;
    }

    private finalTypesInColumnOrder(arch: EntityArchetype<AnyCT>, pending: Pending): readonly AnyCT[] {
        const types = this.moveTypes;
        types.length = 0;
        for (const t of arch.componentTypes) if (!pending.remove.has(t)) types.push(t);
        for (const t of pending.add.keys()) if (arch.getColumn(t) === undefined) types.push(t);
        for (const t of pending.set.keys()) if (arch.getColumn(t) === undefined && !pending.add.has(t)) types.push(t);
        return types;
    }

    private rewriteInPlace(world: World, entity: Entity, arch: EntityArchetype<AnyCT>, pending: Pending) {
        const row = arch.getIndexOfEntity(entity)!;
        const next = new Map<AnyCT, Component>();
        for (const t of arch.componentTypes) next.set(t, pending.set.get(t) ?? arch.getColumn(t)!.get(row));
        arch.setEntity(entity, next, undefined, world.time);
    }

    private pendingFor(entity: Entity): Pending {
        let p = this.perEntity.get(entity);
        if (!p) {
            p = {add: new Map(), remove: new Set(), set: new Map()};
            this.perEntity.set(entity, p);
        }
        return p;
    }

    private toToken(k: TokenOrCtor): AnyCT {
        return (typeof k === "function")
            ? ComponentType.of(k as ComponentCtor<Component>)
            : (k as AnyCT);
    }
}
