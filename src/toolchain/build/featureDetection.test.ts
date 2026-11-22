import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "fs";
import {dirname, join, relative, resolve} from "path";
import {describe, expect, test} from "../../engine/testing/harness";
import {REPO_ROOT, repoRelative, slashed, SOURCE_ROOT} from "../repoPaths";
import type {RunTarget} from "../targets";
import {checkBundleFeatures, featureProblemLine} from "./featureDetection";
import type {BundleFeatureResult, FeatureCheckBundle} from "./featureDetection";

const FIXTURE_PARENT = join(REPO_ROOT, "dist");
const FIXTURE_PREFIX = "featureDetection-fixture-";
const PLATFORM_MODULE = join(SOURCE_ROOT, "engine", "platform", "platform");
const PLATFORM_IMPORT = "PLATFORM_IMPORT";

const FIXTURE_FILES: Readonly<Record<string, string>> = {
    "reader.ts": [
        `import {Dirent, readFileSync} from "fs";`,
        `import type {Stats} from "fs";`,
        ``,
        `export function readConfig(path: string, stats?: Stats, entry?: Dirent): string {`,
        `    return readFileSync(path, "utf8");`,
        `}`,
    ].join("\n"),
    "sideEffectImport.ts": `import "node:fs";`,
    "nodeEntry.ts": [
        `import {readConfig} from "./reader";`,
        ``,
        `export const config = readConfig("config.json");`,
    ].join("\n"),
    "foldedGpu.ts": [
        `export function gpuAdapter(): unknown {`,
        `    if (JSENGINE_HAS_GPU) return GPUBufferUsage.VERTEX;`,
        `    return undefined;`,
        `}`,
    ].join("\n"),
    "typeofGuardedGpu.ts": [
        `import {hasFeature} from "${PLATFORM_IMPORT}";`,
        ``,
        `export function gpuAdapter(): unknown {`,
        `    return (typeof JSENGINE_HAS_GPU === "undefined" ? hasFeature("gpu") : JSENGINE_HAS_GPU) ? GPUBufferUsage.VERTEX : undefined;`,
        `}`,
    ].join("\n"),
    "unguardedGpu.ts": [
        `export function gpuAdapter(): unknown {`,
        `    return GPUBufferUsage.VERTEX;`,
        `}`,
    ].join("\n"),
    "optionalGpu.ts": [
        `import {optionalFeature} from "${PLATFORM_IMPORT}";`,
        ``,
        `export function gpuAdapter(): unknown {`,
        `    return optionalFeature("gpu", () => GPUBufferUsage.VERTEX);`,
        `}`,
    ].join("\n"),
    "otherFeatureOptional.ts": [
        `import {optionalFeature} from "${PLATFORM_IMPORT}";`,
        ``,
        `export function gpuAdapter(): unknown {`,
        `    return optionalFeature("audio", () => GPUBufferUsage.VERTEX);`,
        `}`,
    ].join("\n"),
    "mergedGlobal.ts": `export const startedAt = performance.now();`,
    "domGlobal.ts": `export const title = document.title;`,
    "workerGlobal.ts": `export const worker = new Worker("worker.js");`,
};

interface FixtureBundle {
    readonly entry: string;
    readonly imports?: readonly string[];
}

const BUNDLES: Readonly<Record<string, FixtureBundle>> = {
    node: {entry: "nodeEntry.ts", imports: ["reader.ts"]},
    sideEffectImport: {entry: "sideEffectImport.ts"},
    foldedGpu: {entry: "foldedGpu.ts"},
    typeofGuardedGpu: {entry: "typeofGuardedGpu.ts"},
    unguardedGpu: {entry: "unguardedGpu.ts"},
    optionalGpu: {entry: "optionalGpu.ts"},
    otherFeatureOptional: {entry: "otherFeatureOptional.ts"},
    mergedGlobal: {entry: "mergedGlobal.ts"},
    domGlobal: {entry: "domGlobal.ts"},
    workerGlobal: {entry: "workerGlobal.ts"},
};

const TARGETS: readonly RunTarget[] = ["terminal", "web"];

interface FixtureResults {
    readonly folder: string;
    readonly results: readonly BundleFeatureResult[];
}

let checked: FixtureResults | undefined;

function platformImportFrom(folder: string): string {
    return slashed(relative(folder, PLATFORM_MODULE));
}

