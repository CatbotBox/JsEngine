import {join} from "path";
import {parseOptions, usageError} from "../cliArguments";
import {writeGeneratedFiles} from "../generate/generatedFiles";
import {reportGeneratedFiles} from "../generate/generatedFilesReport";
import {launchTerminal} from "../launch/terminalLaunch";
import {launchWindow} from "../launch/windowLaunch";
import {TERMINAL_MAIN_FILE} from "../projectLayout";
import {declaredTargetDefaults, projectFolderOf} from "../project";
import {projectPagePath} from "../projectSites";
import {serveSite} from "../serve/devServer";
import {BACKEND_OPTION, backendFor, PROJECT_OPTION, RUN_TARGETS, targetOf} from "../targets";
import {KEEP_RUNNING, requireScope} from "./command";
import type {CommandResult} from "./command";

const OPTIONS = {
    project: PROJECT_OPTION,
    target: {kind: "value", values: RUN_TARGETS},
    backend: BACKEND_OPTION,
    node: {kind: "flag"},
    watch: {kind: "flag"},
    "no-build": {kind: "flag"},
    smoke: {kind: "flag"},
    screenshot: {kind: "value"},
} as const;

export async function runCommand(args: readonly string[]): Promise<CommandResult> {
    const options = parseOptions("run", args, OPTIONS);
    const target = targetOf(options.value("target"), RUN_TARGETS);
    backendFor(target, options.value("backend"));
    requireScope(options, ["node", "watch"], target === "terminal", "--target terminal");
    requireScope(options, ["no-build"], target !== "terminal", "--target web or window");
    requireScope(options, ["smoke", "screenshot"], target === "window", "--target window");
    if (options.flag("node") && options.flag("watch")) throw usageError("--watch runs under bun only; drop --node or --watch");
    const folder = projectFolderOf(options.value("project"));
    const defaults = declaredTargetDefaults(folder, target);
    if (target === "terminal") {
        reportGeneratedFiles(writeGeneratedFiles(folder), "regenerate");
        return await launchTerminal(join(folder, TERMINAL_MAIN_FILE), {node: options.flag("node"), watch: options.flag("watch")});
    }
    const page = projectPagePath(folder, backendFor(target, options.value("backend"), defaults.backend), defaults.pixelScale);
    const build = !options.flag("no-build");
    if (target === "window") return await launchWindow({page, build, project: folder, smoke: options.flag("smoke"), screenshot: options.value("screenshot")});
    serveSite({prod: false, build, isolated: true, open: page, project: folder});
    return KEEP_RUNNING;
}
