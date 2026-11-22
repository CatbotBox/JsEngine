import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "fs";
import {dirname, join, relative, resolve} from "path";
import {PROJECT_MANIFEST_FILE} from "../src/engine/project/projectManifest";
import {checkTerminalBuild} from "../src/toolchain/build/terminalBuild";
import {featureProblemLine} from "../src/toolchain/build/featureDetection";
import type {TargetFeatureReport} from "../src/toolchain/build/featureDetection";
import {runCli} from "../src/toolchain/cli";
import {EXIT_FAILURE, EXIT_SUCCESS} from "../src/toolchain/cliArguments";
import {GENERATED_GAME_FILE, GENERATED_SYSTEMS_FILE, TERMINAL_MAIN_FILE} from "../src/toolchain/projectLayout";

const ROOT = resolve(__dirname, "..");
const FIXTURE_PARENT = join(ROOT, "dist");
const FIXTURE_PREFIX = "featureDetection-project-";
const GAME_FILE = "game.ts";
const GPU_FILE = "gpuUsage.ts";
const GPU_USE_LINE = 2;

function log(message: string): void {
    process.stdout.write(message + "\n");
}

let failures = 0;
function expect(condition: boolean, label: string): void {
    if (condition) log(`ok   ${label}`);
    else {
        failures++;
        log(`FAIL ${label}`);
    }
}

function engineCoreFrom(folder: string): string {
    return relative(folder, join(ROOT, "src", "engine", "core")).replace(/\\/g, "/");
}

function gameSource(folder: string, guarded: boolean): string {
    const use = guarded ? "if (JSENGINE_HAS_GPU) console.log(gpuUsage());" : "console.log(gpuUsage());";
    return [
        `import {System} from "${engineCoreFrom(folder)}";`,
        `import {gpuUsage} from "./gpuUsage";`,
        ``,
        `export class GpuProbeSystem extends System {`,
        `    onUpdate(): void {`,
        `        ${use}`,
        `    }`,
        `}`,
        ``,
    ].join("\n");
}

function writeFixture(folder: string, guarded: boolean): void {
    const files: Readonly<Record<string, string>> = {
        [PROJECT_MANIFEST_FILE]: JSON.stringify({name: "Feature detection fixture"}),
        [GAME_FILE]: gameSource(folder, guarded),
        [GPU_FILE]: ["export function gpuUsage(): number {", "    return GPUBufferUsage.VERTEX;", "}", ""].join("\n"),
    };
    for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(folder, path)), {recursive: true});
        writeFileSync(join(folder, path), text);
    }
}

function fixturePath(folder: string, file: string): string {
    return relative(ROOT, join(folder, file)).replace(/\\/g, "/");
}

function problemsOf(report: TargetFeatureReport): string[] {
    return report.bundles.flatMap(bundle => bundle.problems.map(problem => featureProblemLine(report.target, problem)));
}

async function checkFoldedBranchPasses(folder: string): Promise<void> {
    writeFixture(folder, true);
    const report = await checkTerminalBuild(folder);
    expect(report.ok && problemsOf(report).length === 0, "a JSENGINE_HAS_GPU branch is folded away for the terminal, and the GPU module it imported leaves the bundle");
    expect(await runCli(["build", "--target", "terminal", "--project", folder]) === EXIT_SUCCESS, "jsengine build --target terminal passes the folded project");
}

async function checkUnguardedUseFails(folder: string): Promise<void> {
    writeFixture(folder, false);
    const report = await checkTerminalBuild(folder);
    const chain = [TERMINAL_MAIN_FILE, GENERATED_GAME_FILE, GENERATED_SYSTEMS_FILE, GAME_FILE].map(file => fixturePath(folder, file));
    const expected = `terminal lacks gpu: ${fixturePath(folder, GPU_FILE)}:${GPU_USE_LINE} uses GPUBufferUsage, via ${chain.join(" -> ")}`;
    const problems = problemsOf(report);
    expect(!report.ok && problems[0] === expected, `an unguarded GPU use fails the terminal check with its feature, line and import chain (got: ${problems[0] ?? "no problem"})`);
    expect(await runCli(["build", "--target", "terminal", "--project", folder]) === EXIT_FAILURE, "jsengine build --target terminal fails the unguarded project");
}

async function main(): Promise<void> {
    if (typeof Bun === "undefined") {
        log("skipped: the feature check bundles with Bun.build, so it runs under bun only");
        return;
    }
    mkdirSync(FIXTURE_PARENT, {recursive: true});
    const folder = mkdtempSync(join(FIXTURE_PARENT, FIXTURE_PREFIX));
    try {
        await checkFoldedBranchPasses(folder);
        await checkUnguardedUseFails(folder);
    } finally {
        rmSync(folder, {recursive: true, force: true});
    }
    if (failures > 0) {
        log(`${failures} check(s) failed`);
        process.exitCode = 1;
    } else {
        log("all feature detection checks passed");
    }
}

void main();
