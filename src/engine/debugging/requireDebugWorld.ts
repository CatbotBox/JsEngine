import {DebugWorld} from "../core/debugWorld";
import type {World} from "../core/world";

export function requireDebugWorld(world: World, game: string): DebugWorld {
    if (world instanceof DebugWorld) return world;
    throw new Error(`${game} needs a DebugWorld, got a ${world.constructor.name}`);
}
