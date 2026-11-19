import type {World} from "../core";
import {directoryFileSource} from "../platform/directoryFileSource";
import {joinPath} from "../platform/paths";
import type {FileSource} from "../platform/platform";
import type {ComponentSchemaRegistry} from "../scene/componentSchemaRegistry";
import {SceneManager} from "../scene/sceneManager";
import type {SceneHandle, ScenePreload} from "../scene/sceneManager";
import type {ProjectAssetFiles, ProjectEntryModule, ProjectHost} from "./projectEntry";
import {PROJECT_MANIFEST_FILE, validateProjectManifest} from "./projectManifest";
import type {ProjectManifest} from "./projectManifest";
import {createProjectSchemaRegistry} from "./projectSchemas";
import type {ProjectSchemaSources} from "./projectSchemas";
import {startProject} from "./projectStartup";

export interface ProjectLaunchOptions {
    readonly directory: string;
    readonly entry: ProjectEntryModule;
    readonly schemas?: ProjectSchemaSources;
    readonly assetFiles?: ProjectAssetFiles;
    readonly preload?: ScenePreload;
}

export interface LaunchedProject {
    readonly manifest: ProjectManifest;
    readonly registry: ComponentSchemaRegistry;
    readonly host: ProjectHost;
    readonly startScene: SceneHandle | undefined;
}

export const FILES_LOADED_UP_FRONT: ProjectAssetFiles = {
    list: () => [],
    ensureLoaded: () => Promise.resolve(),
    loadFetchingAsNeeded<T>(load: () => T): Promise<T> {
        return Promise.resolve(load());
    },
};

function noPreload(): Promise<void> {
    return Promise.resolve();
}

export function readProjectManifest(projectFiles: FileSource, directory: string): ProjectManifest {
    const label = joinPath(directory, PROJECT_MANIFEST_FILE);
    if (!projectFiles.exists(PROJECT_MANIFEST_FILE)) throw new Error(`${label} does not exist: launch the project from the folder that holds its manifest`);
    const validation = validateProjectManifest(projectFiles.readText(PROJECT_MANIFEST_FILE));
    if (!validation.ok) throw new Error(`${label}: ${validation.problems.join("; ")}`);
    return validation.manifest;
}

export async function launchProject(world: World, options: ProjectLaunchOptions): Promise<LaunchedProject> {
    const files = directoryFileSource(world.platform.files, options.directory);
    const preload = options.preload ?? noPreload;
    await preload([PROJECT_MANIFEST_FILE]);
    const manifest = readProjectManifest(files, options.directory);
    const registry = createProjectSchemaRegistry(options.entry, options.schemas);
    const scenes = new SceneManager(world, registry, {files, preload});
    const host: ProjectHost = {
        files: options.assetFiles ?? FILES_LOADED_UP_FRONT,
        scenes,
    };
    const startScene = await startProject(world, options.entry, host, manifest, registry);
    return {manifest, registry, host, startScene};
}
