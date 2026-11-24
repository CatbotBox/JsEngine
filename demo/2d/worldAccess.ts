import {EntityCommandBufferSystem} from "@jsengine/engine/core";
import type {EntityCommandBuffer, World} from "@jsengine/engine/core";

export const INCLUDING_DISABLED = {includeDisabled: true} as const;
export const ENTITIES_INCLUDING_DISABLED = {includeEntity: true, includeDisabled: true} as const;

export function commandBufferOf(world: World): EntityCommandBuffer {
    return world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
}
