import {DebugWorld} from "../src/js_engine/core";
import type {PlatformOutput, PreloadProgress} from "../src/js_engine/platform";
import {setupDemo3d} from "../demo/3d/game";
import type {Demo3dManifest} from "../demo/3d/assets";
import {runWorldWorker} from "./worldWorker";

/** Written by scripts/buildWeb.ts beside this worker; asset paths in it are relative to it too. */
const MANIFEST_URL = "3d-manifest.json";

const MB = 1024 * 1024;

function showProgress(output: PlatformOutput, progress: PreloadProgress): void {
    const loaded = (progress.loadedBytes / MB).toFixed(1);
    const total = (progress.totalBytes / MB).toFixed(1);
    output.write(`\r\x1b[2KLoading assets: ${progress.loadedFiles}/${progress.totalFiles} files, ${loaded}/${total} MB`);
}

async function fetchManifest(): Promise<Demo3dManifest> {
    const response = await fetch(MANIFEST_URL);
    if (!response.ok) throw new Error(`Could not fetch ${MANIFEST_URL}: HTTP ${response.status}`);
    return await response.json() as Demo3dManifest;
}

runWorldWorker(async (page, files) => {
    const output = page.platform.output;
    const manifest = await fetchManifest();
    showProgress(output, {loadedFiles: 0, totalFiles: manifest.files.length, loadedBytes: 0, totalBytes: 0});
    await files.preload(manifest.files, progress => showProgress(output, progress));
    output.write("\r\n");

    const world = new DebugWorld({platform: page.platform});
    setupDemo3d(world, {
        listModels: () => manifest.models,
        quit: () => page.quit(),
    });
    world.startLoop();
});
