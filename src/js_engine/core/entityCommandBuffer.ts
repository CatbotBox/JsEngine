import {Entity} from "./entity";
import {Component} from "./component";
import {ComponentType} from "./component";
import type {ComponentCtor} from "./component";
import {EntityManager} from "./entityManager";
import {AnyCT, TokenOrCtor, TokensOfList} from "../util/tokenUtils";
import {NAME} from "./symbols";
import {EntityWriteOptions} from "./entityWriteOptions";
import {EntityQuery} from "./entityQuery";
import {World} from "./world";
import {requireOwner, setOwner} from "./ownership";
import {getEntityComponents, getEntityTokens} from "./entityManagerUtils";

type Pending = {
    set: Map<AnyCT, Component>; // upserts
    add: Map<AnyCT, Component>;
    remove: Set<AnyCT>;
    enabled?: boolean; // optional enable/disable
};

export class EntityCommandBuffer implements EntityWriteOptions {
    private createOps: Array<Entity> = [];
    private destroyOps: Set<Entity> = new Set();
    private destroyQueries: Array<EntityQuery<TokensOfList<any[]>, TokensOfList<any[]>>> = [];
    private enabledQueries: Array<{
        query: EntityQuery<TokensOfList<any[]>, TokensOfList<any[]>>,
        enabled: boolean
    }> = [];
    private perEntity: Map<Entity, Pending> = new Map();

    public get isEmpty(): boolean {
        return !
            (this.createOps.length > 0
                || this.destroyOps.size > 0
                || this.destroyQueries.length > 0
                || this.enabledQueries.length > 0
                || this.perEntity.size > 0);

    }

    /** Queue entity creation. */
    public createEntity(name?: string): Entity {
        const entity = new Entity();
        const e = new Entity();
        (e as any)[NAME] = name;
        this.createOps.push(entity);
        // const pending = this.ensure(entity);
        // for (const [key, component] of components) {
        //   const token = this.toToken(key);
        //   pending.addOrSet.set(token, component);
        //   pending.remove.delete(token); // ensure no remove for this token
        // }
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
        const p = this.ensure(entity);
        const token = ComponentType.of<T>(component.constructor as ComponentCtor<T>);
        p.remove.delete(token);
        p.add.set(token, component);
        component.setup(entity, this);
        return component
    }

    public addTrackedComponent<T extends Component>(entity: Entity, component: T): T {
        const p = this.ensure(entity);
        const token = ComponentType.of<T>(component.constructor as ComponentCtor<T>);
        p.remove.delete(token);
        p.add.set(token, component);
        component.setup(entity, this);
        return Component.persistentTrack(entity, component);
    }

    public setComponent<T extends Component>(entity: Entity, component: Component): void {
        const p = this.ensure(entity);
        const token = ComponentType.of<T>(component.constructor as ComponentCtor<T>);
        p.remove.delete(token);
        p.set.set(token, component);
        component.setup(entity, this);
    }

    public setEnabledState(entity: Entity, enabled: boolean): void {
        const p = this.ensure(entity);
        p.enabled = enabled;
    }

    public setEnabledStateForQuery(entityQuery: EntityQuery<TokensOfList<any[]>, TokensOfList<any[]>>, enabled: boolean): void {
        console.log("set")
        this.enabledQueries.push({query: entityQuery, enabled});
    }


    /** Remove a component (token or ctor). */
    public removeComponent(entity: Entity, key: TokenOrCtor): void {
        const p = this.ensure(entity);
        const token = this.toToken(key);
        p.set.delete(token);
        p.add.delete(token);
        p.remove.add(token);
    }

