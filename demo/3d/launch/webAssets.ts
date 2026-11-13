import type {PreloadedFileSource, PreloadProgress} from "../../../src/hosts/web/preloadedFileSource";
import type {PageConnection} from "../../../src/hosts/web/worldWorkerPlatform";
import type {DemoModel, DemoModelFiles} from "../game";
import type {Demo3dManifest} from "../assets";
import {normalizePath} from "../../../src/engine/platform";

const MANIFEST_URL = "3d-manifest.json";

const MB = 1024 * 1024;

function progressLine(progress: PreloadProgress): string {
    const loaded = (progress.loadedBytes / MB).toFixed(1);
    const total = (progress.totalBytes / MB).toFixed(1);
    return `Loading assets: ${progress.loadedFiles}/${progress.totalFiles} files, ${loaded}/${total} MB`;
}

function progressStatus(page: PageConnection): (progress: PreloadProgress) => void {
    let shown = "";
    return progress => {
        const line = progressLine(progress);
        if (line === shown) return;
        shown = line;
        page.showStatus(line);
    };
}

async function fetchManifest(): Promise<Demo3dManifest> {
    const response = await fetch(MANIFEST_URL);
    if (!response.ok) throw new Error(`Could not fetch ${MANIFEST_URL}: HTTP ${response.status}`);
    return await response.json() as Demo3dManifest;
}

export async function preloadDemo3dAssets(page: PageConnection, files: PreloadedFileSource): Promise<Demo3dManifest> {
    const manifest = await fetchManifest();
    await files.preload(manifest.files, progressStatus(page));
    return manifest;
}

export function manifestModelFiles(manifest: Demo3dManifest, files: PreloadedFileSource): DemoModelFiles {
    const pathsByModel = new Map(manifest.models.map(model => [model.path, model.files]));
    const pathsOf = (model: DemoModel) => pathsByModel.get(model.path) ?? [];
    return {
        ready: model => !pathsOf(model).some(path => files.isPending(path)),
        fetch: (model, onProgress) => files.ensureLoaded(pathsOf(model), progress => onProgress(progress.loadedBytes, progress.totalBytes)),
    };
}

export function manifestFilesForAssets(manifest: Demo3dManifest, paths: readonly string[]): string[] {
    const filesByModel = new Map(manifest.models.map(model => [normalizePath(model.path), model.files]));
    return paths.flatMap(path => filesByModel.get(normalizePath(path)) ?? [path]);
}
