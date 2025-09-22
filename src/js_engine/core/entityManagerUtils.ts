import {Entity} from "./entity";
import {AnyCT} from "../util/tokenUtils";
import {World} from "./world";
import {Component} from "./component";
import {requireOwner} from "./ownership";

/** Get all tokens currently on an entity. */
export function getEntityTokens(world: World, entity: Entity): readonly AnyCT[] {
    return requireOwner(world, entity).componentTypes as readonly AnyCT[];
}

/** Snapshot of the entity's components as a Map. */
export function getEntityComponents(world: World, entity: Entity): Map<AnyCT, Component> {
    const arch = requireOwner(world, entity);
    return arch.getDataAtEntity(entity) as Map<AnyCT, Component>;
}
