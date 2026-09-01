import {Entity, ENTITY_GENERATION_MASK, ENTITY_INDEX_BITS, ENTITY_INDEX_MASK, makeEntityHandle} from "./entity";
import type {EntityArchetype} from "./entityArchetype";
import type {AnyCT} from "../util/tokenUtils";
import type {World} from "./world";

/**
 * The global entity registry: parallel side tables indexed by an entity handle's
 * low bits. An entity is an integer, so everything about it lives here: its owner
 * archetype, its world, its row within that archetype, and its debug name.
 *
 * Global rather than per-World on purpose: `getOwnerInferred` has no world
 * argument, and cross-world misuse must throw (as before), not silently read
 * another world's slot.
 */
// The world/arch tables are deliberately untyped: a top-level declaration whose
// type mentions EntityArchetype (whose Maps scriptc cannot lower) disqualifies
// this whole module from static analysis. The exported accessors carry the types.
const generations: number[] = [];
const worldOf: unknown[] = [];
const archOf: unknown[] = [];
/** Row within the owning archetype's dense arrays; -1 when unowned. */
const rowOf: number[] = [];
const nameOf: (string | undefined)[] = [];
const freeIndices: number[] = [];
let nextIndex = 0;

export function allocEntityHandle(name?: string): Entity {
    let i: number;
    if (freeIndices.length > 0) {
        i = freeIndices.pop()!;
    } else {
        i = nextIndex++;
        if (i > ENTITY_INDEX_MASK) throw new Error("Entity index space exhausted (2^20 concurrent entities)");
        generations[i] = 1;
        worldOf[i] = undefined;
        archOf[i] = undefined;
        rowOf[i] = -1;
    }
    nameOf[i] = name;
    return makeEntityHandle(i, generations[i]);
}

/**
 * Retire a handle: bump the slot's generation (so every outstanding copy of this
 * handle goes stale) and recycle the index. Double-frees are no-ops — the stale
 * handle no longer matches the slot.
 */
export function freeEntityHandle(e: Entity): void {
    const i = e & ENTITY_INDEX_MASK;
    if (generations[i] !== e >>> ENTITY_INDEX_BITS) return; // stale: slot already recycled
    let g = (generations[i] + 1) & ENTITY_GENERATION_MASK;
    if (g === 0) g = 1; // generation 0 is reserved for "never valid"
    generations[i] = g;
    worldOf[i] = undefined;
    archOf[i] = undefined;
    rowOf[i] = -1;
    nameOf[i] = undefined;
    freeIndices.push(i);
}

export function getOwnerInferred(entity: Entity): EntityArchetype<AnyCT> | undefined {
    const i = entity & ENTITY_INDEX_MASK;
    if (generations[i] !== entity >>> ENTITY_INDEX_BITS) return undefined; // destroyed or recycled
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
    if (generations[i] !== entity >>> ENTITY_INDEX_BITS) return; // stale handle owns nothing
    if (arch === undefined) {
        worldOf[i] = undefined;
        archOf[i] = undefined;
        rowOf[i] = -1;
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

// ---- row + name accessors (hot paths: no generation check; the archetype's
// dense array is the source of truth and validates the handle it hands back) ----

export function getEntityRow(entity: Entity): number {
    const row = rowOf[entity & ENTITY_INDEX_MASK];
    return row === undefined ? -1 : row;
}

export function setEntityRow(entity: Entity, row: number): void {
    rowOf[entity & ENTITY_INDEX_MASK] = row;
}

export function getEntityName(entity: Entity): string | undefined {
    const i = entity & ENTITY_INDEX_MASK;
    if (generations[i] !== entity >>> ENTITY_INDEX_BITS) return undefined;
    return nameOf[i];
}
