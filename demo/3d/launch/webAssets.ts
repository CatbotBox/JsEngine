import type {PreloadedFileSource, PreloadProgress} from "../../../src/hosts/web/preloadedFileSource";
import type {PageConnection} from "../../../src/hosts/web/worldWorkerPlatform";
import type {PrefabAsset} from "../../../src/engine/scene";
import type {Demo3dModelFiles} from "../game";
import type {Demo3dManifest} from "../assets";

const MANIFEST_URL = "3d-manifest.json";

const MB = 1024 * 1024;
const NO_FILES: readonly string[] = [];

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

export function manifestModelFiles(manifest: Demo3dManifest, files: PreloadedFileSource): Demo3dModelFiles {
    const pathsByPrefab = new Map(manifest.models.map(model => [model.path, model.files]));
    const pathsOf = (prefab: PrefabAsset) => pathsByPrefab.get(prefab.sourcePath) ?? NO_FILES;
    return {
        ready: prefab => !pathsOf(prefab).some(path => files.isPending(path)),
        fetch: (prefab, onProgress) => files.ensureLoaded(pathsOf(prefab), progress => onProgress(progress.loadedBytes, progress.totalBytes)),
    };
}
