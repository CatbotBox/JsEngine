import type {World} from "../../../src/engine/core";
import type {ScenePreload} from "../../../src/engine/scene";
import {registerCellsComponentSchemas} from "../../../src/backends/cells/cellsComponentSchemas";
import {registerPixelsComponentSchemas} from "../../../src/backends/pixels/pixelsComponentSchemas";
import {launchProject} from "../../../src/engine/project/projectLaunch";
import type {LaunchedProject} from "../../../src/engine/project/projectLaunch";
import type {SchemaRegistration} from "../../../src/engine/project/projectSchemas";
import {setupSwarm} from "../game";
import * as generatedSchemas from "../schemas.generated";

export const SWARM_PROJECT_DIRECTORY = "demo/swarm";

const SWARM_BACKEND_SCHEMAS: readonly SchemaRegistration[] = [registerCellsComponentSchemas, registerPixelsComponentSchemas];

export interface SwarmLaunch {
    readonly directory?: string;
    readonly preload?: ScenePreload;
    readonly seed?: number;
    installRendering(world: World): void;
}

export function launchSwarm(world: World, launch: SwarmLaunch): Promise<LaunchedProject> {
    return launchProject(world, {
        directory: launch.directory ?? SWARM_PROJECT_DIRECTORY,
        entry: {
            registerProjectSchemas: generatedSchemas.registerGeneratedSchemas,
            setupProject: () => {
                launch.installRendering(world);
                setupSwarm(world, {seed: launch.seed});
            },
        },
        schemas: {backendSchemas: SWARM_BACKEND_SCHEMAS, generated: generatedSchemas},
        preload: launch.preload,
    });
}
