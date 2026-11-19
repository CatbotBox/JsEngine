import type {World} from "../../src/engine/core";
import type {ComponentSchemaRegistry} from "../../src/engine/scene";
import {setupDemo2d} from "./game";
import {registerGeneratedSchemas} from "./schemas.generated";
import {Demo2dCellsControlsSystem} from "./backend/cells/demo2dCellsControlsSystem";

export function registerProjectSchemas(registry: ComponentSchemaRegistry): void {
    registerGeneratedSchemas(registry);
}

export function setupProject(world: World): void {
    world.ensureSystemExists(Demo2dCellsControlsSystem);
    setupDemo2d(world);
}
