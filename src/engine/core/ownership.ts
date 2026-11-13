import {Entity, ENTITY_GENERATION_MASK, ENTITY_INDEX_BITS, ENTITY_INDEX_MASK, makeEntityHandle} from "./entity";
import type {EntityArchetype} from "./entityArchetype";
import type {AnyCT} from "../util/tokenUtils";
import type {World} from "./world";

const UNOWNED_ROW = -1;
const NEVER_VALID_GENERATION = 0;
const FIRST_GENERATION = 1;

const generations: number[] = [];
const worldOf: unknown[] = [];
const archOf: unknown[] = [];
const rowOf: number[] = [];
const nameOf: (string | undefined)[] = [];
const creationOrderOf: number[] = [];
const freeIndices: number[] = [];
let nextIndex = 0;
let nextCreationOrder = 0;

export function allocEntityHandle(name?: string): Entity {
    let i: number;
    if (freeIndices.length > 0) {
        i = freeIndices.pop()!;
    } else {
        i = nextIndex++;
        if (i > ENTITY_INDEX_MASK) throw new Error("Entity index space exhausted (2^20 concurrent entities)");
        generations[i] = FIRST_GENERATION;
        worldOf[i] = undefined;
        archOf[i] = undefined;
        rowOf[i] = UNOWNED_ROW;
    }
    nameOf[i] = name;
    creationOrderOf[i] = nextCreationOrder++;
    return makeEntityHandle(i, generations[i]);
}

export function freeEntityHandle(e: Entity): void {
    const i = e & ENTITY_INDEX_MASK;
    const slotAlreadyRecycled = generations[i] !== e >>> ENTITY_INDEX_BITS;
    if (slotAlreadyRecycled) return;
    let g = (generations[i] + 1) & ENTITY_GENERATION_MASK;
    if (g === NEVER_VALID_GENERATION) g = FIRST_GENERATION;
    generations[i] = g;
    worldOf[i] = undefined;
    archOf[i] = undefined;
    rowOf[i] = UNOWNED_ROW;
    nameOf[i] = undefined;
    freeIndices.push(i);
}

export function getOwnerInferred(entity: Entity): EntityArchetype<AnyCT> | undefined {
    const i = entity & ENTITY_INDEX_MASK;
    const destroyedOrRecycled = generations[i] !== entity >>> ENTITY_INDEX_BITS;
    if (destroyedOrRecycled) return undefined;
    return archOf[i] as EntityArchetype<AnyCT> | undefined;
}

export function getOwner(world: World, entity: Entity): EntityArchetype<AnyCT> | undefined {
    const i = entity & ENTITY_INDEX_MASK;
    if (generations[i] !== entity >>> ENTITY_INDEX_BITS) return undefined;
    const arch = archOf[i] as EntityArchetype<AnyCT> | undefined;
    if (arch === undefined) return undefined;
    if (worldOf[i] !== world) {
        throw new Error("Entity belongs to a different World; use its manager.");
    }
    return arch;
}

export function setOwner(world: World, entity: Entity, arch: EntityArchetype<AnyCT> | undefined): void {
    const i = entity & ENTITY_INDEX_MASK;
    const staleHandle = generations[i] !== entity >>> ENTITY_INDEX_BITS;
    if (staleHandle) return;
    if (arch === undefined) {
        worldOf[i] = undefined;
        archOf[i] = undefined;
        rowOf[i] = UNOWNED_ROW;
        return;
    }
    worldOf[i] = world;
    archOf[i] = arch;
}

export function requireOwner(world: World, entity: Entity): EntityArchetype<AnyCT> {
    const arch = getOwner(world, entity);
    if (!arch) throw new Error("Has entity been created by the EntityManager?");
    return arch;
}

export function getEntityRow(entity: Entity): number {
    const row = rowOf[entity & ENTITY_INDEX_MASK];
    return row === undefined ? UNOWNED_ROW : row;
}

export function setEntityRow(entity: Entity, row: number): void {
    rowOf[entity & ENTITY_INDEX_MASK] = row;
}

export function getEntityName(entity: Entity): string | undefined {
    const i = entity & ENTITY_INDEX_MASK;
    if (generations[i] !== entity >>> ENTITY_INDEX_BITS) return undefined;
    return nameOf[i];
}

export function getEntityCreationOrder(entity: Entity): number | undefined {
    const i = entity & ENTITY_INDEX_MASK;
    if (generations[i] !== entity >>> ENTITY_INDEX_BITS) return undefined;
    return creationOrderOf[i];
}
