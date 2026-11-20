import {joinPath, normalizePath} from "../../engine/platform/paths";
import type {ProjectAssetFile, ProjectAssetFiles, ProjectLoadProgress, ProjectLoadProgressListener} from "../../engine/project/assetFiles";
import type {PreloadEntry, PreloadedFileSource} from "./preloadedFileSource";

export const PROJECT_ASSET_MANIFEST_FILE = "jsengine.assets.json";

export interface AssetManifestFile extends PreloadEntry {
    readonly size: number;
    readonly mtimeMs: number;
}

export interface AssetManifestPrefab {
    readonly name: string;
    readonly path: string;
    readonly meshes: readonly string[];
    readonly files: readonly string[];
}

export interface ProjectAssetManifest {
    readonly prefabs: readonly AssetManifestPrefab[];
    readonly files: readonly AssetManifestFile[];
}

export type AssetStatusListener = (text: string) => void;

interface CallProgress {
    loadedFiles: number;
    totalFiles: number;
    loadedBytes: number;
    totalBytes: number;
}

const MB = 1024 * 1024;
const MB_DECIMALS = 1;
const PATH_SEPARATOR = "/";
const NO_FILES = 0;

export function assetStatusLine(progress: ProjectLoadProgress): string {
    const loaded = (progress.loadedBytes / MB).toFixed(MB_DECIMALS);
    const total = (progress.totalBytes / MB).toFixed(MB_DECIMALS);
    return `Loading assets: ${progress.loadedFiles}/${progress.totalFiles} files, ${loaded}/${total} MB`;
}

export function projectAssetManifestPath(directory: string): string {
    return joinPath(directory, PROJECT_ASSET_MANIFEST_FILE);
}

export async function fetchProjectAssetManifest(files: PreloadedFileSource, directory: string): Promise<ProjectAssetManifest> {
    const path = projectAssetManifestPath(directory);
    await files.preload([path]);
    if (!files.exists(path)) throw new Error(`${path} was not found: build the site with jsengine build --target web, which lists the project's asset files there`);
    return JSON.parse(files.readText(path)) as ProjectAssetManifest;
}

export class WebProjectAssetFiles implements ProjectAssetFiles {
    private readonly listed: readonly ProjectAssetFile[];
    private readonly running = new Set<Promise<unknown>>();
    private readonly calls: CallProgress[] = [];
    private shown = "";

    private constructor(private readonly files: PreloadedFileSource, private readonly directory: string, manifest: ProjectAssetManifest, private reportStatus: AssetStatusListener | undefined) {
        const prefix = normalizePath(directory) + PATH_SEPARATOR;
        this.listed = manifest.files
            .filter(file => file.statOnly !== true)
            .map(file => ({path: file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path, size: file.size}));
    }

    public static async open(files: PreloadedFileSource, directory: string, reportStatus?: AssetStatusListener): Promise<WebProjectAssetFiles> {
        const manifest = await fetchProjectAssetManifest(files, directory);
        const assets = new WebProjectAssetFiles(files, directory, manifest, reportStatus);
        await assets.track(report => files.preload(manifest.files, report));
        return assets;
    }

    public list(): readonly ProjectAssetFile[] {
        return this.listed;
    }

    public ensureLoaded(paths: readonly string[], onProgress?: ProjectLoadProgressListener): Promise<void> {
        return this.track(report => this.files.ensureLoaded(paths.map(path => joinPath(this.directory, path)), report), onProgress);
    }

    public loadFetchingAsNeeded<T>(load: () => T, onProgress?: ProjectLoadProgressListener): Promise<T> {
        return this.track(report => this.files.loadFetchingAsNeeded(load, report), onProgress);
    }

    public async whenIdle(): Promise<void> {
        while (this.running.size > 0) await Promise.allSettled([...this.running]);
    }

    public stopReporting(): void {
        this.reportStatus = undefined;
    }

    private track<T>(run: (report: ProjectLoadProgressListener) => Promise<T>, onProgress?: ProjectLoadProgressListener): Promise<T> {
        const call: CallProgress = {loadedFiles: 0, totalFiles: 0, loadedBytes: 0, totalBytes: 0};
        this.calls.push(call);
        const promise = run(progress => {
            Object.assign(call, progress);
            onProgress?.(progress);
            this.showStatus();
        });
        const settle = () => {
            this.running.delete(promise);
        };
        this.running.add(promise);
        promise.then(settle, settle);
        return promise;
    }

    private showStatus(): void {
        if (this.reportStatus === undefined) return;
        const total: CallProgress = {loadedFiles: 0, totalFiles: 0, loadedBytes: 0, totalBytes: 0};
        for (const call of this.calls) {
            total.loadedFiles += call.loadedFiles;
            total.totalFiles += call.totalFiles;
            total.loadedBytes += call.loadedBytes;
            total.totalBytes += call.totalBytes;
        }
        const line = assetStatusLine(total);
        if (total.totalFiles === NO_FILES || line === this.shown) return;
        this.shown = line;
        this.reportStatus(line);
    }
}
