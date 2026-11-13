import {join, resolve} from "path";

export const ROOT = resolve(__dirname, "..");
export const WEB_DIST = join(ROOT, "dist", "web");
export const WINDOW_DIST = join(ROOT, "dist", "desktop");
export const APP_ICON_DIRECTORY = join(ROOT, "assets", "icon");
export const APP_ICON_ICO_FILE = "icon.ico";
export const APP_ICON_ICNS_FILE = "icon.icns";
export const APP_ICON_PNG_FILE = "icon.png";

export function exitOnFailure(exitCode: number | null): void {
    if (exitCode !== 0) process.exit(exitCode ?? 1);
}

export function buildWeb(): void {
    const result = Bun.spawnSync([process.execPath, join(ROOT, "scripts", "buildWeb.ts")], {
        stdio: ["inherit", "inherit", "inherit"],
    });
    exitOnFailure(result.exitCode);
}

export async function bundleMainProcess(outdir = WINDOW_DIST): Promise<string> {
    const result = await Bun.build({
        entrypoints: [join(ROOT, "src", "hosts", "desktop", "main.ts")],
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

export function electronEnvironment(): Record<string, string | undefined> {
    const {ELECTRON_RUN_AS_NODE: _, ...environment} = process.env;
    return environment;
}
