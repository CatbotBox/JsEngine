import type {System, SystemCtor, World} from "../../src/engine/core";
import type {ProjectHost, StartedGame, StartProject} from "../../src/engine/project/startGame";
import type {RenderPassCtor} from "../../src/engine/rendering/renderPasses";
import type {SchemaEntry} from "../../src/engine/scene/schemaEntries";
import {installCellsBackend} from "../../src/backends/cells/cellsBackend";
import type {CellPresenter} from "../../src/backends/cells/cellPresenter";
import {installPixelsBackend} from "../../src/backends/pixels/pixelsBackend";
import type {PixelPresenter} from "../../src/backends/pixels/pixelPresenter";
import {startProject as startDemo2dProject} from "../../demo/2d/generated/game";
import {generatedCellsSchemas as demo2dCellsSchemas} from "../../demo/2d/generated/schemas.cells";
import {generatedPixelsSchemas as demo2dPixelsSchemas} from "../../demo/2d/generated/schemas.pixels";
import {generatedCellsPasses as demo2dCellsPasses, generatedCellsSystems as demo2dCellsSystems} from "../../demo/2d/generated/systems.cells";
import {generatedPixelsPasses as demo2dPixelsPasses, generatedPixelsSystems as demo2dPixelsSystems} from "../../demo/2d/generated/systems.pixels";
import {startProject as startDemo3dProject} from "../../demo/3d/generated/game";
import {generatedCellsSchemas as demo3dCellsSchemas} from "../../demo/3d/generated/schemas.cells";
import {generatedPixelsSchemas as demo3dPixelsSchemas} from "../../demo/3d/generated/schemas.pixels";
import {generatedCellsPasses as demo3dCellsPasses, generatedCellsSystems as demo3dCellsSystems} from "../../demo/3d/generated/systems.cells";
import {generatedPixelsPasses as demo3dPixelsPasses, generatedPixelsSystems as demo3dPixelsSystems} from "../../demo/3d/generated/systems.pixels";
import {startProject as startSwarmProject} from "../../demo/swarm/generated/game";
import {generatedCellsSchemas as swarmCellsSchemas} from "../../demo/swarm/generated/schemas.cells";
import {generatedPixelsSchemas as swarmPixelsSchemas} from "../../demo/swarm/generated/schemas.pixels";
import {generatedCellsPasses as swarmCellsPasses, generatedCellsSystems as swarmCellsSystems} from "../../demo/swarm/generated/systems.cells";
import {generatedPixelsPasses as swarmPixelsPasses, generatedPixelsSystems as swarmPixelsSystems} from "../../demo/swarm/generated/systems.pixels";

export interface DemoBackendHost {
    readonly passes: readonly RenderPassCtor[];
    readonly systems: readonly SystemCtor<System>[];
    readonly schemas: readonly SchemaEntry[];
}

export interface DemoProject {
    readonly directory: string;
    readonly startProject: StartProject;
    readonly cells: DemoBackendHost;
    readonly pixels: DemoBackendHost;
}

export type DemoHost = Omit<ProjectHost, "backendSystems" | "hostSchemas">;

export const DEMO_2D_PROJECT: DemoProject = {
    directory: "demo/2d",
    startProject: startDemo2dProject,
    cells: {passes: demo2dCellsPasses, systems: demo2dCellsSystems, schemas: demo2dCellsSchemas},
    pixels: {passes: demo2dPixelsPasses, systems: demo2dPixelsSystems, schemas: demo2dPixelsSchemas},
};

export const DEMO_3D_PROJECT: DemoProject = {
    directory: "demo/3d",
    startProject: startDemo3dProject,
    cells: {passes: demo3dCellsPasses, systems: demo3dCellsSystems, schemas: demo3dCellsSchemas},
    pixels: {passes: demo3dPixelsPasses, systems: demo3dPixelsSystems, schemas: demo3dPixelsSchemas},
};

export const SWARM_PROJECT: DemoProject = {
    directory: "demo/swarm",
    startProject: startSwarmProject,
    cells: {passes: swarmCellsPasses, systems: swarmCellsSystems, schemas: swarmCellsSchemas},
    pixels: {passes: swarmPixelsPasses, systems: swarmPixelsSystems, schemas: swarmPixelsSchemas},
};

function startDemo(world: World, project: DemoProject, backend: DemoBackendHost, host: DemoHost): Promise<StartedGame> {
    return project.startProject(world, {directory: project.directory, ...host, backendSystems: backend.systems, hostSchemas: backend.schemas});
}

export function startCellsDemo(world: World, presenter: CellPresenter, project: DemoProject, host: DemoHost = {}): Promise<StartedGame> {
    installCellsBackend(world, presenter, project.cells.passes);
    return startDemo(world, project, project.cells, host);
}

export function startPixelsDemo(world: World, presenter: PixelPresenter, project: DemoProject, host: DemoHost = {}): Promise<StartedGame> {
    installPixelsBackend(world, presenter, project.pixels.passes);
    return startDemo(world, project, project.pixels, host);
}
