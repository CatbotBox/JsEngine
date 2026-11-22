import {createHash} from "crypto";
import {mkdirSync, rmSync, statSync, writeFileSync} from "fs";
import {dirname, isAbsolute, join, relative, resolve, sep} from "path";
import {pathToFileURL} from "url";
import type {BuildConfig, BuildOutput, BunPlugin} from "bun";
import type {ProjectManifest} from "../../engine/project/projectManifest";
import {EDITOR_EXTENSIONS_BUNDLE_FILE} from "../../editor/project/editorExtensions";
import type {ProjectWorkerBuildReport} from "../../hosts/desktop";
import {CliError} from "../cliArguments";
import {PROJECT_GENERATED_FILES, writeGeneratedFiles} from "../generate/generatedFiles";
import {DEFAULT_ENTRY_FILE, editorWorkerMainFile, ENGINE_IMPORT_PREFIX, GENERATED_FOLDER, START_PROJECT_EXPORT} from "../projectLayout";
import {readProjectManifest} from "../project";
import {EDITOR_PROJECTS_DIST, REPO_ROOT, slashed, SOURCE_ROOT} from "../repoPaths";
import {featureDefines} from "../targets";
import type {EditorSimulation} from "../targets";

export interface EditorBuildError {
    readonly message: string;
    readonly file?: string;
    readonly line?: number;
    readonly column?: number;
}

export interface EditorBuildPaths {
    readonly folder: string;
    readonly entry: string;
    readonly editorMain: string;
}

const RESOLVE_SUFFIXES: readonly string[] = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"];
const ENGINE_IMPORT_FILTER = new RegExp(`^${ENGINE_IMPORT_PREFIX.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`);
const DRIVE_PATH = /[A-Za-z]:[\\/]/;
const MISSING_EXPORT = /No matching export in "(.+?)" for import "(.+?)"/;
const LINE_BREAK = "\n";
const PARENT_SEGMENT = "..";
const FOLDER_HASH_HEX_DIGITS = 16;
const NO_DEFINES: Readonly<Record<string, string>> = {};

export function editorWorkerBundleFile(simulation: EditorSimulation): string {
    return `editor.${simulation.target}-${simulation.backend}.worker.js`;
}

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

