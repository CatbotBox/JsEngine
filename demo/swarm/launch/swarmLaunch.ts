import type {World} from "../../../src/engine/core";
import type {ScenePreload} from "../../../src/engine/scene";
import {registerCellsComponentSchemas} from "../../../src/backends/cells/cellsComponentSchemas";
import {registerPixelsComponentSchemas} from "../../../src/backends/pixels/pixelsComponentSchemas";
import type {ProjectRenderBackend} from "../../../src/editor/project/projectEntry";
import {launchProject} from "../../../src/editor/project/projectLaunch";
import type {LaunchedProject} from "../../../src/editor/project/projectLaunch";
import type {SchemaRegistration} from "../../../src/editor/project/projectSchemas";
import {setupSwarm} from "../game";
import type {SwarmRenderControls} from "../game";
import * as generatedSchemas from "../schemas.generated";

export const SWARM_PROJECT_DIRECTORY = "demo/swarm";

const SWARM_BACKEND_SCHEMAS: readonly SchemaRegistration[] = [registerCellsComponentSchemas, registerPixelsComponentSchemas];

export interface SwarmLaunch {
    readonly renderBackend: ProjectRenderBackend;
    readonly directory?: string;
    readonly preload?: ScenePreload;
    readonly seed?: number;
    installRendering(world: World): SwarmRenderControls;
    quit(): void;
}

export function launchSwarm(world: World, launch: SwarmLaunch): Promise<LaunchedProject> {
    return launchProject(world, {
        directory: launch.directory ?? SWARM_PROJECT_DIRECTORY,
        entry: {
            registerProjectSchemas: generatedSchemas.registerGeneratedSchemas,
            setupProject: () => setupSwarm(world, {render: launch.installRendering(world), seed: launch.seed, quit: () => launch.quit()}),
        },
        schemas: {backendSchemas: SWARM_BACKEND_SCHEMAS, generated: generatedSchemas},
        renderBackend: launch.renderBackend,
        preload: launch.preload,
        quit: () => launch.quit(),
    });
}
