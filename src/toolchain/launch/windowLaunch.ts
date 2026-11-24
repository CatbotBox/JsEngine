import {buildWebSite} from "../build/webBuild";
import {bundleMainProcess, electronEnvironment} from "../build/windowBuild";
import {requireTargetFeatures} from "../build/featureDetection";
import type {TargetFeatureReport} from "../build/featureDetection";
import {builtProjectSite} from "../projectSites";
import {REPO_ROOT, WEB_DIST} from "../repoPaths";
import type {HostTarget} from "../targets";

export interface WindowLaunchOptions {
    readonly page: string;
    readonly build: boolean;
    readonly smoke: boolean;
    readonly screenshot?: string;
    readonly project?: string;
    readonly flows?: string;
}

export interface WindowSiteBuild {
    readonly mainProcess: string;
    readonly features: TargetFeatureReport;
}

const SMOKE_FLAG = "--smoke";
const WINDOW_TARGET: HostTarget = "window";

export async function buildWindowSite(project?: string): Promise<WindowSiteBuild> {
    const features = await buildWebSite({prod: false, withEditor: true, target: WINDOW_TARGET, project, regenerate: true});
    return {mainProcess: await bundleMainProcess(), features};
}

async function checkedWindowSite(project: string | undefined): Promise<string> {
    const built = await buildWindowSite(project);
    requireTargetFeatures(built.features);
    return built.mainProcess;
}

export async function launchWindow(options: WindowLaunchOptions): Promise<number> {
    const mainProcess = options.build ? await checkedWindowSite(options.project) : await bundleMainProcess();
    if (options.project !== undefined) builtProjectSite(WEB_DIST, options.project);
    const electron = require("electron") as string;
    const forwardedFlags = [
        ...(options.smoke ? [SMOKE_FLAG] : []),
        ...(options.screenshot === undefined ? [] : [`--screenshot=${options.screenshot}`]),
        ...(options.flows === undefined ? [] : [`--flows=${options.flows}`]),
    ];
    const child = Bun.spawn([electron, mainProcess, `--dist=${WEB_DIST}`, `--page=${options.page}`, `--repo=${REPO_ROOT}`, `--bun=${process.execPath}`, ...forwardedFlags], {
        stdio: ["inherit", "inherit", "inherit"],
        env: electronEnvironment(),
    });
    return await child.exited;
}