function fixtureBundle(folder: string, name: string, target: RunTarget): FeatureCheckBundle {
    const {entry, imports = []} = BUNDLES[name];
    const entryPath = resolve(folder, entry);
    const importPaths = imports.map(file => resolve(folder, file));
    return {name: `${name} ${target}`, target, entry: entryPath, modules: [entryPath, ...importPaths], imports: new Map([[entryPath, importPaths]])};
}

function fixtureResults(): FixtureResults {
    if (checked !== undefined) return checked;
    mkdirSync(FIXTURE_PARENT, {recursive: true});
    const folder = mkdtempSync(join(FIXTURE_PARENT, FIXTURE_PREFIX));
    try {
        for (const [file, text] of Object.entries(FIXTURE_FILES)) {
            mkdirSync(dirname(join(folder, file)), {recursive: true});
            writeFileSync(join(folder, file), text.replace(PLATFORM_IMPORT, platformImportFrom(folder)) + "\n");
        }
        const bundles = Object.keys(BUNDLES).flatMap(name => TARGETS.map(target => fixtureBundle(folder, name, target)));
        checked = {folder, results: checkBundleFeatures(bundles)};
        return checked;
    } finally {
        rmSync(folder, {recursive: true, force: true});
    }
}

function resultOf(name: string, target: RunTarget): BundleFeatureResult {
    const result = fixtureResults().results.find(each => each.bundle === `${name} ${target}`);
    if (result === undefined) throw new Error(`no result for ${name} ${target}`);
    return result;
}

function usedSymbols(name: string, target: RunTarget): string[] {
    return resultOf(name, target).problems.map(problem => problem.symbol);
}

function fixturePath(file: string): string {
    return repoRelative(join(fixtureResults().folder, file));
}

describe("feature detection", () => {
    test("a node import in a web bundle fails, naming the feature, the use, its line and the import chain; names used only as types are no use", () => {
        const result = resultOf("node", "web");
        expect(result.problems.map(problem => [problem.symbol, problem.line])).toEqual([["readFileSync", 5]]);
        expect(featureProblemLine("web", result.problems[0])).toBe(`web lacks node: ${fixturePath("reader.ts")}:5 uses readFileSync, via ${fixturePath("nodeEntry.ts")}`);
        expect(usedSymbols("node", "terminal")).toEqual([]);
    });

    test("a side-effect import of a node: module is a use", () => {
        expect(resultOf("sideEffectImport", "web").problems.map(problem => [problem.symbol, problem.missing])).toEqual([[`"node:fs"`, {anyOf: ["node"], allOf: []}]]);
        expect(usedSymbols("sideEffectImport", "terminal")).toEqual([]);
    });

    test("a JSENGINE_HAS_GPU branch folded away for the terminal is not a use; unguarded, the same code is", () => {
        expect(usedSymbols("foldedGpu", "terminal")).toEqual([]);
        expect(usedSymbols("typeofGuardedGpu", "terminal")).toEqual([]);
        expect(resultOf("unguardedGpu", "terminal").problems.map(problem => [problem.symbol, problem.missing])).toEqual([["GPUBufferUsage", {anyOf: ["gpu"], allOf: []}]]);
        expect(["foldedGpu", "typeofGuardedGpu", "unguardedGpu"].flatMap(name => usedSymbols(name, "web"))).toEqual([]);
    });

    test("a symbol declared for several features needs any one of them", () => {
        expect(usedSymbols("mergedGlobal", "terminal")).toEqual([]);
        expect(usedSymbols("mergedGlobal", "web")).toEqual([]);
        expect(usedSymbols("domGlobal", "terminal")).toEqual(["document"]);
        const worker = resultOf("workerGlobal", "terminal").problems;
        expect(worker.map(problem => [problem.symbol, problem.missing])).toEqual([["Worker", {anyOf: ["dom", "bun"], allOf: []}]]);
        expect(featureProblemLine("terminal", worker[0])).toBe(`terminal lacks one of dom, bun: ${fixturePath("workerGlobal.ts")}:1 uses Worker`);
        expect(usedSymbols("workerGlobal", "web")).toEqual([]);
    });

    test("an optionalFeature probe is exempt from the feature it names, and only from that one", () => {
        expect(usedSymbols("optionalGpu", "terminal")).toEqual([]);
        expect(usedSymbols("otherFeatureOptional", "terminal")).toEqual(["GPUBufferUsage"]);
    });
});
