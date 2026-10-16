/**
 * Packages a demo as a standalone desktop app for this machine's platform with @electron/packager:
 * builds web/, stages main.js + launch.json + the bundle (without source maps) in
 * window/dist/app, and writes `release/<name>-<platform>-<arch>/`, whose executable needs no
 * arguments. The app is an asar archive; window/main.ts reads it through Electron's fs. The
 * executable's fuses are flipped so it cannot be run as plain node (ELECTRON_RUN_AS_NODE, which
 * some editors' terminals set, would otherwise turn it into a node REPL) or given node options,
 * and loads only the asar.
 *
 * Run: bun scripts/packageWindow.ts [2d|3d] [--no-build]   (3d by default)
 * Check the result headless with: <executable> --smoke
 */
import {FuseV1Options, FuseVersion, flipFuses} from "@electron/fuses";
import {packager} from "@electron/packager";
import {cpSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "fs";
import {join} from "path";
import type {PackagedLaunch} from "../window/main";
import {buildWeb, bundleMainProcess, pageFromArguments, ROOT, WEB_DIST, WINDOW_DIST} from "./windowBuild";

const APP_NAME = "JsEngine";
const STAGING = join(WINDOW_DIST, "app");
const RELEASE = join(ROOT, "release");

async function hardenExecutable(packagedDirectory: string): Promise<void> {
    const executable = process.platform === "win32" ? `${APP_NAME}.exe` : APP_NAME;
    await flipFuses(join(packagedDirectory, executable), {
        version: FuseVersion.V1,
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: false,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
    });
}

function versionOf(packageJsonPath: string): string {
    return (JSON.parse(readFileSync(packageJsonPath, "utf8")) as {version: string}).version;
}

async function stageApp(page: string): Promise<void> {
    rmSync(STAGING, {recursive: true, force: true});
    mkdirSync(STAGING, {recursive: true});
    await bundleMainProcess(STAGING);
    const launch: PackagedLaunch = {page};
    writeFileSync(join(STAGING, "launch.json"), JSON.stringify(launch));
    writeFileSync(join(STAGING, "package.json"), JSON.stringify({
        name: APP_NAME.toLowerCase(),
        productName: APP_NAME,
        version: versionOf(join(ROOT, "package.json")),
        main: "main.js",
    }, null, 2));
    cpSync(WEB_DIST, join(STAGING, "web"), {recursive: true, filter: source => !source.endsWith(".map")});
}

async function main(): Promise<void> {
    const page = pageFromArguments("3d");
    if (!process.argv.includes("--no-build")) buildWeb();
    await stageApp(page);
    const [output] = await packager({
        dir: STAGING,
        out: RELEASE,
        name: APP_NAME,
        executableName: APP_NAME,
        electronVersion: versionOf(join(ROOT, "node_modules", "electron", "package.json")),
        asar: true,
        prune: false,
        overwrite: true,
        quiet: true,
    });
    await hardenExecutable(output);
    console.log(`packaged ${page} into ${output.slice(ROOT.length + 1).replace(/\\/g, "/")}`);
}

void main();
