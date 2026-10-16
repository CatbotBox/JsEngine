/**
 * Opens a demo in a native window: builds web/ (scripts/buildWeb.ts), bundles the Electron main
 * process (window/main.ts) and starts Electron on the bundle.
 *
 * Run: bun scripts/window.ts [2d|3d] [--no-build] [--smoke [--screenshot=<file.png>]]
 *      2d by default; --no-build reuses web/dist; --smoke loads the page hidden, checks it and
 *      exits (see window/main.ts).
 */
import {buildWeb, bundleMainProcess, electronEnvironment, exitOnFailure, pageFromArguments, WEB_DIST} from "./windowBuild";

async function main(): Promise<void> {
    const page = pageFromArguments("2d");
    if (!process.argv.includes("--no-build")) buildWeb();
    const mainProcess = await bundleMainProcess();
    const electron = require("electron") as string;
    const forwardedFlags = process.argv.filter(arg => arg === "--smoke" || arg.startsWith("--screenshot="));
    const child = Bun.spawn([electron, mainProcess, `--dist=${WEB_DIST}`, `--page=${page}`, ...forwardedFlags], {
        stdio: ["inherit", "inherit", "inherit"],
        env: electronEnvironment(),
    });
    exitOnFailure(await child.exited);
}

void main();
