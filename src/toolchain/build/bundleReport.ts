import {existsSync, readFileSync, writeFileSync} from "fs";
import {join} from "path";
import {RENDER_BACKEND_KINDS} from "../../engine/rendering/renderBackend";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import {DEV_RELOAD_DEFINE} from "../../hosts/web/devReload";
import {CliError} from "../cliArguments";
import {DEMO_SITES, demoSiteFolder} from "../demoSites";
import {TERMINAL_MAIN_FILE, WEB_PAGE_BOOTSTRAP_FILE, webPageMainFile, webWorkerMainFile} from "../projectLayout";
import {REPO_ROOT, repoRelative} from "../repoPaths";
import {featureDefines} from "../targets";
import type {RunTarget} from "../targets";
import {bundleInputsOf, requireMetafile} from "./bundleMetafile";
import type {MetafileBuildConfig, MetafileBuildOutput} from "./bundleMetafile";
import type {FeatureCheckBundle} from "./featureDetection";

export const BUNDLE_BASELINE_FILE = join(REPO_ROOT, "tests", "bundles.baseline.txt");

type BundleTarget = Extract<RunTarget, "terminal" | "web">;
type BundleBackend = RenderBackendKind | typeof ANY_BACKEND;
type BundleRole = "main" | "bootstrap" | "page" | "worker";
type BunBuildTarget = "bun" | "browser";

interface BundleSpec {
    readonly project: string;
    readonly target: BundleTarget;
    readonly backend: BundleBackend;
    readonly role: BundleRole;
    readonly entry: string;
    readonly buildTarget: BunBuildTarget;
}

export interface BundleRecord {
    readonly key: string;
    readonly modules: readonly string[];
    readonly minifiedBytes: number;
}

export interface BuiltBundle {
    readonly record: BundleRecord;
    readonly features: FeatureCheckBundle;
}

export interface BundleBaseline {
    readonly bunVersion: string | undefined;
    readonly records: ReadonlyMap<string, BundleRecord>;
}

export interface BundleComparison {
    readonly record: BundleRecord;
    readonly baseline: BundleRecord;
    readonly added: readonly string[];
    readonly removed: readonly string[];
}

export interface BundleReport {
    readonly records: readonly BundleRecord[];
    readonly comparisons: readonly BundleComparison[];
    readonly missingFromBaseline: readonly string[];
    readonly missingFromBuild: readonly string[];
}

const ANY_BACKEND = "all";
const TERMINAL_BACKEND: RenderBackendKind = "cells";
const RECORD_HEADER = /^(\S+ \S+ \S+ \S+): (\d+) modules, (\d+) bytes minified$/;
const MODULE_INDENT = "  ";
const BUN_VERSION_PREFIX = "recorded with bun ";
const LINE_BREAK = "\n";
const LINE_SPLIT = /\r?\n/;
const MINIFIED_DEV_RELOAD = JSON.stringify(false);

