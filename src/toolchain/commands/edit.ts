import {isAbsolute, relative, resolve} from "path";
import {parseOptions} from "../cliArguments";
import {withProjectQuery} from "../projectSites";
import {EDITOR_PAGE} from "../build/webDistFiles";
import {launchWindow} from "../launch/windowLaunch";
import {hasProjectManifest, projectFolderOf} from "../project";
import {REPO_ROOT, slashed} from "../repoPaths";
import {serveSite} from "../serve/devServer";
import {BACKEND_OPTION, backendFor, HOST_TARGETS, PROJECT_OPTION, targetOf} from "../targets";
import {KEEP_RUNNING, requireScope} from "./command";
import type {CommandResult} from "./command";

const OPTIONS = {
    project: PROJECT_OPTION,
    target: {kind: "value", values: HOST_TARGETS},
    backend: BACKEND_OPTION,
    "no-build": {kind: "flag"},
    smoke: {kind: "flag"},
    screenshot: {kind: "value"},
    flows: {kind: "value"},
} as const;

const PARENT_SEGMENT = "..";

function editedProjectFolder(projectOption: string | undefined): string | undefined {
    if (projectOption !== undefined) return projectFolderOf(projectOption);
    const here = resolve(".");
    return hasProjectManifest(here) ? here : undefined;
}

function serverProjectPath(folder: string): string {
    const fromRepo = relative(REPO_ROOT, folder);
    const insideRepo = fromRepo.length > 0 && !isAbsolute(fromRepo) && !fromRepo.startsWith(PARENT_SEGMENT);
    return slashed(insideRepo ? fromRepo : folder);
}

export async function editCommand(args: readonly string[]): Promise<CommandResult> {
    const options = parseOptions("edit", args, OPTIONS);
    const target = targetOf(options.value("target"), HOST_TARGETS);
    const requestedBackend = options.value("backend");
    const backendOverride = requestedBackend === undefined ? "" : `?backend=${backendFor("editor", requestedBackend)}`;
    requireScope(options, ["smoke", "screenshot", "flows"], target === "window", "--target window");
    requireScope(options, ["flows"], options.flag("smoke"), "--smoke");
    const folder = editedProjectFolder(options.value("project"));
    const page = withProjectQuery(`${EDITOR_PAGE}${backendOverride}`, folder === undefined ? undefined : serverProjectPath(folder));
    const build = !options.flag("no-build");
    if (target === "window") return await launchWindow({page, build, smoke: options.flag("smoke"), screenshot: options.value("screenshot"), flows: options.value("flows")});
    serveSite({prod: false, build, isolated: true, open: page});
    return KEEP_RUNNING;
}
