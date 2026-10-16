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
import type {EntityArchetype} from "./entityArchetype";
import {allocEntityHandle, requireOwner, setOwner} from "./ownership";

type Pending = {
    set: Map<AnyCT, Component>; // upserts
    add: Map<AnyCT, Component>;
    remove: Set<AnyCT>;
    enabled?: boolean; // optional enable/disable
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
    private moveColumnMap: Int32Array = new Int32Array(16);
    private moveSupplied: (Component | undefined)[] = [];

    public get isEmpty(): boolean {
        return !
            (this.createOps.size > 0
                || this.destroyOps.size > 0
                || this.destroyQueries.length > 0
                || this.enabledQueries.length > 0
                || this.perEntity.size > 0);

    }

    /**
     * Queue entity creation. The handle is allocated immediately (so it can be
     * referenced by other queued commands); the entity joins an archetype at
     * playback, placed once in its final archetype.
     */
    public createEntity(name?: string, components?: readonly Component[]): Entity {
        const entity = allocEntityHandle(name);
        this.createOps.add(entity);
        if (components !== undefined) this.addComponents(entity, components);
        return entity;
    }

    /** Queue entity destruction. */
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

    /**
     * Record every component, then run their setup() in array order. A type listed
     * twice keeps its first instance; against earlier commands, the later add wins
     * as with addComponent.
     */
    public addComponents(entity: Entity, components: readonly Component[]): void {
        if (components.length === 0) return;
        const pending = this.pendingFor(entity);
        const tokens = components.map(c => this.tokenOf(c));
        for (let i = 0; i < tokens.length; i++) {
            if (tokens.indexOf(tokens[i]) === i) this.recordAdd(pending, tokens[i], components[i]);
        }
        for (let i = 0; i < tokens.length; i++) {
            if (tokens.indexOf(tokens[i]) === i) components[i].setup(entity, this);
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

    /** Remove a component (token or ctor). */
    public removeComponent(entity: Entity, key: TokenOrCtor): void {
        const pending = this.pendingFor(entity);
        const token = this.toToken(key);
        pending.set.delete(token);
        pending.add.delete(token);
        pending.remove.add(token);
    }

    /**
     * Apply everything in one shot. An entity created by this buffer is placed once,
     * straight into the archetype of its recorded components; an existing one gets
     * the final set of tokens = (current - removes) ∪ addOrSet and moves once.
     * Entities also destroyed by this buffer are never placed.
     */
    public playback(em: EntityManager): void {
        for (const entity of this.createOps) {
            if (!this.perEntity.has(entity) && !this.destroyOps.has(entity)) em.attachEntity(entity);
        }

        const world = em.world;
        for (const [entity, pending] of this.perEntity) {
            if (this.destroyOps.has(entity)) continue;
            if (this.createOps.has(entity)) {
                em.attachEntity(entity, this.createdComponents(pending), pending.enabled ?? true);
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

    // internals
    private playbackDestroy(entityManager: EntityManager) {
        for (const e of this.destroyOps) {
            entityManager.destroyEntity(e);
        }

        for (const query of this.destroyQueries) {
            entityManager.destroyQuery(query);
        }
    }

    /**
     * What a created entity holds: every add, then each set of a type not also
     * added. An add wins over a set of the same type, as in the move path, where
     * `provided` lets add entries override set entries.
     */
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

    /**
     * Give an existing entity its final types, (current - removes) ∪ adds ∪ sets: an
     * add of a type it already has keeps the existing instance, a set replaces it,
     * and an add wins over a set of the same new type. A type change is one
     * column-mapped move; without one every column is rewritten in place.
     */
    private applyToExisting(world: World, entity: Entity, pending: Pending) {
        const arch = requireOwner(world, entity);
        const target = world.archetypes.getOrCreate(this.finalTypes(arch, pending));
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
            columnMap[i] = given === undefined ? from : -1;
            supplied[i] = given;
        }
        arch.moveRowWith(entity, target, columnMap, supplied, world.time);
        setOwner(world, entity, target);
        for (let i = 0; i < types.length; i++) supplied[i] = undefined;
    }

    /** In the order a new archetype would take them: kept current types, then new adds, then new sets. */
    private finalTypes(arch: EntityArchetype<AnyCT>, pending: Pending): readonly AnyCT[] {
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
