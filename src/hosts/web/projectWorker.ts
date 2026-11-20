import type {System, SystemCtor, World} from "../../engine/core";
import {Input} from "../../engine/input";
import type {StartProject} from "../../engine/project/startGame";
import type {PreloadedFileSource} from "./preloadedFileSource";
import {projectFilePreload} from "./projectFilePreload";
import {WebProjectAssetFiles} from "./webProjectAssets";
import type {PageConnection} from "./worldWorkerPlatform";

export interface WorkerProject {
    readonly directory: string;
    readonly startProject: StartProject;
    readonly backendSystems: readonly SystemCtor<System>[];
}

export async function runProjectInWorker(world: World, page: PageConnection, files: PreloadedFileSource, project: WorkerProject): Promise<void> {
    page.connectInput(world.resources.getOrCreate(Input));
    const assets = await WebProjectAssetFiles.open(files, project.directory, text => page.showStatus(text));
    await project.startProject(world, {
        directory: project.directory,
        preload: projectFilePreload(files, project.directory),
        files: assets,
        backendSystems: project.backendSystems,
    });
    await assets.whenIdle();
    assets.stopReporting();
    world.startLoop();
}
