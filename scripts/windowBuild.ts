/** The build steps scripts/window.ts and scripts/packageWindow.ts share. */
import {join, resolve} from "path";

export const ROOT = resolve(__dirname, "..");
export const WEB_DIST = join(ROOT, "web", "dist");
export const WINDOW_DIST = join(ROOT, "window", "dist");
const PAGES: Readonly<Record<string, string>> = {"2d": "2d.html", "3d": "3d.html"};

export function exitOnFailure(exitCode: number | null): void {
    if (exitCode !== 0) process.exit(exitCode ?? 1);
}

/** The first non-flag argument (`2d` or `3d`, `fallback` if absent) as the page file it names. */
export function pageFromArguments(fallback: string): string {
    const pageName = process.argv.slice(2).find(arg => !arg.startsWith("--")) ?? fallback;
    const page = PAGES[pageName];
    if (page === undefined) {
        console.error(`unknown page "${pageName}", expected one of: ${Object.keys(PAGES).join(", ")}`);
        process.exit(1);
    }
    return page;
}

export function buildWeb(): void {
    const result = Bun.spawnSync([process.execPath, join(ROOT, "scripts", "buildWeb.ts")], {
        stdio: ["inherit", "inherit", "inherit"],
    });
    exitOnFailure(result.exitCode);
}

/** Bundles window/main.ts into `outdir` and returns the bundle's path. */
export async function bundleMainProcess(outdir = WINDOW_DIST): Promise<string> {
    const result = await Bun.build({
        entrypoints: [join(ROOT, "window", "main.ts")],
        outdir,
        target: "node",
        format: "cjs",
        external: ["electron"],
    });
    if (!result.success) {
        for (const message of result.logs) console.error(message);
        process.exit(1);
    }
    return join(outdir, "main.js");
}

/**
 * The environment minus ELECTRON_RUN_AS_NODE: some editors' terminals set it, and then electron
 * runs as plain node, where `require("electron")` returns the npm stub's path instead of the API.
 */
export function electronEnvironment(): Record<string, string | undefined> {
    const {ELECTRON_RUN_AS_NODE: _, ...environment} = process.env;
    return environment;
}