    /**
     * Apply everything in one shot. For each entity, we compute the final set of
     * tokens = (current - removes) ∪ addOrSet and move once via EntityManager.
     */
    public playback(em: EntityManager): void {
        // 1) creations
        for (const entity of this.createOps) {
            // em.realizeEntity(this.normalizeMap(comps));
            em.realizeEntity(entity);
        }

        const world = em.world;
        // 2) modifications (skip ones that are also destroyed)
        for (const [entity, pending] of this.perEntity) {
            if (this.destroyOps.has(entity)) continue;

            const currentTokens = new Set<AnyCT>(getEntityTokens(world, entity));
            // remove first
            for (const t of pending.remove) currentTokens.delete(t);

            for (const t of pending.add.keys()) {
                if (currentTokens.has(t)) {
                    pending.add.delete(t);
                } else currentTokens.add(t);
            }

            // add/replace
            for (const t of pending.set.keys()) currentTokens.add(t);

            // build final components map
            const provided = this.normalizeMap(pending.set as Map<TokenOrCtor, Component>, pending.add as Map<TokenOrCtor, Component>);
            const finalTokens = [...currentTokens] as AnyCT[];
            const carry = getEntityComponents(world, entity); // existing comps map

            const next = new Map<AnyCT, Component>();
            for (const t of finalTokens) {
                if (provided.has(t)) next.set(t, provided.get(t)!);
                else {
                    const existed = carry.get(t);
                    if (!existed) throw new Error(`Missing component for required type during buffered apply`);
                    next.set(t, existed);
                }
            }
            this.moveEntityTo(world, entity, finalTokens, next);

            if (pending.enabled !== undefined) em.setEnabledState(entity, pending.enabled);

        }

        for (const {query, enabled} of this.enabledQueries) {
            em.setEnabledStateForQuery(query, enabled);
        }

        // 3) destruction
        this.playbackDestroy(em)

        // 4) clear
        this.reset()
    }


    // ---------- internals ----------
    private playbackDestroy(entityManager: EntityManager) {
        for (const e of this.destroyOps) {
            entityManager.destroyEntity(e);
        }

        for (const q of this.destroyQueries) {
            entityManager.destroyQuery(q);
        }
    }

    private reset() {
        this.createOps = [];
        this.destroyOps.clear();
        this.perEntity.clear();
        this.destroyQueries = [];
        this.enabledQueries = [];
    }

    /**
     * Move an entity to a specific set of component *types* (tokens or constructors),
     * using provided components for new types and reusing old ones for shared types.
     */
    private moveEntityTo(
        world: World,
        entity: Entity,
        nextTypes: readonly TokenOrCtor[],
        provided: Map<TokenOrCtor, Component> = new Map()
    ): void {
        const targetTokens = nextTypes.map(t => this.toToken(t));
        const currentArch = requireOwner(world, entity);
        const currentData = currentArch.getDataAtEntity(entity) as Map<AnyCT, Component>;
        const targetArch = world.archetypes.getOrCreate(targetTokens as AnyCT[]);

        const providedMap = this.normalizeComponents(provided).map as Map<AnyCT, Component>;
        const nextComponents = new Map<AnyCT, Component>();
        for (const t of targetArch.componentTypes as AnyCT[]) {
            if (providedMap.has(t)) {
                nextComponents.set(t, providedMap.get(t)!);
            } else {
                const existing = currentData.get(t);
                if (!existing) throw new Error(`Component for type missing during move; supply it in 'provided'.`);
                nextComponents.set(t, existing);
            }
        }
        if (currentArch === targetArch) {
            targetArch.setEntity(entity, nextComponents as Map<AnyCT, Component>, undefined, world.time);
            setOwner(world, entity, targetArch);
            return;
        }
        const isEnabled = currentArch.isEntityEnabled(entity);
        currentArch.removeEntity(entity, world.time);
        targetArch.addEntity(entity, nextComponents as Map<AnyCT, Component>, isEnabled, world.time);
        setOwner(world, entity, targetArch);
    }

    private normalizeComponents(input: Map<TokenOrCtor, Component>) {
        const map = new Map<AnyCT, Component>();
        const types: AnyCT[] = [];
        // const observe = this.options.observeComponents !== false;

        for (const [key, comp] of input) {
            const token = this.toToken(key);
            if (!map.has(token)) types.push(token);
            map.set(token, comp);
        }
        // unique tokens, preserve order
        const seen = new Set<AnyCT>();
        const uniqTypes = types.filter(t => (seen.has(t) ? false : (seen.add(t) || true)));
        return {types: uniqTypes, map};
    }

    private ensure(entity: Entity): Pending {
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

    private normalizeMap(...inputs: Map<TokenOrCtor, Component>[]): Map<AnyCT, Component> {
        const out = new Map<AnyCT, Component>();
        for (const input of inputs) {
            for (const [k, v] of input) out.set(this.toToken(k), v);
        }
        return out;
    }
}