function samePath(a: string, b: string): boolean {
    const left = resolve(a);
    const right = resolve(b);
    return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function isInsideDirectory(root: string, path: string): boolean {
    const inside = relative(root, path);
    return inside === "" || (!isAbsolute(inside) && inside.split(sep)[0] !== PARENT_SEGMENT);
}

function engineImportPath(specifier: string): string | undefined {
    const base = join(SOURCE_ROOT, specifier.slice(ENGINE_IMPORT_PREFIX.length));
    return RESOLVE_SUFFIXES.map(suffix => base + suffix).find(isFile);
}

export const ENGINE_IMPORTS: BunPlugin = {
    name: "jsengine-imports",
    setup(build) {
        build.onResolve({filter: ENGINE_IMPORT_FILTER}, args => {
            const path = engineImportPath(args.path);
            return path === undefined ? undefined : {path};
        });
    },
};

export const EXTERNAL_ENGINE_IMPORTS: BunPlugin = {
    name: "jsengine-external-imports",
    setup(build) {
        build.onResolve({filter: ENGINE_IMPORT_FILTER}, args => {
            const path = engineImportPath(args.path);
            return path === undefined ? undefined : {path: pathToFileURL(path).href, external: true};
        });
    },
};

function absoluteBuildPath(path: string): string {
    const drive = DRIVE_PATH.exec(path);
    return drive === null ? resolve(process.cwd(), path) : resolve(path.slice(drive.index));
}

function buildError(log: {readonly message: string, readonly position?: {readonly file: string, readonly line: number, readonly column: number} | null}): EditorBuildError {
    const position = log.position;
    if (position === undefined || position === null) return {message: log.message};
    return {message: log.message, file: absoluteBuildPath(position.file), line: position.line, column: position.column};
}

type MetafileBuildOutput = BuildOutput & {readonly metafile?: {readonly inputs: Readonly<Record<string, unknown>>}};

interface BundleResult {
    readonly ok: boolean;
    readonly inputs: readonly string[];
    readonly errors: readonly EditorBuildError[];
}

function projectDisplayPath(projectFolder: string, path: string): string {
    const inside = relative(projectFolder, path);
    const leavesFolder = inside.length === 0 || isAbsolute(inside) || inside.startsWith(PARENT_SEGMENT);
    return slashed(leavesFolder ? path : inside);
}

function describeExtensionError(projectFolder: string, error: EditorBuildError): string {
    if (error.file === undefined) return error.message;
    return `${projectDisplayPath(projectFolder, error.file)}:${error.line ?? 0}:${error.column ?? 0}: ${error.message}`;
}

async function bundle(entryModule: string, outFile: string, define: Readonly<Record<string, string>> = NO_DEFINES): Promise<BundleResult> {
    const config = {
        entrypoints: [entryModule],
        target: "browser",
        format: "esm",
        sourcemap: "inline",
        metafile: true,
        throw: false,
        define,
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

export function projectBuildDirectory(folder: string): string {
    const key = process.platform === "win32" ? resolve(folder).toLowerCase() : resolve(folder);
    const hash = createHash("sha1").update(key).digest("hex").slice(0, FOLDER_HASH_HEX_DIGITS);
    return join(EDITOR_PROJECTS_DIST, hash);
}

function displayPath(path: string, folder: string): string {
    if (isInsideDirectory(folder, path)) return slashed(relative(folder, path));
    if (isInsideDirectory(REPO_ROOT, path)) return slashed(relative(REPO_ROOT, path));
    return slashed(path);
}

export function describeBuildErrors(errors: readonly EditorBuildError[], paths: EditorBuildPaths): string[] {
    const entryPath = resolve(paths.folder, paths.entry);
    const described = errors.map(error => {
        const missing = MISSING_EXPORT.exec(error.message);
        if (missing !== null) {
            const exporter = absoluteBuildPath(missing[1]);
            const importer = error.file === undefined ? undefined : resolve(error.file);
            const fromEditorMain = importer !== undefined && samePath(importer, paths.editorMain);
            if (samePath(exporter, entryPath) || (fromEditorMain && missing[2] === START_PROJECT_EXPORT)) {
                return `entry ${slashed(paths.entry)} does not export ${missing[2]}`;
            }
        }
        if (error.file === undefined) return error.message;
        return `${displayPath(error.file, paths.folder)}:${error.line ?? 0}:${error.column ?? 0}: ${error.message}`;
    });
    return described.length > 0 ? described : ["bun build failed without reporting an error"];
}

export async function buildEditorWorker(projectFolder: string, simulation: EditorSimulation): Promise<ProjectWorkerBuildReport> {
    const folder = resolve(projectFolder);
    const generatedFiles = PROJECT_GENERATED_FILES;
    let manifest: ProjectManifest;
    try {
        manifest = readProjectManifest(folder);
    } catch (error) {
        const details = error instanceof CliError ? error.details : [];
        return {ok: false, errors: details.length > 0 ? details : [describeError(error)], generatedFiles};
    }
    const directory = projectBuildDirectory(folder);
    mkdirSync(directory, {recursive: true});
    const editorMain = join(folder, editorWorkerMainFile(simulation.backend));
    const bundlePath = join(directory, editorWorkerBundleFile(simulation));
    let warnings: readonly string[];
    try {
        warnings = writeGeneratedFiles(folder).warnings;
    } catch (error) {
        return {ok: false, errors: [`Could not generate the files in ${GENERATED_FOLDER}/: ${describeError(error)}`], generatedFiles};
    }
    const worker = await bundle(editorMain, bundlePath, featureDefines(simulation.target));
    if (!worker.ok) return {ok: false, errors: describeBuildErrors(worker.errors, {folder, entry: manifest.entry ?? DEFAULT_ENTRY_FILE, editorMain}), generatedFiles};
    if (manifest.editorExtensions === undefined) return {ok: true, bundlePath, inputs: worker.inputs, warnings, generatedFiles};
    const extensionsPath = join(directory, EDITOR_EXTENSIONS_BUNDLE_FILE);
    const extensions = await bundleEditorExtensions(folder, resolve(folder, manifest.editorExtensions), extensionsPath);
    return {
        ok: true,
        bundlePath,
        ...(extensions.ok ? {editorExtensionsPath: extensionsPath} : {}),
        inputs: [...worker.inputs, ...extensions.inputs],
        warnings: extensions.warning === undefined ? warnings : [...warnings, extensions.warning],
        generatedFiles,
    };
}
