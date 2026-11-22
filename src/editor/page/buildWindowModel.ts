import {PROJECT_MANIFEST_FILE, validateProjectManifest} from "../../engine/project/projectManifest";
import {declaredTargets, PROJECT_TARGETS} from "../../engine/project/projectTargets";
import type {ProjectTarget} from "../../engine/project/projectTargets";
import type {EditorConsoleLevel} from "../editorProtocol";
import {PACKAGED_TARGET} from "../project/projectServerApi";
import type {FeatureProblem, MissingFeatures, PackageResult, TargetFeatureReport, TargetReportResult} from "../project/projectServerApi";

export interface BuildWindowServices {
    readonly readManifest: () => Promise<string>;
    readonly targetReport: (target: ProjectTarget) => Promise<TargetReportResult>;
    readonly packageProject: () => Promise<PackageResult>;
    readonly log: (level: EditorConsoleLevel, text: string) => void;
}

export type BuildAction = "build" | "package";

export interface RunningBuild {
    readonly target: ProjectTarget;
    readonly action: BuildAction;
}

export interface FeatureProblemView {
    readonly bundle: string;
    readonly feature: string;
    readonly symbol: string;
    readonly location: string;
    readonly chain: readonly string[];
}

export interface TargetReportView {
    readonly target: ProjectTarget;
    readonly ok: boolean;
    readonly summary: string;
    readonly problems: readonly FeatureProblemView[];
    readonly errors: readonly string[];
}

export interface ConsoleLine {
    readonly level: EditorConsoleLevel;
    readonly text: string;
}

export interface BuildTargetList {
    readonly targets: readonly ProjectTarget[];
    readonly problem?: string;
}

export const SITE_WIDE_TARGETS: readonly ProjectTarget[] = ["web", "window"];

const CHAIN_SEPARATOR = " -> ";
const LOCATION_SEPARATOR = ":";
const PACKAGE_COMMAND = `jsengine package --target ${PACKAGED_TARGET}`;
const MANIFEST_PROBLEM = `${PROJECT_MANIFEST_FILE} has problems, so every target is listed; fix it in Project Settings`;
const MANIFEST_UNREADABLE = `Could not read ${PROJECT_MANIFEST_FILE}, so every target is listed`;

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function buildCommandText(target: ProjectTarget): string {
    return `jsengine build --target ${target}`;
}

export function buildTargetsOf(manifestText: string | undefined): BuildTargetList {
    if (manifestText === undefined) return {targets: PROJECT_TARGETS, problem: MANIFEST_UNREADABLE};
    const validation = validateProjectManifest(manifestText);
    if (!validation.ok) return {targets: PROJECT_TARGETS, problem: MANIFEST_PROBLEM};
    return {targets: declaredTargets(validation.manifest.targets)};
}

export function missingFeaturesText(missing: MissingFeatures): string {
    const alternatives = missing.anyOf.length === 0 ? [] : [missing.anyOf.length === 1 ? missing.anyOf[0] : `one of ${missing.anyOf.join(", ")}`];
    return [...missing.allOf, ...alternatives].join(" and ");
}

function problemView(bundle: string, problem: FeatureProblem): FeatureProblemView {
    return {
        bundle,
        feature: missingFeaturesText(problem.missing),
        symbol: problem.symbol,
        location: [problem.file, problem.line, problem.column].join(LOCATION_SEPARATOR),
        chain: problem.chain,
    };
}

function reportSummary(report: TargetFeatureReport, problemCount: number): string {
    if (report.errors.length > 0) return `the ${report.target} build failed`;
    if (problemCount > 0) return `${problemCount} use(s) of features the ${report.target} lacks`;
    const modules = report.bundles.reduce((sum, bundle) => sum + bundle.modules, 0);
    return `features OK: ${report.bundles.length} bundle(s), ${modules} modules`;
}

export function targetReportView(report: TargetFeatureReport): TargetReportView {
    const problems = report.bundles.flatMap(bundle => bundle.problems.map(problem => problemView(bundle.bundle, problem)));
    return {target: report.target, ok: report.ok, summary: reportSummary(report, problems.length), problems, errors: report.errors};
}

