import {mkdirSync, rmSync, statSync, writeFileSync} from "fs";
import {dirname, isAbsolute, join, relative, resolve} from "path";
import type {BuildConfig, BuildOutput, BunPlugin} from "bun";
import {ENGINE_IMPORT_PREFIX, GENERATED_SCHEMAS_FILE} from "../src/editor/project/projectManifest";
import type {ProjectWorkerBuildReport, ProjectWorkerBuildError} from "../src/hosts/desktop/projectServer";
import {writeGeneratedSchemas} from "./projectSchemas/generateProjectSchemas";

const ROOT = resolve(__dirname, "..");
const SOURCE_ROOT = join(ROOT, "src");
const RESOLVE_SUFFIXES: readonly string[] = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"];
const ENGINE_IMPORT_FILTER = new RegExp(`^${ENGINE_IMPORT_PREFIX.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`);
const DRIVE_PATH = /[A-Za-z]:[\\/]/;
const LINE_BREAK = "\n";
const BACKSLASHES = /\\/g;
const PARENT_SEGMENT = "..";

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

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

interface BundleResult {
    readonly ok: boolean;
    readonly inputs: readonly string[];
    readonly errors: readonly ProjectWorkerBuildError[];
}

function projectDisplayPath(projectFolder: string, path: string): string {
    const inside = relative(projectFolder, path);
    const leavesFolder = inside.length === 0 || isAbsolute(inside) || inside.startsWith(PARENT_SEGMENT);
    return (leavesFolder ? path : inside).replace(BACKSLASHES, "/");
}

function describeExtensionError(projectFolder: string, error: ProjectWorkerBuildError): string {
    if (error.file === undefined) return error.message;
    return `${projectDisplayPath(projectFolder, error.file)}:${error.line ?? 0}:${error.column ?? 0}: ${error.message}`;
}

async function bundle(entryModule: string, outFile: string): Promise<BundleResult> {
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
    if (!result.success) return {ok: false, inputs: [], errors: result.logs.filter(log => log.level === "error").map(buildError)};
    mkdirSync(dirname(outFile), {recursive: true});
    writeFileSync(outFile, await result.outputs[0].text());
    return {ok: true, inputs: Object.keys(result.metafile?.inputs ?? {}).map(absoluteBuildPath), errors: []};
}

async function bundleEditorExtensions(projectFolder: string, entryModule: string, outFile: string): Promise<BundleResult & {readonly warning?: string}> {
    rmSync(outFile, {force: true});
    const built = await bundle(entryModule, outFile);
    if (built.ok) return built;
    const module = projectDisplayPath(projectFolder, entryModule);
    const errors = built.errors.map(error => describeExtensionError(projectFolder, error));
    return {...built, warning: `The editor extensions ${module} did not build, so the editor runs without them:${LINE_BREAK}${errors.join(LINE_BREAK)}`};
}

function report(result: ProjectWorkerBuildReport): void {
    process.stdout.write(JSON.stringify(result) + "\n");
}

async function main(): Promise<void> {
    const [entryModule, outFile, projectFolder, extensionsModule, extensionsOutFile] = process.argv.slice(2);
    if (entryModule === undefined || outFile === undefined || projectFolder === undefined || (extensionsModule !== undefined && extensionsOutFile === undefined)) {
        report({ok: false, errors: [{message: "usage: bun scripts/buildProjectWorker.ts <entry module> <output file> <project folder> [<editor extensions module> <editor extensions output file>]"}]});
        return;
    }
    let warnings: readonly string[];
    try {
        warnings = writeGeneratedSchemas(projectFolder, {repoRoot: ROOT}).warnings;
    } catch (error) {
        report({ok: false, errors: [{message: `Could not generate ${GENERATED_SCHEMAS_FILE}: ${describeError(error)}`}]});
        return;
    }
    const worker = await bundle(entryModule, outFile);
    if (!worker.ok) {
        report({ok: false, errors: worker.errors});
        return;
    }
    if (extensionsModule === undefined || extensionsOutFile === undefined) {
        report({ok: true, inputs: worker.inputs, warnings, editorExtensionsBundled: false});
        return;
    }
    const extensions = await bundleEditorExtensions(projectFolder, extensionsModule, extensionsOutFile);
    report({
        ok: true,
        inputs: [...worker.inputs, ...extensions.inputs],
        warnings: extensions.warning === undefined ? warnings : [...warnings, extensions.warning],
        editorExtensionsBundled: extensions.ok,
    });
}

main().catch(error => {
    report({ok: false, errors: [{message: describeError(error)}]});
});
