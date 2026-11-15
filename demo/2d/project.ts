import type {World} from "../../src/engine/core";
import type {ComponentSchemaRegistry} from "../../src/engine/scene";
import type {ProjectHost} from "../../src/editor/project/projectEntry";
import {requireDebugWorld} from "../_shared/debugWorld";
import {DEMO_2D_COMPONENTS, setupDemo2d} from "./game";
import {installPixelRendering2d} from "./launch/pixelRendering";

export function registerProjectSchemas(registry: ComponentSchemaRegistry): void {
    registry.registerComponentClasses(DEMO_2D_COMPONENTS);
}

export function setupProject(world: World, host: ProjectHost): void {
    const debugWorld = requireDebugWorld(world, "The 2D demo");
    setupDemo2d(debugWorld, {
        render: installPixelRendering2d(debugWorld),
        quit: () => host.quit(),
    });
}
