import type {System, SystemCtor} from "./system";
import type {World} from "./world";

export function createSystems(world: World, systems: readonly SystemCtor<System>[]): void {
    for (const system of systems) world.getOrCreateSystem(system);
}