function compareText(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function bundleKey(spec: BundleSpec): string {
    return `${spec.project} ${spec.target} ${spec.backend} ${spec.role}`;
}

function projectBundles(project: string): BundleSpec[] {
    const folder = join(REPO_ROOT, ...project.split("/"));
    const spec = (target: BundleTarget, backend: BundleBackend, role: BundleRole, file: string, buildTarget: BunBuildTarget): BundleSpec =>
        ({project, target, backend, role, entry: join(folder, file), buildTarget});
    return [
        spec("terminal", TERMINAL_BACKEND, "main", TERMINAL_MAIN_FILE, "bun"),
        spec("web", ANY_BACKEND, "bootstrap", WEB_PAGE_BOOTSTRAP_FILE, "browser"),
        ...RENDER_BACKEND_KINDS.flatMap(backend => [
            spec("web", backend, "page", webPageMainFile(backend), "browser"),
            spec("web", backend, "worker", webWorkerMainFile(backend), "browser"),
        ]),
    ];
}

function demoBundles(): BundleSpec[] {
    return DEMO_SITES.flatMap(site => projectBundles(repoRelative(demoSiteFolder(site))));
}

async function buildBundle(spec: BundleSpec): Promise<BuiltBundle> {
    const config: MetafileBuildConfig = {
        entrypoints: [spec.entry],
        target: spec.buildTarget,
        minify: true,
        metafile: true,
        throw: false,
        define: {[DEV_RELOAD_DEFINE]: MINIFIED_DEV_RELOAD, ...featureDefines(spec.target)},
    };
    const result: MetafileBuildOutput = await Bun.build(config);
    const key = bundleKey(spec);
    if (!result.success) throw new CliError(`bundling ${key} (${repoRelative(spec.entry)}) failed:`, result.logs.map(String));
    const inputs = bundleInputsOf(spec.entry, requireMetafile(result, key));
    const minifiedBytes = result.outputs.reduce((sum, output) => sum + output.size, 0);
    return {
        record: {key, modules: inputs.modules.map(repoRelative).sort(compareText), minifiedBytes},
        features: {...inputs, name: key, target: spec.target},
    };
}

export async function buildDemoBundles(): Promise<BuiltBundle[]> {
    const bundles: BuiltBundle[] = [];
    for (const spec of demoBundles()) bundles.push(await buildBundle(spec));
    return bundles;
}

export function bundleRecordHeader(record: BundleRecord): string {
    return `${record.key}: ${record.modules.length} modules, ${record.minifiedBytes} bytes minified`;
}

export function bundleBaselineText(records: readonly BundleRecord[], bunVersion: string): string {
    const recordLines = records.flatMap(record => [bundleRecordHeader(record), ...record.modules.map(module => MODULE_INDENT + module)]);
    return [BUN_VERSION_PREFIX + bunVersion, ...recordLines].join(LINE_BREAK) + LINE_BREAK;
}

export function parseBundleBaseline(text: string): BundleBaseline {
    const records = new Map<string, BundleRecord>();
    let bunVersion: string | undefined;
    let current: {key: string; modules: string[]; minifiedBytes: number} | undefined;
    const finish = () => {
        if (current !== undefined) records.set(current.key, current);
    };
    for (const line of text.split(LINE_SPLIT)) {
        if (line.startsWith(BUN_VERSION_PREFIX)) {
            bunVersion = line.slice(BUN_VERSION_PREFIX.length);
            continue;
        }
        if (line.startsWith(MODULE_INDENT)) {
            current?.modules.push(line.slice(MODULE_INDENT.length));
            continue;
        }
        const header = RECORD_HEADER.exec(line);
        if (header === null) continue;
        finish();
        current = {key: header[1], modules: [], minifiedBytes: Number(header[3])};
    }
    finish();
    return {bunVersion, records};
}

export function readBundleBaseline(path = BUNDLE_BASELINE_FILE): BundleBaseline {
    return existsSync(path) ? parseBundleBaseline(readFileSync(path, "utf8")) : {bunVersion: undefined, records: new Map()};
}

export function writeBundleBaseline(records: readonly BundleRecord[], path = BUNDLE_BASELINE_FILE): void {
    writeFileSync(path, bundleBaselineText(records, Bun.version));
}

export function compareBundles(records: readonly BundleRecord[], baseline: ReadonlyMap<string, BundleRecord>): BundleReport {
    const comparisons: BundleComparison[] = [];
    const missingFromBaseline: string[] = [];
    for (const record of records) {
        const before = baseline.get(record.key);
        if (before === undefined) {
            missingFromBaseline.push(record.key);
            continue;
        }
        const beforeModules = new Set(before.modules);
        const afterModules = new Set(record.modules);
        comparisons.push({
            record,
            baseline: before,
            added: record.modules.filter(module => !beforeModules.has(module)),
            removed: before.modules.filter(module => !afterModules.has(module)),
        });
    }
    const built = new Set(records.map(record => record.key));
    const missingFromBuild = [...baseline.keys()].filter(key => !built.has(key));
    return {records, comparisons, missingFromBaseline, missingFromBuild};
}
