import {DebugWorld} from "../../src/engine/core";
import type {World} from "../../src/engine/core";

export function requireDebugWorld(world: World, game: string): DebugWorld {
    if (world instanceof DebugWorld) return world;
    throw new Error(`${game} needs a DebugWorld, got a ${world.constructor.name}`);
}
