import {CliError, EXIT_FAILURE, EXIT_SUCCESS, parseOptions, usageError} from "../cliArguments";
import type {ParsedOptions} from "../cliArguments";
import {
    BUNDLE_BASELINE_FILE,
    buildSampleProjectBundles,
    bundleRecordHeader,
    compareBundles,
    readBundleBaseline,
    writeBundleBaseline,
} from "../build/bundleReport";
import type {BundleComparison} from "../build/bundleReport";
import {buildEditorWorker, editorWorkerReport} from "../build/editorBuild";
import {
    checkBundleFeatures,
    FEATURE_PROBLEM_FIX,
    featureProblemCount,
    featureProblemLines,
    featureSummary,
    requireTargetFeatures,
    targetFeatureReport,
} from "../build/featureDetection";
import type {BundleFeatureResult, TargetFeatureReport} from "../build/featureDetection";
import {checkTerminalBuild} from "../build/terminalBuild";
import {buildWebSite, regenerateSampleProjects} from "../build/webBuild";
import {buildWindowSite} from "../launch/windowLaunch";
import {projectFolderOf} from "../project";
import {repoRelative} from "../repoPaths";
import {BACKEND_OPTION, backendFor, BUILD_TARGETS, editorSimulationOf, PROJECT_OPTION, SIMULATE_OPTION, targetOf} from "../targets";
import type {EditorSimulation, RunTarget, Target} from "../targets";
import {requireScope} from "./command";
import type {CommandResult} from "./command";

const JSON_REPORT = "json";
const BUNDLES_REPORT = "bundles";
const UPDATE_BASELINE_OPTION = "update-baseline";
const NO_GENERATE_OPTION = "no-generate";
const BUNDLES_REPORT_EXCLUDED_OPTIONS: readonly string[] = ["target", "simulate", "backend", "project", "prod", "with-editor", NO_GENERATE_OPTION];
const EDITOR_TARGET = "editor" satisfies Target;

const OPTIONS = {
    project: PROJECT_OPTION,
    target: {kind: "value", values: BUILD_TARGETS},
    simulate: SIMULATE_OPTION,
    backend: BACKEND_OPTION,
    prod: {kind: "flag"},
    "with-editor": {kind: "flag"},
    [NO_GENERATE_OPTION]: {kind: "flag"},
    report: {kind: "value", values: [JSON_REPORT, BUNDLES_REPORT]},
    [UPDATE_BASELINE_OPTION]: {kind: "flag"},
} as const;

const MODULE_LINE_INDENT = "    ";
const ADDED_MARK = "+ ";
const REMOVED_MARK = "- ";

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function errorLines(error: unknown): string[] {
    return error instanceof CliError ? [error.message, ...error.details] : [describeError(error)];
}

async function finishFeatureCheck(target: RunTarget, jsonReport: boolean, build: () => Promise<TargetFeatureReport>): Promise<CommandResult> {
    if (!jsonReport) {
        const report = await build();
        requireTargetFeatures(report);
        console.log(featureSummary(report));
        return EXIT_SUCCESS;
    }
    let report: TargetFeatureReport;
    try {
        report = await build();
    } catch (error) {
        report = targetFeatureReport(target, [], errorLines(error));
    }
    process.stdout.write(JSON.stringify(report) + "\n");
    return report.ok ? EXIT_SUCCESS : EXIT_FAILURE;
}

async function builtWindowFeatures(project: string | undefined): Promise<TargetFeatureReport> {
    const built = await buildWindowSite(project);
    console.log(`bundled ${repoRelative(built.mainProcess)}`);
    return built.features;
}

function siteProjectOf(projectOption: string | undefined): string | undefined {
    return projectOption === undefined ? undefined : projectFolderOf(projectOption);
}

async function buildEditor(projectOption: string | undefined, simulation: EditorSimulation, jsonReport: boolean): Promise<CommandResult> {
    if (jsonReport) {
        const report = await editorWorkerReport(projectOption, simulation);
        process.stdout.write(JSON.stringify(report) + "\n");
        return report.ok ? EXIT_SUCCESS : EXIT_FAILURE;
    }
    const report = await buildEditorWorker(projectFolderOf(projectOption), simulation);
    if (!report.ok) throw new CliError("the editor build failed:", report.errors);
    for (const warning of report.warnings) console.warn(`warning: ${warning}`);
    const extensions = report.editorExtensionsPath === undefined ? "" : ` and ${repoRelative(report.editorExtensionsPath)}`;
    console.log(`built ${repoRelative(report.bundlePath)}${extensions}, simulating the ${simulation.target} target with the ${simulation.backend} backend`);
    return EXIT_SUCCESS;
}

function signedBytes(bytes: number): string {
    return `${bytes > 0 ? "+" : ""}${bytes} bytes`;
}

function comparisonLine(comparison: BundleComparison): string {
    const header = bundleRecordHeader(comparison.record);
    const delta = ` (${signedBytes(comparison.record.minifiedBytes - comparison.baseline.minifiedBytes)})`;
    if (comparison.added.length > 0) return `ADDED    ${header}${delta}: ${comparison.added.length} module(s) not in the baseline`;
    if (comparison.removed.length > 0) return `smaller  ${header}${delta}: ${comparison.removed.length} module(s) fewer than the baseline`;
    return `ok       ${header}${delta}`;
}

