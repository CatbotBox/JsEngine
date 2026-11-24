import {EntityCommandBufferSystem, Resource} from "@jsengine/engine/core";
import type {EntityCommandBuffer, World} from "@jsengine/engine/core";
import {SCREEN_UNIT_HEIGHT_PER_WIDTH} from "@jsengine/engine/rendering";
import {LocalPosition} from "@jsengine/engine/translation";
import type {PrefabAsset} from "@jsengine/engine/scene";
import {Random} from "@jsengine/engine/math";
import {SWARM_CONFIG_FILE, SwarmConfig} from "./config";

export const HALF = 0.5;
// Speeds, radii and the grid are in screen-unit widths; scale y by this so motion is isotropic on both backends.
export const WIDTH_UNITS_PER_SCREEN_UNIT_Y = SCREEN_UNIT_HEIGHT_PER_WIDTH;
export const POSITION_STRIDE = LocalPosition.f32Width;
export const POSITION_X = 0;
export const POSITION_Y = 1;
export const VISIBLE_OPACITY = 1;
export const HIDDEN_OPACITY = 0;
export const NO_EXTENT = 0;
export const ENEMY_PREFAB_FIELD = "waves.enemies[].prefab";

export class SwarmArena extends Resource {
    public halfWidthUnits = 0;
    public halfHeightUnits = 0;
}

export function fullExtentOf(halfExtent: number): number {
    return halfExtent / HALF;
}

export function randomOf(world: World): Random {
    const random = world.resources.getOrCreate(Random);
    random.reseedIfChanged(world.resources.get(SwarmConfig).randomSeed);
    return random;
}

export function simulationStepMs(world: World): number {
    return Math.min(world.time.deltaTimeMs, world.resources.get(SwarmConfig).maxSimulationStepMs);
}

export function commandBufferOf(world: World): EntityCommandBuffer {
    return world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
}

export function requirePrefab(prefab: PrefabAsset | undefined, field: string): PrefabAsset {
    if (prefab === undefined) throw new Error(`SwarmConfig.${field} names no prefab: set it in ${SWARM_CONFIG_FILE}`);
    return prefab;
}
