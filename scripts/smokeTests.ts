import {runCli} from "../src/toolchain/cli";
import {EXIT_SUCCESS, EXIT_USAGE} from "../src/toolchain/cliArguments";
import {DEMO_SITES} from "../src/toolchain/demoSites";

type SmokeSuite = "window" | "editor";
type SmokeBackend = "cells" | "pixels" | "gpu";

interface SmokeRun {
    readonly command: "run" | "edit";
    readonly project: string;
    readonly backend: SmokeBackend;
}

const SUITES: readonly SmokeSuite[] = ["window", "editor"];
const DEFAULT_SUITE: SmokeSuite = "window";
const BACKEND_FLAG_PREFIX = "--backend=";
const GAME_BACKENDS: readonly SmokeBackend[] = ["cells", "pixels"];
const EDITOR_DEFAULT_BACKEND: SmokeBackend = "gpu";
const EDITOR_GPU_PROJECT_ORDER: readonly string[] = ["demo/3d", "demo/2d", "demo/swarm"];
const EDITOR_PIXELS_PROJECT_ORDER: readonly string[] = ["demo/2d", "demo/3d", "demo/swarm"];
const USAGE = "usage: bun scripts/smokeTests.ts [window|editor] [--backend=cells|pixels|gpu]";

function windowRuns(backend: SmokeBackend | undefined): SmokeRun[] {
    const backends = backend === undefined ? GAME_BACKENDS : [backend];
    return backends.flatMap(each => DEMO_SITES.map((site): SmokeRun => ({command: "run", project: site.project, backend: each})));
}

function editorRuns(backend: SmokeBackend = EDITOR_DEFAULT_BACKEND): SmokeRun[] {
    const order = backend === EDITOR_DEFAULT_BACKEND ? EDITOR_GPU_PROJECT_ORDER : EDITOR_PIXELS_PROJECT_ORDER;
    return order.map(project => ({command: "edit", project, backend}));
}

function parseArguments(args: readonly string[]): {readonly suite: SmokeSuite, readonly backend?: SmokeBackend} | undefined {
    const backendArgument = args.find(arg => arg.startsWith(BACKEND_FLAG_PREFIX));
    const backend = backendArgument?.slice(BACKEND_FLAG_PREFIX.length) as SmokeBackend | undefined;
    const positional = args.filter(arg => !arg.startsWith("--"));
    const suite = (positional[0] ?? DEFAULT_SUITE) as SmokeSuite;
    const known = SUITES.includes(suite) && positional.length <= 1 && args.length === positional.length + (backendArgument === undefined ? 0 : 1);
    return known ? {suite, ...(backend === undefined ? {} : {backend})} : undefined;
}

async function main(): Promise<void> {
    const parsed = parseArguments(process.argv.slice(2));
    if (parsed === undefined) {
        console.error(USAGE);
        process.exitCode = EXIT_USAGE;
        return;
    }
    const runs = parsed.suite === "window" ? windowRuns(parsed.backend) : editorRuns(parsed.backend);
    for (const [index, run] of runs.entries()) {
        const firstRunBuilds = index === 0 ? [] : ["--no-build"];
        const exitCode = await runCli([run.command, "--target", "window", "--project", run.project, "--backend", run.backend, "--smoke", ...firstRunBuilds]);
        if (exitCode !== EXIT_SUCCESS) {
            process.exitCode = typeof exitCode === "number" ? exitCode : EXIT_USAGE;
            return;
        }
    }
}

void main();
