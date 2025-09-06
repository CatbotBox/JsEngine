import {Entity} from "./entity";
import {Component, ComponentOf} from "./component";
import {ComponentType, type ComponentType as CT} from "./component";
import type {ComponentCtor} from "./component";
import {EntityManager} from "./EntityManager";
import {AnyCT, TokenOrCtor} from "../util/tokenUtils";
import {NAME} from "./symbols";

type Pending = {
  addOrSet: Map<AnyCT, Component>; // upserts
  remove: Set<AnyCT>;
};

export class EntityChangeBuffer {
  private createOps: Array<Entity> = [];
  private destroyOps: Set<Entity> = new Set();
  private perEntity: Map<Entity, Pending> = new Map();

  /** Queue entity creation. */
  public createEntity(name?:string): Entity {
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

  public addComponent<T extends Component>(entity: Entity, component: T): void {
    this.setComponent(entity, component);
  }

  public setComponent<T extends Component>(entity: Entity, component: Component): void {
    const p = this.ensure(entity);
    const token = ComponentType.of<T>(component.constructor as ComponentCtor<T>);
    p.remove.delete(token);
    p.addOrSet.set(token, component);
  }

  /** Remove a component (token or ctor). */
  public remove(entity: Entity, key: TokenOrCtor): void {
    const p = this.ensure(entity);
    const token = this.toToken(key);
    p.addOrSet.delete(token);
    p.remove.add(token);
  }

  /**
   * Apply everything in one shot. For each entity, we compute the final set of
   * tokens = (current - removes) ∪ addOrSet and move once via EntityManager.
   */
  public apply(em: EntityManager): void {
    // 1) creations
    for (const entity of this.createOps) {
      // em.realizeEntity(this.normalizeMap(comps));
      em.realizeEntity(entity);
    }

    // 2) modifications (skip ones that are also destroyed)
    for (const [entity, pending] of this.perEntity) {
      if (this.destroyOps.has(entity)) continue;

      const currentTokens = new Set<AnyCT>(em.getEntityTokens(entity));
      // remove first
      for (const t of pending.remove) currentTokens.delete(t);
      // add/replace
      for (const t of pending.addOrSet.keys()) currentTokens.add(t);

      // build final components map
      const provided = this.normalizeMap(pending.addOrSet as Map<TokenOrCtor, Component>);
      const finalTokens = [...currentTokens] as AnyCT[];
      const carry = em.getEntityComponents(entity); // existing comps map

      const next = new Map<AnyCT, Component>();
      for (const t of finalTokens) {
        if (provided.has(t)) next.set(t, provided.get(t)!);
        else {
          const existed = carry.get(t);
          if (!existed) throw new Error(`Missing component for required type during buffered apply`);
          next.set(t, existed);
        }
      }
      em.moveEntityTo(entity, finalTokens, next);
    }

    // 3) destructions
    for (const e of this.destroyOps) {
      em.destroyEntity(e);
    }

    // 4) clear
    this.createOps = [];
    this.destroyOps.clear();
    this.perEntity.clear();
  }

  // ---------- internals ----------

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
