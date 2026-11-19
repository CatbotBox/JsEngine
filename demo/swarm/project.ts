import type {World} from "../../src/engine/core";
import type {ComponentSchemaRegistry} from "../../src/engine/scene";
import {setupSwarm} from "./game";
import {registerGeneratedSchemas} from "./schemas.generated";

export function registerProjectSchemas(registry: ComponentSchemaRegistry): void {
    registerGeneratedSchemas(registry);
}

export function setupProject(world: World): void {
    setupSwarm(world, {});
}
