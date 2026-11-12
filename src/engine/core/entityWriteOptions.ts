import {Entity} from "./entity";
import {Component} from "./component";
import {TokenOrCtor, TokensOfList} from "../util/tokenUtils";
import {EntityQuery} from "./entityQuery";

export interface EntityWriteOptions {

  createEntity(name?: string, components?: readonly Component[]): Entity;

  destroyEntity(entity: Entity): void;

  addComponent<T extends Component>(entity: Entity, component: T): Readonly<T>;

  addTrackedComponent<T extends Component>(entity: Entity, component: T): T;

  addComponents(entity: Entity, components: readonly Component[]): void;

  setComponent<T extends Component>(entity: Entity, component: Component): void;

  setEnabledState(entity: Entity, enabled: boolean): void;

  removeComponent(entity: Entity, key: TokenOrCtor): void;

  setEnabledStateForQuery(entityQuery: EntityQuery<TokensOfList<any[]>, TokensOfList<any[]>>, enabled: boolean): void;

  destroyQuery(entityQuery: EntityQuery<TokensOfList<any[]>, TokensOfList<any[]>>): void;
}

