import type {World} from "../core";
import type {ComponentSchemaRegistry} from "../scene/componentSchemaRegistry";
import type {SceneManager} from "../scene/sceneManager";

export interface ProjectAssetFile {
    readonly path: string;
    readonly size: number;
}

export interface ProjectLoadProgress {
    readonly loadedFiles: number;
    readonly totalFiles: number;
    readonly loadedBytes: number;
    readonly totalBytes: number;
}

export type ProjectLoadProgressListener = (progress: ProjectLoadProgress) => void;

export interface ProjectAssetFiles {
    list(): readonly ProjectAssetFile[];

    ensureLoaded(paths: readonly string[], onProgress?: ProjectLoadProgressListener): Promise<void>;

    loadFetchingAsNeeded<T>(load: () => T, onProgress?: ProjectLoadProgressListener): Promise<T>;
}

export interface ProjectHost {
    readonly files: ProjectAssetFiles;
    readonly scenes: SceneManager;
}

export interface ProjectEntryModule {
    registerProjectSchemas?(registry: ComponentSchemaRegistry): void;

    setupProject(world: World, host: ProjectHost): void | Promise<void>;
}

export const PROJECT_ENTRY_EXPORTS: readonly (keyof ProjectEntryModule)[] = ["setupProject"];
