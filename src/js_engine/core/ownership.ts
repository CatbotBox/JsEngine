import {Entity} from "./entity";
import {EntityArchetype} from "./entityArchetype";
import {AnyCT} from "../util/tokenUtils";
import {OWNER} from "./symbols";
import {World} from "./world";

export type OwnerRecord = {
  world: World;
  arch: EntityArchetype<AnyCT>;
};

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