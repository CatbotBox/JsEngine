import type {World} from "../../../src/engine/core";
import type {ScenePreload} from "../../../src/engine/scene";
import {registerCellsComponentSchemas} from "../../../src/backends/cells/cellsComponentSchemas";
import {registerPixelsComponentSchemas} from "../../../src/backends/pixels/pixelsComponentSchemas";
import {registerGpuComponentSchemas} from "../../../src/backends/gpu/gpuComponentSchemas";
import {launchProject} from "../../../src/engine/project/projectLaunch";
import type {LaunchedProject} from "../../../src/engine/project/projectLaunch";
import type {SchemaRegistration} from "../../../src/engine/project/projectSchemas";
import {setupDemo3d} from "../game";
import type {Demo3dModelFiles} from "../game";
import * as generatedSchemas from "../schemas.generated";

export const DEMO_3D_PROJECT_DIRECTORY = "demo/3d";

const DEMO_3D_BACKEND_SCHEMAS: readonly SchemaRegistration[] = [registerCellsComponentSchemas, registerPixelsComponentSchemas, registerGpuComponentSchemas];

export interface Demo3dLaunch {
    readonly directory?: string;
    readonly preload?: ScenePreload;
    readonly modelFiles?: Demo3dModelFiles;
    installRendering(world: World): void;
}

export function launchDemo3d(world: World, launch: Demo3dLaunch): Promise<LaunchedProject> {
    return launchProject(world, {
        directory: launch.directory ?? DEMO_3D_PROJECT_DIRECTORY,
        entry: {
            registerProjectSchemas: generatedSchemas.registerGeneratedSchemas,
            setupProject: () => {
                launch.installRendering(world);
                setupDemo3d(world, {modelFiles: launch.modelFiles});
            },
        },
        schemas: {backendSchemas: DEMO_3D_BACKEND_SCHEMAS, generated: generatedSchemas},
        preload: launch.preload,
    });
}
