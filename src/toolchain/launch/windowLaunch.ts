import {buildWebSite} from "../build/webBuild";
import {bundleMainProcess, electronEnvironment} from "../build/windowBuild";
import {REPO_ROOT, WEB_DIST} from "../repoPaths";

export interface WindowLaunchOptions {
    readonly page: string;
    readonly build: boolean;
    readonly smoke: boolean;
    readonly screenshot?: string;
}

const SMOKE_FLAG = "--smoke";

export async function buildWindowSite(): Promise<string> {
    await buildWebSite({prod: false, withEditor: true});
    return await bundleMainProcess();
}

export async function launchWindow(options: WindowLaunchOptions): Promise<number> {
    const mainProcess = options.build ? await buildWindowSite() : await bundleMainProcess();
    const electron = require("electron") as string;
    const forwardedFlags = [...(options.smoke ? [SMOKE_FLAG] : []), ...(options.screenshot === undefined ? [] : [`--screenshot=${options.screenshot}`])];
    const child = Bun.spawn([electron, mainProcess, `--dist=${WEB_DIST}`, `--page=${options.page}`, `--repo=${REPO_ROOT}`, `--bun=${process.execPath}`, ...forwardedFlags], {
        stdio: ["inherit", "inherit", "inherit"],
        env: electronEnvironment(),
    });
    return await child.exited;
}
