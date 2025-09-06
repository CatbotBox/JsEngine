import {World} from "./world";
import {Entity} from "./entity";
import {Component} from "./component";
import {ComponentType, type ComponentType as CT} from "./component";
import type {ComponentCtor} from "./component";
import {setupComponentEvents} from "./component";
import type {EntityArchetype} from "./entityArchetype";
import {AnyCT, TokenOrCtor, TokensOfList} from "../util/tokenUtils";
import {EntityQuery} from "./entityQuery";
import * as Test from "node:test";
import {NAME, OWNER} from "./symbols";


type OwnerRecord = {
  world: World;
  arch: EntityArchetype<AnyCT>;
};

export class EntityManager {

  constructor(
    private world: World,
  ) {
  }

  private getOwner(entity: Entity): EntityArchetype<AnyCT> | undefined {
    const rec = (entity as any)[OWNER] as OwnerRecord | undefined;
    if (!rec) return undefined;
    if (rec.world !== this.world) {
      throw new Error("Entity belongs to a different World; use its manager.");
    }
    return rec.arch;
  }

  private setOwner(entity: Entity, arch: EntityArchetype<AnyCT> | undefined): void {
    if (!arch) {
      delete (entity as any)[OWNER];
      return;
    }
    (entity as any)[OWNER] = {world: this.world, arch} as OwnerRecord;
  }

  private requireOwner(entity: Entity): EntityArchetype<AnyCT> {
    const arch = this.getOwner(entity);
    if (!arch) throw new Error("Has entity been created by the EntityManager?");
    return arch;
  }

  // ---------- creation / destruction ----------

  /** Create an entity with the given components (keys can be tokens or ctors). */
    // public createEntity(components: Map<TokenOrCtor, Component> = new Map()): Entity {
  private static emptyMap: Map<AnyCT, Component> = new Map();

  public createEntity(name?:string): Entity {
    // const {types, map} = this.normalizeComponents(components);
    // const arch = this.world.archtypes.getOrCreate(types as AnyCT[]);
    const arch = this.world.archetypes.getOrCreate([] as AnyCT[]);
    const e = new Entity();
    (e as any)[NAME] = name;
    // arch.addEntity(e, map as Map<AnyCT, Component>);
    arch.addEntity(e, EntityManager.emptyMap);
    this.setOwner(e, arch as EntityArchetype<AnyCT>);
    return e;
  }

  public realizeEntity(entity: Entity) {
    // const {types, map} = this.normalizeComponents(components);
    const arch = this.world.archetypes.getOrCreate([] as AnyCT[]);
    arch.addEntity(entity, EntityManager.emptyMap);
    this.setOwner(entity, arch as EntityArchetype<AnyCT>);
    return entity;
  }

  /** Destroy an entity (remove from its archetype). */
  public destroyEntity(entity: Entity): void {
    const arch = this.getOwner(entity);
    if (arch) {
      arch.removeEntity(entity);
      this.setOwner(entity, undefined);
      return;
    }
    // Fallback scan if owner not tracked (should be rare)
    for (const a of this.world.archetypes.values() as Iterable<EntityArchetype<AnyCT>>) {
      try {
        a.getDataAtEntity(entity); // throws if not there
        a.removeEntity(entity);
        break;
      } catch {
      }
    }
    this.setOwner(entity, undefined);
  }

  public destroy(entityQuery: EntityQuery<TokensOfList<any[]>, TokensOfList<any[]>>): void {
    for (const archtype of entityQuery.archtypes) {
      archtype.removeAll();
    }
    for (const entity of entityQuery) {
      this.setOwner(entity, undefined);
    }
  }

  // ---------- simple edits (immediate) ----------

  public addComponent<T extends Component>(entity: Entity, component: Component): void {
    this.setComponent(entity, component);
  }

