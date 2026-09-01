/**
 * An entity is a branded 32-bit integer handle: the low 20 bits index the global
 * side tables in ownership.ts (owner archetype, row, generation, debug name), the
 * high 12 bits carry a generation counter. Destroying an entity bumps its slot's
 * generation, so a stale handle to a destroyed-and-recycled slot is *detected*
 * (lookups return undefined) rather than silently aliasing the new occupant.
 *
 * The brand mirrors Vec's: runtime representation is a plain number, the type is
 * opaque so a raw number is a compile error where an Entity is expected.
 */
/**
 * The brand is an ambient empty enum rather than Vec's `unique symbol`
 * intersection: an intersection of number-and-object "resolves to no runtime
 * shape" under scriptc and disqualified every function whose signature mentions
 * Entity (141 -> 60 analyzed statements). An ambient enum is erased at runtime,
 * scriptc lowers it as a number, and TypeScript still rejects a raw number where
 * an Entity is expected.
 */
export declare enum EntityBrandEnum {}

export type Entity = EntityBrandEnum;

export const ENTITY_INDEX_BITS = 20;
/** Max 1,048,575 concurrently-alive entities. */
export const ENTITY_INDEX_MASK = (1 << ENTITY_INDEX_BITS) - 1;
/** 12 generation bits; generation 0 is reserved as "never valid". */
export const ENTITY_GENERATION_MASK = 0xFFF;

/**
 * The zero handle: index 0 at generation 0. Generations start at 1 and skip 0 on
 * wrap, so this never names a live entity — safe as "no entity".
 */
export const NULL_ENTITY = 0 as Entity;

export function entityIndexOf(e: Entity): number {
    return e & ENTITY_INDEX_MASK;
}

export function entityGenerationOf(e: Entity): number {
    return e >>> ENTITY_INDEX_BITS;
}

export function makeEntityHandle(index: number, generation: number): Entity {
    return (((generation << ENTITY_INDEX_BITS) | index) >>> 0) as Entity;
}
