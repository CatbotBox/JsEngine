import type {World} from "../../src/engine/core";
import type {ComponentSchemaRegistry} from "../../src/engine/scene";
import type {ProjectHost} from "../../src/engine/project/projectEntry";
import {setupDemo2d} from "./game";
import {registerGeneratedSchemas} from "./schemas.generated";
import {installPixelRendering2d} from "./launch/pixelRendering";

export function registerProjectSchemas(registry: ComponentSchemaRegistry): void {
    registerGeneratedSchemas(registry);
}

export function setupProject(world: World, host: ProjectHost): void {
    setupDemo2d(world, {
        render: installPixelRendering2d(world),
        quit: () => host.quit(),
    });
}
