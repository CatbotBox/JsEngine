import type {World} from "../../src/engine/core";
import type {ComponentSchemaRegistry} from "../../src/engine/scene";
import type {ProjectHost} from "../../src/editor/project/projectEntry";
import {SWARM_COMPONENTS} from "./components";
import {setupSwarm} from "./game";
import {SWARM_RESOURCES} from "./resources";
import {installPixelRenderingSwarm} from "./launch/pixelRendering";

export function registerProjectSchemas(registry: ComponentSchemaRegistry): void {
    registry.registerComponentClasses(SWARM_COMPONENTS);
    registry.registerResourceClasses(SWARM_RESOURCES);
}

export function setupProject(world: World, host: ProjectHost): void {
    setupSwarm(world, {
        render: installPixelRenderingSwarm(world),
        quit: () => host.quit(),
    });
}
