import type {World} from "../../../src/engine/core";
import type {ScenePreload} from "../../../src/engine/scene";
import {registerCellsComponentSchemas} from "../../../src/backends/cells/cellsComponentSchemas";
import {registerPixelsComponentSchemas} from "../../../src/backends/pixels/pixelsComponentSchemas";
import type {ProjectRenderBackend} from "../../../src/engine/project/projectEntry";
import {launchProject} from "../../../src/engine/project/projectLaunch";
import type {LaunchedProject} from "../../../src/engine/project/projectLaunch";
import type {SchemaRegistration} from "../../../src/engine/project/projectSchemas";
import {setupDemo2d} from "../game";
import type {Demo2dRenderControls} from "../game";
import * as generatedSchemas from "../schemas.generated";

export const DEMO_2D_PROJECT_DIRECTORY = "demo/2d";

const DEMO_2D_BACKEND_SCHEMAS: readonly SchemaRegistration[] = [registerCellsComponentSchemas, registerPixelsComponentSchemas];

export interface Demo2dLaunch {
    readonly renderBackend: ProjectRenderBackend;
    readonly directory?: string;
    readonly preload?: ScenePreload;
    installRendering(world: World): Demo2dRenderControls;
    quit(): void;
}

export function launchDemo2d(world: World, launch: Demo2dLaunch): Promise<LaunchedProject> {
    return launchProject(world, {
        directory: launch.directory ?? DEMO_2D_PROJECT_DIRECTORY,
        entry: {
            registerProjectSchemas: generatedSchemas.registerGeneratedSchemas,
            setupProject: () => setupDemo2d(world, {render: launch.installRendering(world), quit: () => launch.quit()}),
        },
        schemas: {backendSchemas: DEMO_2D_BACKEND_SCHEMAS, generated: generatedSchemas},
        renderBackend: launch.renderBackend,
        preload: launch.preload,
        quit: () => launch.quit(),
    });
}
