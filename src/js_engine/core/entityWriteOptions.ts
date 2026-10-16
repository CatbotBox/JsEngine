import {Entity} from "./entity";
import {Component} from "./component";
import {TokenOrCtor, TokensOfList} from "../util/tokenUtils";
import {EntityQuery} from "./entityQuery";

export interface EntityWriteOptions {

  /** Create an entity holding `components`, placed once; a type listed twice keeps its first instance. */
  createEntity(name?: string, components?: readonly Component[]): Entity;

  /** Queue entity destruction. */
  destroyEntity(entity: Entity): void;

  addComponent<T extends Component>(entity: Entity, component: T): Readonly<T>;

  addTrackedComponent<T extends Component>(entity: Entity, component: T): T;

  /** Add several components in one move; setup() runs per added component, in array order. */
  addComponents(entity: Entity, components: readonly Component[]): void;

  setComponent<T extends Component>(entity: Entity, component: Component): void;

  setEnabledState(entity: Entity, enabled: boolean): void;

  /** Remove a component (token or ctor). */
  removeComponent(entity: Entity, key: TokenOrCtor): void;

  // Mass operations

  setEnabledStateForQuery(entityQuery: EntityQuery<TokensOfList<any[]>, TokensOfList<any[]>>, enabled: boolean): void;

  destroyQuery(entityQuery: EntityQuery<TokensOfList<any[]>, TokensOfList<any[]>>): void;
}

