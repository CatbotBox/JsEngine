import type {Terminal} from "@xterm/xterm";
import {DebugWorld} from "../src/js_engine/core";
import {browserPlatform, PreloadedFileSource} from "../src/js_engine/platform";
import type {PreloadProgress} from "../src/js_engine/platform";
import {setupDemo3d} from "../demo/3d/game";
import type {Demo3dManifest} from "../demo/3d/assets";
import {createTerminal, keepDevtoolsConsole} from "./terminal";

/** Written by scripts/buildWeb.ts beside this page; asset paths in it are relative to the page too. */
const MANIFEST_URL = "3d-manifest.json";

const MB = 1024 * 1024;

function showProgress(terminal: Terminal, progress: PreloadProgress): void {
    const loaded = (progress.loadedBytes / MB).toFixed(1);
    const total = (progress.totalBytes / MB).toFixed(1);
    terminal.write(`\r\x1b[2KLoading assets: ${progress.loadedFiles}/${progress.totalFiles} files, ${loaded}/${total} MB`);
}

async function fetchManifest(): Promise<Demo3dManifest> {
    const response = await fetch(MANIFEST_URL);
    if (!response.ok) throw new Error(`Could not fetch ${MANIFEST_URL}: HTTP ${response.status}`);
    return await response.json() as Demo3dManifest;
}

async function main(terminal: Terminal): Promise<void> {
    const manifest = await fetchManifest();
    const files = new PreloadedFileSource();
    showProgress(terminal, {loadedFiles: 0, totalFiles: manifest.files.length, loadedBytes: 0, totalBytes: 0});
    await files.preload(manifest.files, progress => showProgress(terminal, progress));
    terminal.write("\r\n");

    const world = new DebugWorld({platform: browserPlatform(terminal, files)});
    setupDemo3d(world, {
        listModels: () => manifest.models,
        quit: () => terminal.write("\x1b[0m\r\nStopped. Reload the page to restart.\r\n"),
    });
    world.startLoop();
}

keepDevtoolsConsole();
const terminal = createTerminal(document.getElementById("terminal")!);
main(terminal).catch(error => {
    console.error(error);
    terminal.write(`\x1b[0m\r\n\x1b[31mCould not start the 3D demo: ${error instanceof Error ? error.message : String(error)}\x1b[0m\r\n`);
});
