import {EXIT_SUCCESS, parseOptions, usageError} from "../cliArguments";
import {requireTargetFeatures} from "../build/featureDetection";
import {buildWebSite} from "../build/webBuild";
import {demoSiteOf, demoSitePath} from "../demoSites";
import {checkWindowPackageInputs, packageWindow} from "../package/windowPackage";
import {projectFolderOf} from "../project";
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
    const backend = backendFor(PACKAGED_TARGET, options.value("backend"));
    const site = demoSiteOf(projectFolderOf(options.value("project")));
    const page = demoSitePath(site, backend);
    checkWindowPackageInputs();
    if (!options.flag("no-build")) requireTargetFeatures(await buildWebSite({prod: false, withEditor: true, target: PACKAGED_TARGET}));
    await packageWindow({site, page, zip: !options.flag("no-zip")});
    return EXIT_SUCCESS;
}
