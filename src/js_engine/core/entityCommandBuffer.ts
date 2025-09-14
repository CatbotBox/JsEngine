import {Entity} from "./entity";
import {Component, ComponentOf, setupComponentEvents} from "./component";
import {ComponentType, type ComponentType as CT} from "./component";
import type {ComponentCtor} from "./component";
import {EntityManager} from "./entityManager";
import {AnyCT, TokenOrCtor, TokensOfList} from "../util/tokenUtils";
import {NAME} from "./symbols";
import {EntityWriteOptions} from "./entityWriteOptions";
import {EntityQuery} from "./entityQuery";
import {World} from "./world";
import {requireOwner, setOwner} from "./ownership";
import type {EntityArchetype} from "./entityArchetype";

type Pending = {
  addOrSet: Map<AnyCT, Component>; // upserts
  remove: Set<AnyCT>;
  enabled?: boolean; // optional enable/disable
};

/** Get all tokens currently on an entity. */
function getEntityTokens(world: World, entity: Entity): readonly AnyCT[] {
  return requireOwner(world, entity).componentTypes as readonly AnyCT[];
}

/** Snapshot of the entity's components as a Map. */
function getEntityComponents(world: World, entity: Entity): Map<AnyCT, Component> {
  const arch = requireOwner(world, entity);
  return arch.getDataAtEntity(entity) as Map<AnyCT, Component>;
}


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

  public addComponent<T extends Component>(entity: Entity, component: T): void {
    this.setComponent(entity, component);
  }

  public setComponent<T extends Component>(entity: Entity, component: Component): void {
    const p = this.ensure(entity);
    const token = ComponentType.of<T>(component.constructor as ComponentCtor<T>);
    p.remove.delete(token);
    p.addOrSet.set(token, component);
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
    p.addOrSet.delete(token);
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
      // add/replace
      for (const t of pending.addOrSet.keys()) currentTokens.add(t);

      // build final components map
      const provided = this.normalizeMap(pending.addOrSet as Map<TokenOrCtor, Component>);
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
    
    // 3) destructions
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
   * Move an entity to a specific set of component *types* (tokens or ctors),
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
      targetArch.setEntity(entity, nextComponents as Map<AnyCT, Component>);
      setOwner(world, entity, targetArch);
      return;
    }
    const isEnabled = currentArch.isEntityEnabled(entity);
    currentArch.removeEntity(entity);
    targetArch.addEntity(entity, nextComponents as Map<AnyCT, Component>, isEnabled);
    setOwner(world, entity, targetArch);
  }

  private normalizeComponents(input: Map<TokenOrCtor, Component>) {
    const map = new Map<AnyCT, Component>();
    const types: AnyCT[] = [];
    // const observe = this.options.observeComponents !== false;

    for (const [key, comp] of input) {
      const token = this.toToken(key);
      const wrapped = setupComponentEvents(comp);
      if (!map.has(token)) types.push(token);
      map.set(token, wrapped);
    }
    // unique tokens, preserve order
    const seen = new Set<AnyCT>();
    const uniqTypes = types.filter(t => (seen.has(t) ? false : (seen.add(t), true)));
    return {types: uniqTypes, map};
  }

  private ensure(entity: Entity): Pending {
    let p = this.perEntity.get(entity);
    if (!p) {
      p = {addOrSet: new Map(), remove: new Set()};
      this.perEntity.set(entity, p);
    }
    return p;
  }

  private toToken(k: TokenOrCtor): AnyCT {
    return (typeof k === "function")
      ? ComponentType.of(k as ComponentCtor<Component>)
      : (k as AnyCT);
  }

  private normalizeMap(input: Map<TokenOrCtor, Component>): Map<AnyCT, Component> {
    const out = new Map<AnyCT, Component>();
    for (const [k, v] of input) out.set(this.toToken(k), v);
    return out;
  }
}
