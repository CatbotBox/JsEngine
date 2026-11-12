export declare enum EntityBrandEnum {}

export type Entity = EntityBrandEnum;

const ENTITY_GENERATION_BITS = 12;

export const ENTITY_INDEX_BITS = 20;
export const ENTITY_INDEX_MASK = (1 << ENTITY_INDEX_BITS) - 1;
export const ENTITY_GENERATION_MASK = (1 << ENTITY_GENERATION_BITS) - 1;

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
