import {join} from "path";
import {CliError} from "../cliArguments";
import {REPO_ROOT, SOURCE_ROOT, WINDOW_DIST} from "../repoPaths";

export const APP_ICON_DIRECTORY = join(REPO_ROOT, "assets", "icon");
export const APP_ICON_ICO_FILE = "icon.ico";
export const APP_ICON_ICNS_FILE = "icon.icns";
export const APP_ICON_PNG_FILE = "icon.png";

const MAIN_PROCESS_ENTRY = join(SOURCE_ROOT, "hosts", "desktop", "main.ts");
const MAIN_PROCESS_BUNDLE = "main.js";

export async function bundleMainProcess(outdir = WINDOW_DIST): Promise<string> {
    const result = await Bun.build({
        entrypoints: [MAIN_PROCESS_ENTRY],
        outdir,
        target: "node",
        format: "cjs",
        external: ["electron"],
    });
    if (!result.success) throw new CliError("bundling the Electron main process failed:", result.logs.map(String));
    return join(outdir, MAIN_PROCESS_BUNDLE);
}

export function electronEnvironment(): Record<string, string | undefined> {
    const {ELECTRON_RUN_AS_NODE: _, ...environment} = process.env;
    return environment;
}
