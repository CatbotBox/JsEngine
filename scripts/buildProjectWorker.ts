import {mkdirSync, statSync, writeFileSync} from "fs";
import {dirname, join, resolve} from "path";
import type {BuildConfig, BuildOutput, BunPlugin} from "bun";
import {ENGINE_IMPORT_PREFIX} from "../src/editor/project/projectManifest";
import type {ProjectWorkerBuildReport, ProjectWorkerBuildError} from "../src/hosts/desktop/projectServer";

const ROOT = resolve(__dirname, "..");
const SOURCE_ROOT = join(ROOT, "src");
const RESOLVE_SUFFIXES: readonly string[] = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"];
const ENGINE_IMPORT_FILTER = new RegExp(`^${ENGINE_IMPORT_PREFIX.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`);
const DRIVE_PATH = /[A-Za-z]:[\\/]/;

function isFile(path: string): boolean {
    try {
        return statSync(path).isFile();
    } catch {
        return false;
    }
}

function engineImportPath(specifier: string): string | undefined {
    const base = join(SOURCE_ROOT, specifier.slice(ENGINE_IMPORT_PREFIX.length));
    return RESOLVE_SUFFIXES.map(suffix => base + suffix).find(isFile);
}

const ENGINE_IMPORTS: BunPlugin = {
    name: "jsengine-imports",
    setup(build) {
        build.onResolve({filter: ENGINE_IMPORT_FILTER}, args => {
            const path = engineImportPath(args.path);
            return path === undefined ? undefined : {path};
        });
    },
};

function absoluteBuildPath(path: string): string {
    const drive = DRIVE_PATH.exec(path);
    return drive === null ? resolve(process.cwd(), path) : resolve(path.slice(drive.index));
}

function buildError(log: {readonly message: string, readonly position?: {readonly file: string, readonly line: number, readonly column: number} | null}): ProjectWorkerBuildError {
    const position = log.position;
    if (position === undefined || position === null) return {message: log.message};
    return {message: log.message, file: absoluteBuildPath(position.file), line: position.line, column: position.column};
}

type MetafileBuildOutput = BuildOutput & {readonly metafile?: {readonly inputs: Readonly<Record<string, unknown>>}};

function report(result: ProjectWorkerBuildReport): void {
    process.stdout.write(JSON.stringify(result) + "\n");
}

async function main(): Promise<void> {
    const [entryModule, outFile] = process.argv.slice(2);
    if (entryModule === undefined || outFile === undefined) {
        report({ok: false, errors: [{message: "usage: bun scripts/buildProjectWorker.ts <entry module> <output file>"}]});
        return;
    }
    const config = {
        entrypoints: [entryModule],
        target: "browser",
        format: "esm",
        sourcemap: "inline",
        metafile: true,
        throw: false,
        plugins: [ENGINE_IMPORTS],
    };
    const result = await Bun.build(config as BuildConfig) as MetafileBuildOutput;
    if (!result.success) {
        report({ok: false, errors: result.logs.filter(log => log.level === "error").map(buildError)});
        return;
    }
    mkdirSync(dirname(outFile), {recursive: true});
    writeFileSync(outFile, await result.outputs[0].text());
    const inputs = Object.keys(result.metafile?.inputs ?? {}).map(absoluteBuildPath);
    report({ok: true, inputs});
}

main().catch(error => {
    report({ok: false, errors: [{message: error instanceof Error ? error.message : String(error)}]});
});