export function featureProblemText(target: ProjectTarget, problem: FeatureProblemView): string {
    const importers = problem.chain.slice(0, -1);
    const via = importers.length === 0 ? "" : `, via ${importers.join(CHAIN_SEPARATOR)}`;
    return `${target} lacks ${problem.feature}: ${problem.location} uses ${problem.symbol}${via}`;
}

export function chainText(chain: readonly string[]): string {
    return chain.join(CHAIN_SEPARATOR);
}

export function targetReportConsoleLines(result: TargetReportResult): ConsoleLine[] {
    const view = targetReportView(result.report);
    const command = buildCommandText(view.target);
    return [
        ...result.output.map((text): ConsoleLine => ({level: "log", text})),
        {level: view.ok ? "info" : "error", text: `${command}: ${view.summary}`},
        ...view.errors.map((text): ConsoleLine => ({level: "error", text})),
        ...view.problems.map((problem): ConsoleLine => ({level: "error", text: featureProblemText(view.target, problem)})),
    ];
}

export function packageConsoleLines(result: PackageResult): ConsoleLine[] {
    return [
        ...result.output.map((text): ConsoleLine => ({level: "log", text})),
        result.ok ? {level: "info", text: `${PACKAGE_COMMAND}: packaged`} : {level: "error", text: `${PACKAGE_COMMAND} failed`},
    ];
}

export function failedTargetReport(target: ProjectTarget, error: unknown): TargetReportResult {
    return {report: {ok: false, target, bundles: [], errors: [describeError(error)]}, output: []};
}

export class BuildWindowModel {
    public targets: readonly ProjectTarget[] = [];
    public targetsProblem: string | undefined;
    public loaded = false;
    public busy = false;
    public running: RunningBuild | undefined;
    public packaged: boolean | undefined;
    private readonly reports = new Map<ProjectTarget, TargetReportView>();
    private readonly listeners = new Set<() => void>();

    public constructor(private readonly services: BuildWindowServices) {
    }

    public onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    public reportOf(target: ProjectTarget): TargetReportView | undefined {
        return this.reports.get(target);
    }

    public async load(): Promise<void> {
        const text = await this.services.readManifest().catch(() => undefined);
        const list = buildTargetsOf(text);
        this.targets = list.targets;
        this.targetsProblem = list.problem;
        this.loaded = true;
        this.changed();
    }

    public async build(target: ProjectTarget): Promise<void> {
        await this.exclusively(() => this.runBuild(target));
    }

    public async buildAll(): Promise<void> {
        await this.exclusively(async () => {
            for (const target of this.targets) await this.runBuild(target);
        });
    }

    public async packageWindow(): Promise<void> {
        await this.exclusively(() => this.runPackage());
    }

    private async exclusively(work: () => Promise<void>): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        this.changed();
        try {
            await work();
        } finally {
            this.busy = false;
            this.running = undefined;
            this.changed();
        }
    }

    private async runBuild(target: ProjectTarget): Promise<void> {
        this.running = {target, action: "build"};
        this.changed();
        this.services.log("info", `${buildCommandText(target)}…`);
        const result = await this.services.targetReport(target).catch(error => failedTargetReport(target, error));
        this.reports.set(target, targetReportView(result.report));
        this.logLines(targetReportConsoleLines(result));
        this.changed();
    }

    private async runPackage(): Promise<void> {
        this.running = {target: PACKAGED_TARGET, action: "package"};
        this.changed();
        this.services.log("info", `${PACKAGE_COMMAND}…`);
        const result = await this.services.packageProject().catch((error): PackageResult => ({ok: false, output: [describeError(error)]}));
        this.packaged = result.ok;
        this.logLines(packageConsoleLines(result));
        this.changed();
    }

    private logLines(lines: readonly ConsoleLine[]): void {
        for (const line of lines) this.services.log(line.level, line.text);
    }

    private changed(): void {
        for (const listener of this.listeners) listener();
    }
}
