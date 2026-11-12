import {Component} from "./component";
import {Entity} from "./entity";
import {TokenOrCtor} from "../util/tokenUtils";

export interface EntityReadOptions {
  hasComponent<T extends Component>(entity: Entity, key: TokenOrCtor): boolean;

  getComponent<T extends Component>(entity: Entity, key: TokenOrCtor): T | undefined;

  isEnabled(entity: Entity): boolean;

  exists(entity: Entity): boolean;
}