/**
 * Opens a demo in a native window: builds web/ (scripts/buildWeb.ts), bundles the Electron main
 * process (window/main.ts) and starts Electron on the bundle.
 *
 * Run: bun scripts/window.ts [2d|3d] [--no-build] [--smoke [--screenshot=<file.png>]]
 *      2d by default; --no-build reuses web/dist; --smoke loads the page hidden, checks it and
 *      exits (see window/main.ts).
 */
import {join, resolve} from "path";

const ROOT = resolve(__dirname, "..");
const WEB_DIST = join(ROOT, "web", "dist");
const WINDOW_DIST = join(ROOT, "window", "dist");
const PAGES: Readonly<Record<string, string>> = {"2d": "index.html", "3d": "3d.html"};

function exitOnFailure(exitCode: number | null): void {
    if (exitCode !== 0) process.exit(exitCode ?? 1);
}

function buildWeb(): void {
    const result = Bun.spawnSync([process.execPath, join(ROOT, "scripts", "buildWeb.ts")], {
        stdio: ["inherit", "inherit", "inherit"],
    });
    exitOnFailure(result.exitCode);
}

async function bundleMainProcess(): Promise<string> {
    const result = await Bun.build({
        entrypoints: [join(ROOT, "window", "main.ts")],
        outdir: WINDOW_DIST,
        target: "node",
        format: "cjs",
        external: ["electron"],
    });
    if (!result.success) {
        for (const message of result.logs) console.error(message);
        process.exit(1);
    }
    return join(WINDOW_DIST, "main.js");
}

/**
 * The environment minus ELECTRON_RUN_AS_NODE: some editors' terminals set it, and then electron
 * runs as plain node, where `require("electron")` returns the npm stub's path instead of the API.
 */
function electronEnvironment(): Record<string, string | undefined> {
    const {ELECTRON_RUN_AS_NODE: _, ...environment} = process.env;
    return environment;
}

async function main(): Promise<void> {
    const pageName = process.argv.slice(2).find(arg => !arg.startsWith("--")) ?? "2d";
    const page = PAGES[pageName];
    if (page === undefined) {
        console.error(`unknown page "${pageName}", expected one of: ${Object.keys(PAGES).join(", ")}`);
        process.exit(1);
    }
    if (!process.argv.includes("--no-build")) buildWeb();
    const mainProcess = await bundleMainProcess();
    const electron = require("electron") as string;
    const forwardedFlags = process.argv.filter(arg => arg === "--smoke" || arg.startsWith("--screenshot="));
    const child = Bun.spawn([electron, mainProcess, WEB_DIST, page, ...forwardedFlags], {
        stdio: ["inherit", "inherit", "inherit"],
        env: electronEnvironment(),
    });
    exitOnFailure(await child.exited);
}

void main();
