import {Entity} from "./entity";
import {Component} from "./component";
import {TokenOrCtor, TokensOfList} from "../util/tokenUtils";
import {EntityQuery} from "./entityQuery";

export interface EntityWriteOptions {

  /** Queue entity creation. */
  createEntity(name?: string): Entity;

  /** Queue entity destruction. */
  destroyEntity(entity: Entity): void;

  addComponent<T extends Component>(entity: Entity, component: T): void;

  setComponent<T extends Component>(entity: Entity, component: Component): void;

  setEnabledState(entity: Entity, enabled: boolean): void;

  /** Remove a component (token or ctor). */
  removeComponent(entity: Entity, key: TokenOrCtor): void;


  // Mass operations

  setEnabledStateForQuery(entityQuery: EntityQuery<TokensOfList<any[]>, TokensOfList<any[]>>, enabled: boolean): void;

  destroyQuery(entityQuery: EntityQuery<TokensOfList<any[]>, TokensOfList<any[]>>): void;
}

