import {CliError, EXIT_FAILURE, EXIT_SUCCESS, parseOptions, usageError} from "../cliArguments";
import {buildEditorWorker} from "../build/editorBuild";
import {buildWebSite} from "../build/webBuild";
import {DEMO_SITES} from "../demoSites";
import {buildWindowSite} from "../launch/windowLaunch";
import {projectFolderOf} from "../project";
import {repoRelative} from "../repoPaths";
import {BACKEND_OPTION, backendFor, BUILD_TARGETS, PROJECT_OPTION, targetOf} from "../targets";
import type {Target} from "../targets";
import type {ProjectWorkerBuildReport} from "../../hosts/desktop";
import {requireScope} from "./command";
import type {CommandResult} from "./command";

const JSON_REPORT = "json";

const OPTIONS = {
    project: PROJECT_OPTION,
    target: {kind: "value", values: BUILD_TARGETS},
    backend: BACKEND_OPTION,
    prod: {kind: "flag"},
    "with-editor": {kind: "flag"},
    report: {kind: "value", values: [JSON_REPORT]},
} as const;

const SITE_TARGETS: readonly Target[] = ["web", "window"];

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function editorReport(projectOption: string | undefined): Promise<ProjectWorkerBuildReport> {
    try {
        return await buildEditorWorker(projectFolderOf(projectOption));
    } catch (error) {
        return {ok: false, errors: [describeError(error)], generatedFiles: []};
    }
}

async function buildEditor(projectOption: string | undefined, jsonReport: boolean): Promise<CommandResult> {
    if (jsonReport) {
        const report = await editorReport(projectOption);
        process.stdout.write(JSON.stringify(report) + "\n");
        return report.ok ? EXIT_SUCCESS : EXIT_FAILURE;
    }
    const report = await buildEditorWorker(projectFolderOf(projectOption));
    if (!report.ok) throw new CliError("the editor build failed:", report.errors);
    for (const warning of report.warnings) console.warn(`warning: ${warning}`);
    console.log(`built ${repoRelative(report.bundlePath)}${report.editorExtensionsPath === undefined ? "" : ` and ${repoRelative(report.editorExtensionsPath)}`}`);
    return EXIT_SUCCESS;
}

export async function buildCommand(args: readonly string[]): Promise<CommandResult> {
    const options = parseOptions("build", args, OPTIONS);
    const target = targetOf(options.value("target"), BUILD_TARGETS);
    const requestedBackend = options.value("backend");
    backendFor(target, requestedBackend);
    if (requestedBackend !== undefined) throw usageError(`the ${target} build bundles every backend it supports; drop --backend`);
    requireScope(options, ["prod", "with-editor"], target === "web", "--target web");
    requireScope(options, ["report"], target === "editor", "--target editor");
    if (SITE_TARGETS.includes(target) && options.has("project")) {
        throw usageError(`the ${target} build covers every demo (${DEMO_SITES.map(site => site.project).join(", ")}); drop --project`);
    }
    switch (target) {
        case "terminal":
            throw usageError("the terminal target runs from source and has nothing to build; use jsengine run --target terminal");
        case "editor":
            return await buildEditor(options.value("project"), options.value("report") === JSON_REPORT);
        case "web": {
            const prod = options.flag("prod");
            await buildWebSite({prod, withEditor: !prod || options.flag("with-editor")});
            return EXIT_SUCCESS;
        }
        case "window":
            console.log(`bundled ${repoRelative(await buildWindowSite())}`);
            return EXIT_SUCCESS;
    }
}