  public setComponent<T extends Component>(entity: Entity, component: T): void {
    const token = ComponentType.of<T>(component.constructor as ComponentCtor<T>);
    // console.log(token)
    const currentArch = this.requireOwner(entity);
    const currentData = currentArch.getDataAtEntity(entity) as Map<AnyCT, Component>;
    // next tokens = current ∪ {token}
    const nextTokens = new Set(currentArch.componentTypes as AnyCT[]);
    nextTokens.add(token);
    const targetArch = this.world.archetypes.getOrCreate([...nextTokens]);
    // components to carry over
    const nextComponents = new Map<AnyCT, Component>();
    for (const t of targetArch.componentTypes as AnyCT[]) {
      if (t === token) {
        nextComponents.set(t, this.wrap(component));
      } else {
        const c = currentData.get(t);
        if (!c) throw new Error(`Missing component for required type during upsert`);
        nextComponents.set(t, c);
      }
    }
    this.moveEntityInternal(entity, currentArch, targetArch, nextComponents);
  }

  /**
   * Remove a component from an entity (no error if it didn't exist).
   * Moves to the correct archetype in one step.
   */
  public removeComponent(entity: Entity, key: TokenOrCtor): void {
    const token = this.toToken(key);
    const currentArch = this.requireOwner(entity);
    const currentData = currentArch.getDataAtEntity(entity) as Map<AnyCT, Component>;
    if (!currentData.has(token)) return; // nothing to do

    // next tokens = current \ {token}
    const nextTokens = (currentArch.componentTypes as AnyCT[]).filter(t => t !== token);
    const targetArch = this.world.archetypes.getOrCreate(nextTokens);

    const nextComponents = new Map<AnyCT, Component>();
    for (const t of targetArch.componentTypes as AnyCT[]) {
      const c = currentData.get(t);
      if (!c) throw new Error(`Missing component for required type during removal`);
      nextComponents.set(t, c);
    }
    this.moveEntityInternal(entity, currentArch, targetArch, nextComponents);
  }

  /**
   * Move an entity to a specific set of component *types* (tokens or ctors),
   * using provided components for new types and reusing old ones for shared types.
   */
  public moveEntityTo(
    entity: Entity,
    nextTypes: readonly TokenOrCtor[],
    provided: Map<TokenOrCtor, Component> = new Map()
  ): void {
    const targetTokens = nextTypes.map(t => this.toToken(t));
    const currentArch = this.requireOwner(entity);
    const currentData = currentArch.getDataAtEntity(entity) as Map<AnyCT, Component>;
    const targetArch = this.world.archetypes.getOrCreate(targetTokens as AnyCT[]);

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
    this.moveEntityInternal(entity, currentArch, targetArch, nextComponents);
  }

  // ---------- queries / helpers ----------

  /** Get all tokens currently on an entity. */
  public getEntityTokens(entity: Entity): readonly AnyCT[] {
    return this.requireOwner(entity).componentTypes as readonly AnyCT[];
  }

  /** Snapshot of the entity's components as a Map. */
  public getEntityComponents(entity: Entity): Map<AnyCT, Component> {
    const arch = this.requireOwner(entity);
    return arch.getDataAtEntity(entity) as Map<AnyCT, Component>;
  }

  // ---------- internals ----------

  private moveEntityInternal(
    entity: Entity,
    from: EntityArchetype<AnyCT>,
    to: EntityArchetype<AnyCT>,
    components: Map<AnyCT, Component>
  ): void {
    if (from === to) {
      to.setEntity(entity, components as Map<AnyCT, Component>);
      this.setOwner(entity, to);
      return;
    }
    from.removeEntity(entity);
    to.addEntity(entity, components as Map<AnyCT, Component>);
    this.setOwner(entity, to);
  }

  private toToken(key: TokenOrCtor): AnyCT {
    return (typeof key === "function")
      ? ComponentType.of(key as ComponentCtor<Component>)
      : (key as AnyCT);
  }

  private wrap<C extends Component>(c: C): C {
    return setupComponentEvents(c);
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
}
