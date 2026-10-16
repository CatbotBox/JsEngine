import {DebugWorld} from "../src/js_engine/core";
import type {PlatformOutput, PreloadedFileSource, PreloadProgress} from "../src/js_engine/platform";
import {setupDemo3d} from "../demo/3d/game";
import type {DemoModel, DemoModelFiles} from "../demo/3d/game";
import type {Demo3dManifest} from "../demo/3d/assets";
import {runWorldWorker} from "./worldWorker";

/** Written by scripts/buildWeb.ts beside this worker; asset paths in it are relative to it too. */
const MANIFEST_URL = "3d-manifest.json";

const MB = 1024 * 1024;

function progressLine(progress: PreloadProgress): string {
    const loaded = (progress.loadedBytes / MB).toFixed(1);
    const total = (progress.totalBytes / MB).toFixed(1);
    return `\r\x1b[2KLoading assets: ${progress.loadedFiles}/${progress.totalFiles} files, ${loaded}/${total} MB`;
}

/** Writes the progress line only when what it says changes: bytes arrive in many small chunks. */
function progressWriter(output: PlatformOutput): (progress: PreloadProgress) => void {
    let shown = "";
    return progress => {
        const line = progressLine(progress);
        if (line === shown) return;
        shown = line;
        output.write(line);
    };
}

async function fetchManifest(): Promise<Demo3dManifest> {
    const response = await fetch(MANIFEST_URL);
    if (!response.ok) throw new Error(`Could not fetch ${MANIFEST_URL}: HTTP ${response.status}`);
    return await response.json() as Demo3dManifest;
}

/** A model is ready once none of the files the manifest lists for it is a lazy entry still to fetch. */
function manifestModelFiles(manifest: Demo3dManifest, files: PreloadedFileSource): DemoModelFiles {
    const pathsByModel = new Map(manifest.models.map(model => [model.path, model.files]));
    const pathsOf = (model: DemoModel) => pathsByModel.get(model.path) ?? [];
    return {
        ready: model => !pathsOf(model).some(path => files.isPending(path)),
        fetch: (model, onProgress) => files.ensureLoaded(pathsOf(model), progress => onProgress(progress.loadedBytes, progress.totalBytes)),
    };
}

runWorldWorker(async (page, files) => {
    const output = page.platform.output;
    const manifest = await fetchManifest();
    await files.preload(manifest.files, progressWriter(output));
    output.write("\r\n");

    const world = new DebugWorld({platform: page.platform});
    setupDemo3d(world, {
        listModels: () => manifest.models,
        modelFiles: manifestModelFiles(manifest, files),
        quit: () => page.quit(),
    });
    world.startLoop();
});
