import type {World} from "../../../src/engine/core";
import type {ScenePreload} from "../../../src/engine/scene";
import {registerCellsComponentSchemas} from "../../../src/backends/cells/cellsComponentSchemas";
import {registerPixelsComponentSchemas} from "../../../src/backends/pixels/pixelsComponentSchemas";
import {registerGpuComponentSchemas} from "../../../src/backends/gpu/gpuComponentSchemas";
import type {ProjectRenderBackend} from "../../../src/engine/project/projectEntry";
import {launchProject} from "../../../src/engine/project/projectLaunch";
import type {LaunchedProject} from "../../../src/engine/project/projectLaunch";
import type {SchemaRegistration} from "../../../src/engine/project/projectSchemas";
import {setupDemo3d} from "../game";
import type {Demo3dModelFiles, Demo3dRenderControls} from "../game";
import * as generatedSchemas from "../schemas.generated";

export const DEMO_3D_PROJECT_DIRECTORY = "demo/3d";

const DEMO_3D_BACKEND_SCHEMAS: readonly SchemaRegistration[] = [registerCellsComponentSchemas, registerPixelsComponentSchemas, registerGpuComponentSchemas];

export interface Demo3dLaunch {
    readonly renderBackend: ProjectRenderBackend;
    readonly directory?: string;
    readonly preload?: ScenePreload;
    readonly modelFiles?: Demo3dModelFiles;
    installRendering(world: World): Demo3dRenderControls;
    quit(): void;
}

export function launchDemo3d(world: World, launch: Demo3dLaunch): Promise<LaunchedProject> {
    return launchProject(world, {
        directory: launch.directory ?? DEMO_3D_PROJECT_DIRECTORY,
        entry: {
            registerProjectSchemas: generatedSchemas.registerGeneratedSchemas,
            setupProject: () => setupDemo3d(world, {
                render: launch.installRendering(world),
                modelFiles: launch.modelFiles,
                quit: () => launch.quit(),
            }),
        },
        schemas: {backendSchemas: DEMO_3D_BACKEND_SCHEMAS, generated: generatedSchemas},
        renderBackend: launch.renderBackend,
        preload: launch.preload,
        quit: () => launch.quit(),
    });
}
