import type {System, SystemCtor, World} from "../../engine/core";
import {Input} from "../../engine/input";
import {joinPath} from "../../engine/platform/paths";
import type {StartProject} from "../../engine/project/startGame";
import {DataAssets} from "../../engine/scene/dataAssets";
import type {SchemaEntry} from "../../engine/scene/schemaEntries";
import type {PreloadedFileSource} from "./preloadedFileSource";
import {projectFilePreload} from "./projectFilePreload";
import {WebProjectAssetFiles} from "./webProjectAssets";
import type {PageConnection} from "./worldWorkerPlatform";

export interface WorkerProject {
    readonly directory: string;
    readonly startProject: StartProject;
    readonly backendSystems: readonly SystemCtor<System>[];
    readonly hostSchemas: readonly SchemaEntry[];
}

export type RefetchableFiles = Pick<PreloadedFileSource, "exists" | "refetch">;

export interface DataAssetReloadLog {
    info(text: string): void;
    error(text: string): void;
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function reloadProjectDataAssets(world: World, files: RefetchableFiles, directory: string, paths: readonly string[], log: DataAssetReloadLog = console): Promise<void> {
    const fetchedPaths = paths.map(path => joinPath(directory, path)).filter(path => files.exists(path));
    try {
        await files.refetch(fetchedPaths);
    } catch (error) {
        log.error(`Could not refetch the data assets ${paths.join(", ")}; the game keeps their previous values: ${errorText(error)}`);
        return;
    }
    const dataAssets = world.resources.tryGet(DataAssets);
    if (dataAssets === undefined) return;
    for (const path of paths) {
        if (!dataAssets.isLoaded(path)) continue;
        try {
            dataAssets.reload(path);
            log.info(`Reloaded the data asset ${path}`);
        } catch (error) {
            log.error(`Could not reload the data asset ${path}; the game keeps its previous values: ${errorText(error)}`);
        }
    }
}

async function startProjectInWorker(world: World, page: PageConnection, files: PreloadedFileSource, project: WorkerProject): Promise<void> {
    const assets = await WebProjectAssetFiles.open(files, project.directory, text => page.showStatus(text));
    await project.startProject(world, {
        directory: project.directory,
        preload: projectFilePreload(files, project.directory),
        files: assets,
        backendSystems: project.backendSystems,
        hostSchemas: project.hostSchemas,
    });
    await assets.whenIdle();
    assets.stopReporting();
}

function ignore(): void {
}

export async function runProjectInWorker(world: World, page: PageConnection, files: PreloadedFileSource, project: WorkerProject): Promise<void> {
    page.connectInput(world.resources.getOrCreate(Input));
    const startup = startProjectInWorker(world, page, files, project);
    page.onReloadDataAssets(paths => void startup.then(() => reloadProjectDataAssets(world, files, project.directory, paths), ignore));
    await startup;
    world.startLoop();
}
