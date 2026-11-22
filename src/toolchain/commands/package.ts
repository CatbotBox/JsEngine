import {EXIT_SUCCESS, parseOptions, usageError} from "../cliArguments";
import {requireTargetFeatures} from "../build/featureDetection";
import {buildWebSite} from "../build/webBuild";
import {checkWindowPackageInputs, packageWindow} from "../package/windowPackage";
import {declaredTargetDefaults, projectFolderOf} from "../project";
import {projectPagePath} from "../projectSites";
import {BACKEND_OPTION, backendFor, BUILD_TARGETS, PROJECT_OPTION} from "../targets";
import type {HostTarget} from "../targets";
import type {CommandResult} from "./command";

const PACKAGED_TARGET: HostTarget = "window";

const OPTIONS = {
    project: PROJECT_OPTION,
    target: {kind: "value", values: BUILD_TARGETS},
    backend: BACKEND_OPTION,
    "no-build": {kind: "flag"},
    "no-zip": {kind: "flag"},
} as const;

export async function packageCommand(args: readonly string[]): Promise<CommandResult> {
    const options = parseOptions("package", args, OPTIONS);
    if (options.value("target") !== PACKAGED_TARGET) throw usageError(`jsengine package makes desktop apps only; pass --target ${PACKAGED_TARGET}`);
    backendFor(PACKAGED_TARGET, options.value("backend"));
    const folder = projectFolderOf(options.value("project"));
    const defaults = declaredTargetDefaults(folder, PACKAGED_TARGET);
    const page = projectPagePath(folder, backendFor(PACKAGED_TARGET, options.value("backend"), defaults.backend), defaults.pixelScale);
    checkWindowPackageInputs();
    if (!options.flag("no-build")) requireTargetFeatures(await buildWebSite({prod: false, withEditor: true, target: PACKAGED_TARGET, project: folder}));
    await packageWindow({project: folder, page, zip: !options.flag("no-zip")});
    return EXIT_SUCCESS;
}
