import {existsSync, readFileSync} from "fs";
import {join, resolve} from "path";

const ROOT = resolve(__dirname, "..");
const MS_PER_SECOND = 1000;
const SECONDS_DECIMALS = 1;

type Runtime = "bun" | "node" | "any";
type Outcome = "PASS" | "FAIL" | "SKIPPED";

interface CheckStep {
    readonly label: string;
    readonly script: string;
    readonly runtime: Runtime;
    readonly args?: readonly string[];
}

const STEPS: readonly CheckStep[] = [
    {label: "typecheck", script: "typecheck", runtime: "any"},
    {label: "unit tests (bun)", script: "test", runtime: "bun"},
    {label: "unit tests (node)", script: "test:node", runtime: "node"},
    {label: "integration tests (bun)", script: "test:integration", runtime: "bun"},
    {label: "integration tests (node)", script: "test:integration:node", runtime: "node"},
    {label: "frame hashes", script: "test:frame-hashes", runtime: "bun"},
    {label: "demo frame hashes", script: "test:demo-frame-hashes", runtime: "bun"},
    {label: "bundle baseline and target features", script: "test:bundles", runtime: "bun"},
];

const RELEASE_FLAG = "--release";

const RELEASE_STEPS: readonly CheckStep[] = [
    {label: "window smoke (cells, pixels)", script: "smoke", runtime: "bun", args: ["window"]},
    {label: "window smoke (gpu)", script: "smoke", runtime: "bun", args: ["window", "--backend=gpu"]},
    {label: "editor smoke (gpu)", script: "smoke", runtime: "bun", args: ["editor"]},
    {label: "editor smoke (pixels)", script: "smoke", runtime: "bun", args: ["editor", "--backend=pixels"]},
];

function realNodeIsInstalled(): boolean {
    try {
        const probe = Bun.spawnSync(["node", "-p", "typeof Bun"], {stdout: "pipe", stderr: "pipe"});
        return probe.exitCode === 0 && probe.stdout.toString().trim() === "undefined";
    } catch {
        return false;
    }
}

function missingDevDependencies(): string[] {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {devDependencies?: Record<string, string>};
    return Object.keys(manifest.devDependencies ?? {}).filter(name => !existsSync(join(ROOT, "node_modules", name, "package.json")));
}

function seconds(ms: number): string {
    return `${(ms / MS_PER_SECOND).toFixed(SECONDS_DECIMALS)} s`;
}

async function runStep(step: CheckStep): Promise<Outcome> {
    const started = performance.now();
    const child = Bun.spawn([process.execPath, "run", step.script, ...(step.args ?? [])], {cwd: ROOT, stdout: "pipe", stderr: "pipe"});
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    const elapsed = seconds(performance.now() - started);
    if (exitCode === 0) {
        console.log(`PASS     ${step.label} (${elapsed})`);
        return "PASS";
    }
    console.log(`FAIL     ${step.label} (exit ${exitCode}, ${elapsed}): bun run ${[step.script, ...(step.args ?? [])].join(" ")}`);
    const output = `${stdout}${stderr}`.trimEnd();
    if (output.length > 0) console.log(output.split(/\r?\n/).map(line => `    | ${line}`).join("\n"));
    if (step.script === "typecheck") {
        const missing = missingDevDependencies();
        if (missing.length > 0) console.log(`    devDependencies not installed (run bun install): ${missing.join(", ")}`);
    }
    return "FAIL";
}

async function main(): Promise<void> {
    const nodeInstalled = realNodeIsInstalled();
    const outcomes: Outcome[] = [];
    const steps = process.argv.includes(RELEASE_FLAG) ? [...STEPS, ...RELEASE_STEPS] : STEPS;
    for (const step of steps) {
        if (step.runtime === "node" && !nodeInstalled) {
            console.log(`SKIPPED  ${step.label} (node not installed)`);
            outcomes.push("SKIPPED");
            continue;
        }
        outcomes.push(await runStep(step));
    }

    const count = (outcome: Outcome) => outcomes.filter(entry => entry === outcome).length;
    console.log(`\n${count("PASS")} passed, ${count("FAIL")} failed, ${count("SKIPPED")} skipped`);
    if (!nodeInstalled) console.log("node steps were skipped: node is not on PATH, so the node path is unverified");
    if (count("FAIL") > 0) process.exit(1);
}

void main();
