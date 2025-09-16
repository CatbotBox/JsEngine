import {Entity} from "./entity";
import {EntityArchetype} from "./entityArchetype";
import {AnyCT} from "../util/tokenUtils";
import {World} from "./world";

export const OWNER = Symbol("ecs_owner");

export type OwnerRecord = {
    world: World;
    arch: EntityArchetype<AnyCT>;
};

export function getOwnerInferred(entity: Entity): EntityArchetype<AnyCT> | undefined {
    const rec = (entity as any)[OWNER] as OwnerRecord | undefined;
    if (!rec) return undefined; // entity deleted or not fully created yet
    if (rec.world === undefined) {
        throw new Error("Entity does not belong to any world, was it initialized correctly?");
    }
    return rec.arch;
}

export function getOwner(world: World, entity: Entity): EntityArchetype<AnyCT> | undefined {
    const rec = (entity as any)[OWNER] as OwnerRecord | undefined;
    if (!rec) return undefined;
    if (rec.world !== world) {
        throw new Error("Entity belongs to a different World; use its manager.");
    }
    return rec.arch;
}

export function setOwner(world: World, entity: Entity, arch: EntityArchetype<AnyCT> | undefined): void {
    if (!arch) {
        delete (entity as any)[OWNER];
        return;
    }
    (entity as any)[OWNER] = {world: world, arch} as OwnerRecord;
}

export function requireOwner(world: World, entity: Entity): EntityArchetype<AnyCT> {
    const arch = getOwner(world, entity);
    if (!arch) throw new Error("Has entity been created by the EntityManager?");
    return arch;
}