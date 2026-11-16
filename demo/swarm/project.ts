import type {World} from "../../src/engine/core";
import type {ComponentSchemaRegistry} from "../../src/engine/scene";
import type {ProjectHost} from "../../src/editor/project/projectEntry";
import {setupSwarm} from "./game";
import {registerGeneratedSchemas} from "./schemas.generated";
import {installPixelRenderingSwarm} from "./launch/pixelRendering";

export function registerProjectSchemas(registry: ComponentSchemaRegistry): void {
    registerGeneratedSchemas(registry);
}

export function setupProject(world: World, host: ProjectHost): void {
    setupSwarm(world, {
        render: installPixelRenderingSwarm(world),
        quit: () => host.quit(),
    });
}
