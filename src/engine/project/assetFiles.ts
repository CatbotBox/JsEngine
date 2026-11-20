import {Resource} from "../core";

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

export class AssetFiles extends Resource {
    public constructor(public readonly files: ProjectAssetFiles) {
        super();
    }
}
