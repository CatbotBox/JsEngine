import type {System, SystemCtor, World} from "../../src/engine/core";
import type {ProjectHost, StartedGame, StartProject} from "../../src/engine/project/startGame";
import {installCellsBackend} from "../../src/backends/cells/cellsBackend";
import type {CellPresenter} from "../../src/backends/cells/cellPresenter";
import {CELLS_STANDARD_PASSES} from "../../src/backends/cells/cellsStandardPasses";
import {installPixelsBackend} from "../../src/backends/pixels/pixelsBackend";
import type {PixelPresenter} from "../../src/backends/pixels/pixelPresenter";
import {PIXELS_STANDARD_PASSES} from "../../src/backends/pixels/pixelsStandardPasses";
import {startProject as startDemo2dProject} from "../../demo/2d/generated/game";
import {generatedCellsSystems as demo2dCellsSystems} from "../../demo/2d/generated/systems.cells";
import {generatedPixelsSystems as demo2dPixelsSystems} from "../../demo/2d/generated/systems.pixels";
import {startProject as startDemo3dProject} from "../../demo/3d/generated/game";
import {generatedCellsSystems as demo3dCellsSystems} from "../../demo/3d/generated/systems.cells";
import {generatedPixelsSystems as demo3dPixelsSystems} from "../../demo/3d/generated/systems.pixels";
import {startProject as startSwarmProject} from "../../demo/swarm/generated/game";
import {generatedCellsSystems as swarmCellsSystems} from "../../demo/swarm/generated/systems.cells";
import {generatedPixelsSystems as swarmPixelsSystems} from "../../demo/swarm/generated/systems.pixels";

type SystemList = readonly SystemCtor<System>[];

export interface DemoProject {
    readonly directory: string;
    readonly startProject: StartProject;
    readonly cellsSystems: SystemList;
    readonly pixelsSystems: SystemList;
}

export type DemoHost = Omit<ProjectHost, "backendSystems">;

export const DEMO_2D_PROJECT: DemoProject = {directory: "demo/2d", startProject: startDemo2dProject, cellsSystems: demo2dCellsSystems, pixelsSystems: demo2dPixelsSystems};
export const DEMO_3D_PROJECT: DemoProject = {directory: "demo/3d", startProject: startDemo3dProject, cellsSystems: demo3dCellsSystems, pixelsSystems: demo3dPixelsSystems};
export const SWARM_PROJECT: DemoProject = {directory: "demo/swarm", startProject: startSwarmProject, cellsSystems: swarmCellsSystems, pixelsSystems: swarmPixelsSystems};

export function startCellsDemo(world: World, presenter: CellPresenter, project: DemoProject, host: DemoHost = {}): Promise<StartedGame> {
    installCellsBackend(world, presenter, CELLS_STANDARD_PASSES);
    return project.startProject(world, {directory: project.directory, ...host, backendSystems: project.cellsSystems});
}

export function startPixelsDemo(world: World, presenter: PixelPresenter, project: DemoProject, host: DemoHost = {}): Promise<StartedGame> {
    installPixelsBackend(world, presenter, PIXELS_STANDARD_PASSES);
    return project.startProject(world, {directory: project.directory, ...host, backendSystems: project.pixelsSystems});
}