function moduleLines(mark: string, modules: readonly string[]): string[] {
    return modules.map(module => `${MODULE_LINE_INDENT}${mark}${module}`);
}

function bundleFeaturesFailure(features: readonly BundleFeatureResult[]): string {
    return `${featureProblemCount(features)} use(s) of features their bundle's target lacks; ${FEATURE_PROBLEM_FIX}`;
}

async function bundlesReport(options: ParsedOptions): Promise<CommandResult> {
    const excluded = BUNDLES_REPORT_EXCLUDED_OPTIONS.find(name => options.has(name));
    if (excluded !== undefined) throw usageError(`--report ${BUNDLES_REPORT} covers every sample project, target and backend; drop --${excluded}`);
    regenerateSampleProjects();
    const bundles = await buildSampleProjectBundles();
    const records = bundles.map(bundle => bundle.record);
    const features = checkBundleFeatures(bundles.map(bundle => bundle.features));
    const baselineName = repoRelative(BUNDLE_BASELINE_FILE);
    if (options.flag(UPDATE_BASELINE_OPTION)) {
        writeBundleBaseline(records);
        for (const record of records) console.log(bundleRecordHeader(record));
        console.log(`wrote ${baselineName}`);
        if (featureProblemCount(features) > 0) throw new CliError(`${bundleFeaturesFailure(features)}:`, featureProblemLines(features));
        return EXIT_SUCCESS;
    }
    const baseline = readBundleBaseline();
    if (baseline.bunVersion !== Bun.version) {
        const recorded = baseline.bunVersion === undefined ? "no bun version" : `bun ${baseline.bunVersion}`;
        throw new CliError(`${baselineName} was recorded with ${recorded}, but this run bundles with bun ${Bun.version} (${process.execPath}), `
            + `whose tree shaking differs; run the gate with bun ${baseline.bunVersion ?? Bun.version}, or rerun with --${UPDATE_BASELINE_OPTION} to record this bun's bundles`);
    }
    const report = compareBundles(records, baseline.records);
    for (const comparison of report.comparisons) {
        console.log(comparisonLine(comparison));
        for (const line of [...moduleLines(ADDED_MARK, comparison.added), ...moduleLines(REMOVED_MARK, comparison.removed)]) console.log(line);
    }
    const problems = [
        ...report.comparisons.filter(comparison => comparison.added.length > 0)
            .map(comparison => `${comparison.record.key} gained ${comparison.added.join(", ")}`),
        ...report.missingFromBaseline.map(key => `${key} has no entry in ${baselineName}`),
        ...report.missingFromBuild.map(key => `${key} is in ${baselineName} but no longer built`),
    ];
    const failingFeatures = featureProblemCount(features) > 0;
    if (problems.length > 0 || failingFeatures) {
        const failures = [
            ...(problems.length === 0 ? [] : [`${problems.length} bundle(s) differ from ${baselineName}; if intended, rerun with --${UPDATE_BASELINE_OPTION}`]),
            ...(failingFeatures ? [bundleFeaturesFailure(features)] : []),
        ];
        throw new CliError(`${failures.join(". ")}:`, [...problems, ...featureProblemLines(features)]);
    }
    const improved = report.comparisons.filter(comparison => comparison.removed.length > 0).length;
    const lockIn = improved === 0 ? "" : `; ${improved} bundle(s) lost modules, rerun with --${UPDATE_BASELINE_OPTION} to lock that in`;
    console.log(`no bundle gained a module against ${baselineName} (${report.comparisons.length} bundles${lockIn})`);
    console.log(`no bundle uses a feature its target lacks (${features.length} bundles, ${features.reduce((sum, result) => sum + result.modules, 0)} modules checked)`);
    return EXIT_SUCCESS;
}

export async function buildCommand(args: readonly string[]): Promise<CommandResult> {
    const options = parseOptions("build", args, OPTIONS);
    const reportKind = options.value("report");
    requireScope(options, [UPDATE_BASELINE_OPTION], reportKind === BUNDLES_REPORT, `--report ${BUNDLES_REPORT}`);
    if (reportKind === BUNDLES_REPORT) return await bundlesReport(options);
    const target = targetOf(options.value("target"), BUILD_TARGETS);
    requireScope(options, ["simulate"], target === EDITOR_TARGET, `--target ${EDITOR_TARGET}`);
    requireScope(options, ["prod", "with-editor", NO_GENERATE_OPTION], target === "web", "--target web");
    const requestedBackend = options.value("backend");
    const jsonReport = reportKind === JSON_REPORT;
    if (target === EDITOR_TARGET) return await buildEditor(options.value("project"), editorSimulationOf(options.value("simulate"), requestedBackend), jsonReport);
    backendFor(target, requestedBackend);
    if (requestedBackend !== undefined) throw usageError(`the ${target} build bundles every backend it supports; drop --backend`);
    switch (target) {
        case "terminal":
            return await finishFeatureCheck(target, jsonReport, () => checkTerminalBuild(projectFolderOf(options.value("project"))));
        case "web": {
            const prod = options.flag("prod");
            const regenerate = !options.flag(NO_GENERATE_OPTION);
            return await finishFeatureCheck(target, jsonReport, () => buildWebSite({prod, withEditor: !prod || options.flag("with-editor"), target, project: siteProjectOf(options.value("project")), regenerate}));
        }
        case "window":
            return await finishFeatureCheck(target, jsonReport, () => builtWindowFeatures(siteProjectOf(options.value("project"))));
    }
}
