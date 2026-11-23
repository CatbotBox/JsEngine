import {spawn} from "child_process";
import {randomBytes} from "crypto";
import {existsSync, statSync, watch} from "fs";
import type {FSWatcher} from "fs";
import {copyFile, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile} from "fs/promises";
import {homedir} from "os";
import {basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep} from "path";
import {errorFramesOf} from "../../engine/debugging/errorStack";
import {PROJECT_ENTRY_EXTENSIONS, PROJECT_MANIFEST_FILE, validateProjectManifest} from "../../engine/project/projectManifest";
import type {ProjectManifestValidation} from "../../engine/project/projectManifest";
import {isProjectTarget, PROJECT_TARGETS} from "../../engine/project/projectTargets";
import type {ProjectTarget} from "../../engine/project/projectTargets";
import {EDITOR_EXTENSIONS_BUNDLE_FILE} from "../../editor/project/editorExtensions";
import {createProjectFiles} from "../../editor/project/projectTemplate";
import {projectFileExtension, projectRelativePath} from "../../engine/project/projectPaths";
import {DEFAULT_GAME_TARGET, EDITOR_SETTINGS_FILE, editorSettingsOf, gameTargetProblem, isGameTarget, parseEditorSettings} from "../../editor/project/editorSettings";
import type {EditorSettings, GameTarget} from "../../editor/project/editorSettings";
import {
    EDITOR_SETTINGS_UPDATE_METHOD,
    isBuildSuccess,
    isGenerateProjectReport,
    isTargetFeatureReport,
    PACKAGED_TARGET,
    PROJECT_API_PREFIX,
    PROJECT_EDITOR_EXTENSIONS_COPY_PATH,
    PROJECT_EDITOR_SETTINGS_ROUTE,
    PROJECT_EVENT_BUILD_FAILED,
    PROJECT_EVENT_FILES_CHANGED,
    PROJECT_EVENT_REBUILT,
    PROJECT_GENERATE_ROUTE,
    PROJECT_OPEN_EXTERNALLY_ROUTE,
    PROJECT_PACKAGE_ROUTE,
    PROJECT_SHOW_IN_FOLDER_ROUTE,
    PROJECT_TARGET_REPORT_ROUTE,
    PROJECT_WORKER_FILE,
    projectBuildCopyPath,
} from "../../editor/project/projectServerApi";
import type {
    BrowsedDirectory,
    BrowseResult,
    BuildProjectResult,
    GenerateProjectReport,
    OpenProjectResult,
    PackageResult,
    PickFolderResult,
    ProjectApiError,
    ProjectCapabilities,
    TargetFeatureReport,
    TargetReportResult,
} from "../../editor/project/projectServerApi";
import type {ProjectEntry} from "../../editor/project/projectFileSystem";
import {ServerSentEventChannel} from "./serverSentEvents";
import {ISOLATION_HEADERS} from "./webDistFiles";

export type ExternalOpener = (absolutePath: string) => Promise<void>;

export interface ExternalOpenCommand {
    readonly command: string;
    readonly args: readonly string[];
}

export type BunLocation = {readonly path: string} | {readonly unavailableReason: string};

export interface ToolchainOutput {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number | null;
}

export type ToolchainRunner = (repoRoot: string, bunPath: string, args: readonly string[]) => Promise<ToolchainOutput>;

export interface ProjectServerOptions {
    readonly repoRoot?: string;
    readonly bun: BunLocation;
    readonly pickFolder?: () => Promise<string | null>;
    readonly browse: boolean;
    readonly allowedHostnames?: readonly string[];
    readonly openExternally?: ExternalOpener;
    readonly showInFolder?: ExternalOpener;
    readonly runToolchain?: ToolchainRunner;
}

export type ProjectWorkerBuildReport =
    | {
        readonly ok: true;
        readonly bundlePath: string;
        readonly editorExtensionsPath?: string;
        readonly inputs: readonly string[];
        readonly warnings: readonly string[];
        readonly generatedFiles: readonly string[];
    }
    | {readonly ok: false; readonly errors: readonly string[]; readonly generatedFiles: readonly string[]};

export interface ProjectGenerateRequest {
    readonly repoRoot: string;
    readonly bunPath: string;
    readonly folder: string;
}

export interface ProjectBuildRequest extends ProjectGenerateRequest {
    readonly gameTarget: GameTarget;
}

export interface ProjectTargetRequest extends ProjectGenerateRequest {
    readonly target: ProjectTarget;
}

export type ProjectBuildOutcome = ProjectWorkerBuildReport;

export const LOOPBACK_HOSTNAMES: readonly string[] = ["localhost", "127.0.0.1", "[::1]"];

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_CONFLICT = 409;
const HTTP_INTERNAL_ERROR = 500;
const PROJECT_ID_BYTES = 12;
const DIRECTORY_SIZE = 0;
const CHANGE_DEBOUNCE_MS = 200;
const REBUILD_DEBOUNCE_MS = 250;
const TOOLCHAIN_CLI: readonly string[] = ["src", "toolchain", "cli.ts"];
const EDITOR_BUILD_ARGUMENTS: readonly string[] = ["build", "--target", "editor", "--report", "json"];
const GENERATE_ARGUMENTS: readonly string[] = ["generate", "--report", "json"];
const BUILD_COMMAND = "build";
const PACKAGE_COMMAND = "package";
const TARGET_ARGUMENT = "--target";
const REPORT_JSON_ARGUMENTS: readonly string[] = ["--report", "json"];
const EXIT_SUCCESS = 0;
const LINE_BREAKS = /\r?\n/;
const NOT_FOUND_INDEX = -1;
const PROJECT_ARGUMENT = "--project";
const SIMULATE_ARGUMENT = "--simulate";
const BACKEND_ARGUMENT = "--backend";
const SOURCE_DIRECTORY = "src";
const BUILD_OUTPUT_DIRECTORY = "dist";
const IGNORED_LISTING_DIRECTORIES: ReadonlySet<string> = new Set([".git", "node_modules", ".jsengine"]);
const IGNORED_CHANGE_DIRECTORIES: ReadonlySet<string> = new Set([".git", "node_modules", ".jsengine", "dist"]);
const HIDDEN_DIRECTORY_PREFIXES: readonly string[] = [".", "$"];
const DRIVE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const SCRIPT_CONTENT_TYPE = "text/javascript; charset=utf-8";
const BINARY_CONTENT_TYPE = "application/octet-stream";
const NO_STORE = "no-store";
const RECURSIVE = {recursive: true} as const;
const WATCH_RECURSIVE = {recursive: true} as const;
const WATCH_FLAT = {recursive: false} as const;
const EXCLUSIVE_WRITE = {flag: "wx"} as const;
const EDITOR_ENVIRONMENT_VARIABLES: readonly string[] = ["JSENGINE_EDITOR", "VISUAL", "EDITOR"];
const DEFAULT_OPENER_BY_PLATFORM: Readonly<Partial<Record<NodeJS.Platform, string>>> = {win32: "explorer.exe", darwin: "open"};
const FALLBACK_OPENER = "xdg-open";
const COMMAND_QUOTES = "\"'";
const COMMAND_WHITESPACE = /\s/;
const GAME_TARGET_SETTING = "gameTarget";
const TARGET_FIELD = "target";
const EDITOR_SETTING_KEYS: readonly string[] = [GAME_TARGET_SETTING];
const EDITOR_SETTINGS_INDENT = 2;
const TRAILING_LINE_BREAK = "\n";
const PROJECT_ROOT_PATH = "";
const SHOW_IN_FOLDER_UNAVAILABLE = "this host cannot show files in their folder; that needs the desktop app";

class HttpError extends Error {
    public constructor(public readonly status: number, message: string) {
        super(message);
    }
}

interface OpenProject {
    readonly id: string;
    readonly folder: string;
    readonly events: ServerSentEventChannel;
    readonly pendingChanges: Set<string>;
    readonly folderWatchers: FSWatcher[];
    readonly inputWatchers: Map<string, FSWatcher>;
    version: number;
    bundlePath: string | undefined;
    editorExtensionsPath: string | undefined;
    inputs: ReadonlySet<string>;
    generatedTexts: ReadonlyMap<string, string | undefined>;
    gameTarget: GameTarget | undefined;
    buildChain: Promise<unknown>;
    changeTimer: ReturnType<typeof setTimeout> | undefined;
    rebuildTimer: ReturnType<typeof setTimeout> | undefined;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function json(value: unknown, status = HTTP_OK): Response {
    return new Response(JSON.stringify(value), {status, headers: {...ISOLATION_HEADERS, "Content-Type": JSON_CONTENT_TYPE, "Cache-Control": NO_STORE}});
}

function failure(status: number, message: string, stack?: string): Response {
    const body: ProjectApiError = stack === undefined ? {error: message} : {error: message, stack};
    return json(body, status);
}

export function isInsideDirectory(root: string, path: string): boolean {
    const inside = relative(root, path);
    if (inside === "") return true;
    return !isAbsolute(inside) && inside.split(sep)[0] !== "..";
}

function slashed(path: string): string {
    return path.replace(/\\/g, "/");
}

function byPath(a: ProjectEntry, b: ProjectEntry): number {
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function isCodeFile(path: string): boolean {
    return PROJECT_ENTRY_EXTENSIONS.includes(projectFileExtension(slashed(path)));
}

function isBuildInput(path: string): boolean {
    return isCodeFile(path) || slashed(path) === PROJECT_MANIFEST_FILE;
}

function bunExecutableName(): string {
    return process.platform === "win32" ? "bun.exe" : "bun";
}

export function locateBun(explicitPath?: string): BunLocation {
    if (explicitPath !== undefined && existsSync(explicitPath)) return {path: explicitPath};
    if (process.versions.bun !== undefined) return {path: process.execPath};
    const name = bunExecutableName();
    for (const directory of (process.env.PATH ?? "").split(delimiter)) {
        if (directory.length === 0) continue;
        const candidate = join(directory, name);
        if (existsSync(candidate)) return {path: candidate};
    }
    return {unavailableReason: `bun is not on PATH, and building project code needs it (install it from https://bun.sh)`};
}

function lastJsonLine(text: string): unknown {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    for (let index = lines.length - 1; index >= 0; index--) {
        try {
            return JSON.parse(lines[index]);
        } catch {
            continue;
        }
    }
    return undefined;
}

interface ToolchainRun {
    readonly report: unknown;
    readonly stderr: string;
    readonly exitCode: number | null;
}

function runBuildCommand(request: ProjectBuildRequest): Promise<ToolchainRun> {
    return runToolchainCommand(request.repoRoot, request.bunPath, [
        ...EDITOR_BUILD_ARGUMENTS,
        SIMULATE_ARGUMENT, request.gameTarget.target,
        BACKEND_ARGUMENT, request.gameTarget.backend,
        PROJECT_ARGUMENT, resolve(request.folder),
    ]);
}

async function runToolchainCommand(repoRoot: string, bunPath: string, args: readonly string[]): Promise<ToolchainRun> {
    const {stdout, stderr, exitCode} = await spawnToolchainCommand(repoRoot, bunPath, args);
    return {report: lastJsonLine(stdout), stderr, exitCode};
}

export function spawnToolchainCommand(repoRoot: string, bunPath: string, args: readonly string[]): Promise<ToolchainOutput> {
    const command = [join(repoRoot, ...TOOLCHAIN_CLI), ...args];
    return new Promise((resolveRun, rejectRun) => {
        const child = spawn(bunPath, command, {
            cwd: repoRoot,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => stdout += chunk);
        child.stderr.on("data", (chunk: string) => stderr += chunk);
        child.on("error", rejectRun);
        child.on("close", exitCode => resolveRun({stdout, stderr, exitCode}));
    });
}

function linesOf(text: string): string[] {
    return text.split(LINE_BREAKS).map(line => line.trimEnd()).filter(line => line.trim().length > 0);
}

function isJsonLine(line: string): boolean {
    try {
        JSON.parse(line);
        return true;
    } catch {
        return false;
    }
}

function failedTargetReport(target: ProjectTarget, errors: readonly string[]): TargetFeatureReport {
    return {ok: false, target, bundles: [], errors};
}

function isStringArray(value: unknown): value is readonly string[] {
    return Array.isArray(value) && value.every(item => typeof item === "string");
}

function isBuildReport(value: unknown): value is ProjectWorkerBuildReport {
    if (typeof value !== "object" || value === null) return false;
    const report = value as {ok?: unknown, bundlePath?: unknown, editorExtensionsPath?: unknown, inputs?: unknown, warnings?: unknown, errors?: unknown, generatedFiles?: unknown};
    if (!isStringArray(report.generatedFiles)) return false;
    const extensionsPathValid = report.editorExtensionsPath === undefined || typeof report.editorExtensionsPath === "string";
    const succeeded = report.ok === true && typeof report.bundlePath === "string" && extensionsPathValid && isStringArray(report.inputs) && isStringArray(report.warnings);
    return succeeded || (report.ok === false && isStringArray(report.errors));
}

export async function generateProjectFiles(request: ProjectGenerateRequest): Promise<GenerateProjectReport> {
    let run: ToolchainRun;
    try {
        run = await runToolchainCommand(request.repoRoot, request.bunPath, [...GENERATE_ARGUMENTS, PROJECT_ARGUMENT, resolve(request.folder)]);
    } catch (error) {
        return {ok: false, errors: [`Could not run ${request.bunPath}: ${describeError(error)}`]};
    }
    if (isGenerateProjectReport(run.report)) return run.report;
    const output = run.stderr.trim();
    return {ok: false, errors: [`jsengine generate exited with ${run.exitCode}${output.length > 0 ? `: ${output}` : " and no report"}`]};
}

export async function buildProjectEditorWorker(request: ProjectBuildRequest): Promise<ProjectBuildOutcome> {
    let run: ToolchainRun;
    try {
        run = await runBuildCommand(request);
    } catch (error) {
        return {ok: false, errors: [`Could not run ${request.bunPath}: ${describeError(error)}`], generatedFiles: []};
    }
    if (isBuildReport(run.report)) return run.report.ok ? {...run.report, inputs: run.report.inputs.map(input => resolve(input))} : run.report;
    const output = run.stderr.trim();
    return {ok: false, errors: [`bun build exited with ${run.exitCode}${output.length > 0 ? `: ${output}` : " and no report"}`], generatedFiles: []};
}

export async function checkProjectTarget(request: ProjectTargetRequest, runToolchain: ToolchainRunner = spawnToolchainCommand): Promise<TargetReportResult> {
    const {target} = request;
    let run: ToolchainOutput;
    try {
        run = await runToolchain(request.repoRoot, request.bunPath, [BUILD_COMMAND, TARGET_ARGUMENT, target, ...REPORT_JSON_ARGUMENTS, PROJECT_ARGUMENT, resolve(request.folder)]);
    } catch (error) {
        return {report: failedTargetReport(target, [`Could not run ${request.bunPath}: ${describeError(error)}`]), output: []};
    }
    const stdoutLines = linesOf(run.stdout);
    const reportIndex = stdoutLines.findLastIndex(isJsonLine);
    const report: unknown = reportIndex === NOT_FOUND_INDEX ? undefined : JSON.parse(stdoutLines[reportIndex]);
    const output = stdoutLines.filter((_, index) => index !== reportIndex);
    if (isTargetFeatureReport(report) && report.target === target) return {report, output: [...output, ...linesOf(run.stderr)]};
    const exited = `jsengine build --target ${target} exited with ${run.exitCode}`;
    const stderrLines = linesOf(run.stderr);
    return {report: failedTargetReport(target, stderrLines.length === 0 ? [`${exited} and no report`] : [`${exited}:`, ...stderrLines]), output};
}

export async function packageProjectWindow(request: ProjectGenerateRequest, runToolchain: ToolchainRunner = spawnToolchainCommand): Promise<PackageResult> {
    let run: ToolchainOutput;
    try {
        run = await runToolchain(request.repoRoot, request.bunPath, [PACKAGE_COMMAND, TARGET_ARGUMENT, PACKAGED_TARGET, PROJECT_ARGUMENT, resolve(request.folder)]);
    } catch (error) {
        return {ok: false, output: [`Could not run ${request.bunPath}: ${describeError(error)}`]};
    }
    return {ok: run.exitCode === EXIT_SUCCESS, output: [...linesOf(run.stdout), ...linesOf(run.stderr)]};
}

export function splitCommandLine(text: string): string[] {
    const tokens: string[] = [];
    let token = "";
    let quote: string | undefined;
    let started = false;
    for (const character of text) {
        if (quote !== undefined) {
            if (character === quote) quote = undefined;
            else token += character;
        } else if (COMMAND_QUOTES.includes(character)) {
            quote = character;
            started = true;
        } else if (COMMAND_WHITESPACE.test(character)) {
            if (started) tokens.push(token);
            token = "";
            started = false;
        } else {
            token += character;
            started = true;
        }
    }
    if (started) tokens.push(token);
    return tokens;
}

export function externalOpenCommand(absolutePath: string, environment: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform): ExternalOpenCommand {
    for (const name of EDITOR_ENVIRONMENT_VARIABLES) {
        const [command, ...args] = splitCommandLine(environment[name] ?? "");
        if (command !== undefined && command.length > 0) return {command, args: [...args, absolutePath]};
    }
    return {command: DEFAULT_OPENER_BY_PLATFORM[platform] ?? FALLBACK_OPENER, args: [absolutePath]};
}

export function openWithExternalEditor(absolutePath: string): Promise<void> {
    const {command, args} = externalOpenCommand(absolutePath, process.env, process.platform);
    return new Promise((resolveOpen, rejectOpen) => {
        const child = spawn(command, args, {detached: true, stdio: "ignore"});
        child.once("error", error => rejectOpen(new Error(`could not start ${command} (set JSENGINE_EDITOR to your editor's executable): ${describeError(error)}`)));
        child.once("spawn", () => {
            child.unref();
            resolveOpen();
        });
    });
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

function jsonObjectOf(text: string): {readonly [key: string]: unknown} {
    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        throw new HttpError(HTTP_BAD_REQUEST, "the request body must be JSON");
    }
    if (typeof body !== "object" || body === null) throw new HttpError(HTTP_BAD_REQUEST, "the request body must be a JSON object");
    return body as {readonly [key: string]: unknown};
}

async function jsonBody(request: Request): Promise<{readonly [key: string]: unknown}> {
    return jsonObjectOf(await request.text());
}

async function requestedGameTarget(request: Request): Promise<GameTarget | undefined> {
    const text = await request.text();
    if (text.trim().length === 0) return undefined;
    const gameTarget = jsonObjectOf(text)[GAME_TARGET_SETTING];
    if (gameTarget === undefined) return undefined;
    if (!isGameTarget(gameTarget)) throw new HttpError(HTTP_BAD_REQUEST, gameTargetProblem(gameTarget));
    return gameTarget;
}

function requestedTarget(body: {readonly [key: string]: unknown}): ProjectTarget {
    const target = body[TARGET_FIELD];
    if (!isProjectTarget(target)) throw new HttpError(HTTP_BAD_REQUEST, `"${TARGET_FIELD}" must be one of ${PROJECT_TARGETS.join(", ")}`);
    return target;
}

function requiredString(body: {readonly [key: string]: unknown}, key: string): string {
    const value = body[key];
    if (typeof value !== "string" || value.trim().length === 0) throw new HttpError(HTTP_BAD_REQUEST, `"${key}" must be a non-empty string`);
    return value;
}

function stringField(body: {readonly [key: string]: unknown}, key: string): string {
    const value = body[key];
    if (typeof value !== "string") throw new HttpError(HTTP_BAD_REQUEST, `"${key}" must be a string`);
    return value;
}

function parsedObjectOrEmpty(text: string | undefined): {readonly [key: string]: unknown} {
    if (text === undefined) return {};
    try {
        const parsed = JSON.parse(text) as unknown;
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as {readonly [key: string]: unknown} : {};
    } catch {
        return {};
    }
}

function requireMethod(request: Request, ...methods: readonly string[]): void {
    if (!methods.includes(request.method)) throw new HttpError(HTTP_METHOD_NOT_ALLOWED, `${request.method} is not allowed here; use ${methods.join(" or ")}`);
}

function isHiddenDirectory(name: string): boolean {
    return HIDDEN_DIRECTORY_PREFIXES.some(prefix => name.startsWith(prefix));
}

function browseRoots(): BrowsedDirectory[] {
    const home = homedir();
    const roots: BrowsedDirectory[] = [{name: "Home", path: home}];
    if (process.platform !== "win32") return [...roots, {name: "/", path: "/"}];
    for (const letter of DRIVE_LETTERS) {
        const drive = `${letter}:\\`;
        if (existsSync(drive)) roots.push({name: `${letter}:`, path: drive});
    }
    return roots;
}

export class ProjectServer {
    private readonly projects = new Map<string, OpenProject>();
    private readonly idsByFolder = new Map<string, string>();
    private readonly repoSource: string | undefined;
    private readonly repoBuildOutput: string | undefined;
    private readonly runToolchain: ToolchainRunner;
    private sourceWatcher: FSWatcher | undefined;
    private siteChain: Promise<unknown> = Promise.resolve();

    public constructor(private readonly options: ProjectServerOptions) {
        this.runToolchain = options.runToolchain ?? spawnToolchainCommand;
        this.repoSource = options.repoRoot === undefined ? undefined : join(options.repoRoot, SOURCE_DIRECTORY);
        this.repoBuildOutput = options.repoRoot === undefined ? undefined : join(options.repoRoot, BUILD_OUTPUT_DIRECTORY);
    }

    public handles(url: URL): boolean {
        return url.pathname.startsWith(PROJECT_API_PREFIX);
    }

    public capabilities(): ProjectCapabilities {
        const reason = this.buildUnavailableReason();
        const base = {build: reason === undefined, pickFolder: this.options.pickFolder !== undefined, browse: this.options.browse, showInFolder: this.options.showInFolder !== undefined};
        return reason === undefined ? base : {...base, buildUnavailableReason: reason};
    }

    public bundlePathOf(id: string): string | undefined {
        return this.projects.get(id)?.bundlePath;
    }

    public async handle(request: Request): Promise<Response> {
        try {
            return await this.route(request);
        } catch (error) {
            if (error instanceof HttpError) return failure(error.status, error.message);
            return failure(HTTP_INTERNAL_ERROR, describeError(error), errorFramesOf(error) ?? errorFramesOf(new Error()));
        }
    }

    public close(): void {
        for (const project of this.projects.values()) {
            this.stopWatching(project);
            project.events.close();
        }
        this.sourceWatcher?.close();
        this.sourceWatcher = undefined;
    }

    private buildUnavailableReason(): string | undefined {
        if (this.options.repoRoot === undefined) return "building project code needs the JsEngine source tree; start the editor from the repository";
        const bun = this.options.bun;
        return "path" in bun ? undefined : bun.unavailableReason;
    }

    private allowed(request: Request, url: URL): boolean {
        const hostnames = this.options.allowedHostnames;
        if (hostnames !== undefined && !hostnames.includes(url.hostname)) return false;
        const origin = request.headers.get("origin");
        if (origin !== null && origin !== `${url.protocol}//${url.host}`) return false;
        return request.headers.get("sec-fetch-site") !== "cross-site";
    }

    private async route(request: Request): Promise<Response> {
        const url = new URL(request.url);
        if (!this.handles(url)) throw new HttpError(HTTP_NOT_FOUND, `${url.pathname} is not a project API route`);
        if (!this.allowed(request, url)) throw new HttpError(HTTP_FORBIDDEN, "project API requests must come from the editor page itself");
        const [head, action, ...rest] = url.pathname.slice(PROJECT_API_PREFIX.length).split("/");
        if (action === undefined) return await this.routeGlobal(head, request, url);
        const id = decodeURIComponent(head);
        const project = this.projects.get(id);
        if (project === undefined) throw new HttpError(HTTP_NOT_FOUND, `unknown project id ${id}; open the project again`);
        switch (action) {
            case "files":
                requireMethod(request, "GET");
                return json(await this.listFiles(project));
            case "file":
                return await this.routeFile(project, request, rest.map(decodeURIComponent).join("/"));
            case "rename":
                requireMethod(request, "POST");
                return await this.renamePath(project, await jsonBody(request));
            case "mkdir":
                requireMethod(request, "POST");
                await mkdir(await this.confinedPath(project, requiredString(await jsonBody(request), "path")), RECURSIVE);
                return json({});
            case "build":
                requireMethod(request, "POST");
                return json(await this.build(project, await requestedGameTarget(request)));
            case PROJECT_GENERATE_ROUTE:
                requireMethod(request, "POST");
                return json(await this.generate(project));
            case PROJECT_TARGET_REPORT_ROUTE:
                requireMethod(request, "POST");
                return json(await this.targetReport(project, requestedTarget(await jsonBody(request))));
            case PROJECT_PACKAGE_ROUTE:
                requireMethod(request, "POST");
                return json(await this.packageWindow(project));
            case PROJECT_OPEN_EXTERNALLY_ROUTE:
                requireMethod(request, "POST");
                await this.openExternally(project, requiredString(await jsonBody(request), "path"));
                return json({});
            case PROJECT_SHOW_IN_FOLDER_ROUTE:
                requireMethod(request, "POST");
                await this.showInFolder(project, stringField(await jsonBody(request), "path"));
                return json({});
            case PROJECT_EDITOR_SETTINGS_ROUTE:
                requireMethod(request, "GET", EDITOR_SETTINGS_UPDATE_METHOD);
                if (request.method === "GET") return json(await this.editorSettings(project));
                return json(await this.updateEditorSettings(project, await jsonBody(request)));
            case PROJECT_WORKER_FILE:
                requireMethod(request, "GET");
                return await this.workerBundle(project);
            case EDITOR_EXTENSIONS_BUNDLE_FILE:
                requireMethod(request, "GET");
                return await this.editorExtensionsBundle(project);
            case "events":
                requireMethod(request, "GET");
                return project.events.respond(request, ISOLATION_HEADERS);
            default:
                throw new HttpError(HTTP_NOT_FOUND, `unknown project route ${action}`);
        }
    }

    private async routeGlobal(route: string, request: Request, url: URL): Promise<Response> {
        switch (route) {
            case "capabilities":
                requireMethod(request, "GET");
                return json(this.capabilities());
            case "pick-folder": {
                requireMethod(request, "POST");
                const pick = this.options.pickFolder;
                if (pick === undefined) throw new HttpError(HTTP_NOT_FOUND, "this host has no native folder picker");
                const result: PickFolderResult = {path: await pick()};
                return json(result);
            }
            case "browse":
                requireMethod(request, "GET");
                if (!this.options.browse) throw new HttpError(HTTP_NOT_FOUND, "this host does not offer folder browsing");
                return json(await this.browse(url.searchParams.get("path")));
            case "open":
                requireMethod(request, "POST");
                return json(await this.open(requiredString(await jsonBody(request), "path")));
            case "create": {
                requireMethod(request, "POST");
                const body = await jsonBody(request);
                return json(await this.create(requiredString(body, "path"), requiredString(body, "name")));
            }
            default:
                throw new HttpError(HTTP_NOT_FOUND, `unknown project route ${route}`);
        }
    }

    private async routeFile(project: OpenProject, request: Request, path: string): Promise<Response> {
        requireMethod(request, "GET", "PUT", "DELETE");
        const absolute = await this.confinedPath(project, path);
        switch (request.method) {
            case "GET": {
                const info = await stat(absolute).catch(() => undefined);
                if (info === undefined || !info.isFile()) throw new HttpError(HTTP_NOT_FOUND, `${path} is not a file in the project`);
                return new Response(new Uint8Array(await readFile(absolute)), {
                    headers: {...ISOLATION_HEADERS, "Content-Type": BINARY_CONTENT_TYPE, "Cache-Control": NO_STORE},
                });
            }
            case "PUT":
                await mkdir(dirname(absolute), RECURSIVE);
                await writeFile(absolute, new Uint8Array(await request.arrayBuffer()));
                return json({});
            default:
                if (!await pathExists(absolute)) throw new HttpError(HTTP_NOT_FOUND, `${path} does not exist in the project`);
                await rm(absolute, RECURSIVE);
                return json({});
        }
    }

    private async renamePath(project: OpenProject, body: {readonly [key: string]: unknown}): Promise<Response> {
        const from = await this.confinedPath(project, requiredString(body, "from"));
        const to = await this.confinedPath(project, requiredString(body, "to"));
        if (!await pathExists(from)) throw new HttpError(HTTP_NOT_FOUND, `${String(body.from)} does not exist in the project`);
        if (await pathExists(to)) throw new HttpError(HTTP_CONFLICT, `${String(body.to)} already exists`);
        if (isInsideDirectory(from, to)) throw new HttpError(HTTP_BAD_REQUEST, `cannot move ${String(body.from)} into itself`);
        await mkdir(dirname(to), RECURSIVE);
        await rename(from, to);
        return json({});
    }

    private async openExternally(project: OpenProject, path: string): Promise<void> {
        const absolute = await this.confinedPath(project, path);
        const info = await stat(absolute).catch(() => undefined);
        if (info === undefined || !info.isFile()) throw new HttpError(HTTP_NOT_FOUND, `${path} is not a file in the project`);
        await (this.options.openExternally ?? openWithExternalEditor)(absolute);
    }

    private async showInFolder(project: OpenProject, path: string): Promise<void> {
        const show = this.options.showInFolder;
        if (show === undefined) throw new HttpError(HTTP_NOT_FOUND, SHOW_IN_FOLDER_UNAVAILABLE);
        const absolute = path === PROJECT_ROOT_PATH ? project.folder : await this.confinedPath(project, path);
        if (!await pathExists(absolute)) throw new HttpError(HTTP_NOT_FOUND, `${path} does not exist in the project`);
        await show(absolute);
    }

    private async editorSettingsText(project: OpenProject): Promise<string | undefined> {
        return await readFile(await this.confinedPath(project, EDITOR_SETTINGS_FILE), "utf8").catch(() => undefined);
    }

    private async editorSettings(project: OpenProject): Promise<EditorSettings> {
        return parseEditorSettings(await this.editorSettingsText(project));
    }

    private async updateEditorSettings(project: OpenProject, body: {readonly [key: string]: unknown}): Promise<EditorSettings> {
        const unknown = Object.keys(body).find(key => !EDITOR_SETTING_KEYS.includes(key));
        if (unknown !== undefined) throw new HttpError(HTTP_BAD_REQUEST, `"${unknown}" is not an editor setting; the settings are ${EDITOR_SETTING_KEYS.join(", ")}`);
        const gameTarget = body[GAME_TARGET_SETTING];
        if (gameTarget !== undefined && !isGameTarget(gameTarget)) throw new HttpError(HTTP_BAD_REQUEST, gameTargetProblem(gameTarget));
        const merged = {...parsedObjectOrEmpty(await this.editorSettingsText(project)), ...body};
        const path = await this.confinedPath(project, EDITOR_SETTINGS_FILE);
        await mkdir(dirname(path), RECURSIVE);
        await writeFile(path, JSON.stringify(merged, null, EDITOR_SETTINGS_INDENT) + TRAILING_LINE_BREAK);
        return editorSettingsOf(merged);
    }

    private async confinedPath(project: OpenProject, path: string): Promise<string> {
        const inside = projectRelativePath(path);
        if (inside === undefined) throw new HttpError(HTTP_BAD_REQUEST, `${JSON.stringify(path)} is not a path inside the project folder`);
        const absolute = resolve(project.folder, ...inside.split("/"));
        if (!isInsideDirectory(project.folder, absolute)) throw new HttpError(HTTP_BAD_REQUEST, `${path} leaves the project folder`);
        let existing = absolute;
        while (!await pathExists(existing) && isInsideDirectory(project.folder, dirname(existing)) && dirname(existing) !== existing) existing = dirname(existing);
        if (!isInsideDirectory(project.folder, await realpath(existing))) throw new HttpError(HTTP_FORBIDDEN, `${path} leaves the project folder through a link`);
        return absolute;
    }

    private async listFiles(project: OpenProject): Promise<ProjectEntry[]> {
        const entries: ProjectEntry[] = [];
        const walk = async (directory: string, prefix: string): Promise<void> => {
            for (const child of await readdir(directory, {withFileTypes: true})) {
                if (child.isSymbolicLink()) continue;
                const path = prefix.length === 0 ? child.name : `${prefix}/${child.name}`;
                const absolute = join(directory, child.name);
                if (child.isDirectory()) {
                    if (IGNORED_LISTING_DIRECTORIES.has(child.name)) continue;
                    const info = await stat(absolute);
                    entries.push({path, kind: "directory", size: DIRECTORY_SIZE, mtimeMs: info.mtimeMs});
                    await walk(absolute, path);
                } else if (child.isFile()) {
                    const info = await stat(absolute);
                    entries.push({path, kind: "file", size: info.size, mtimeMs: info.mtimeMs});
                }
            }
        };
        await walk(project.folder, "");
        return entries.sort(byPath);
    }

    private async browse(requested: string | null): Promise<BrowseResult> {
        const path = requested === null || requested.trim().length === 0 ? homedir() : resolve(requested);
        const info = await stat(path).catch(() => undefined);
        if (info === undefined || !info.isDirectory()) throw new HttpError(HTTP_NOT_FOUND, `${path} is not a folder`);
        let children;
        try {
            children = await readdir(path, {withFileTypes: true});
        } catch (error) {
            throw new HttpError(HTTP_FORBIDDEN, `cannot read ${path}: ${describeError(error)}`);
        }
        const directories = children
            .filter(child => child.isDirectory() && !isHiddenDirectory(child.name))
            .map(child => ({name: child.name, path: join(path, child.name)}))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: "base"}));
        const parent = dirname(path);
        return {path, parent: parent === path ? null : parent, directories, roots: browseRoots()};
    }

    private async folderOf(path: string): Promise<string> {
        const base = this.options.repoRoot ?? process.cwd();
        const absolute = resolve(base, path);
        const info = await stat(absolute).catch(() => undefined);
        if (info === undefined || !info.isDirectory()) throw new HttpError(HTTP_NOT_FOUND, `${absolute} is not a folder`);
        return await realpath(absolute);
    }

    private projectFor(folder: string): OpenProject {
        const key = process.platform === "win32" ? folder.toLowerCase() : folder;
        const known = this.idsByFolder.get(key);
        if (known !== undefined) return this.projects.get(known)!;
        const id = randomBytes(PROJECT_ID_BYTES).toString("hex");
        const project: OpenProject = {
            id,
            folder,
            events: new ServerSentEventChannel({
                onFirstSubscriber: () => this.startWatching(project),
                onLastUnsubscribed: () => this.stopWatching(project),
            }),
            pendingChanges: new Set(),
            folderWatchers: [],
            inputWatchers: new Map(),
            version: 0,
            bundlePath: undefined,
            editorExtensionsPath: undefined,
            inputs: new Set(),
            generatedTexts: new Map(),
            gameTarget: undefined,
            buildChain: Promise.resolve(),
            changeTimer: undefined,
            rebuildTimer: undefined,
        };
        this.projects.set(id, project);
        this.idsByFolder.set(key, id);
        return project;
    }

    private async validate(project: OpenProject): Promise<ProjectManifestValidation> {
        const text = await readFile(join(project.folder, PROJECT_MANIFEST_FILE), "utf8").catch(() => undefined);
        return validateProjectManifest(text, path => {
            const absolute = resolve(project.folder, path);
            if (!isInsideDirectory(project.folder, absolute)) return false;
            try {
                return statSync(absolute).isFile();
            } catch {
                return false;
            }
        });
    }

    private async open(path: string): Promise<OpenProjectResult> {
        const project = this.projectFor(await this.folderOf(path));
        return {id: project.id, path: project.folder, validation: await this.validate(project)};
    }

    private async create(path: string, name: string): Promise<OpenProjectResult> {
        const base = this.options.repoRoot ?? process.cwd();
        const folder = resolve(base, path);
        await mkdir(folder, RECURSIVE);
        const files = createProjectFiles(name);
        const existing = files.filter(file => existsSync(join(folder, ...file.path.split("/")))).map(file => file.path);
        if (existing.length > 0) throw new HttpError(HTTP_CONFLICT, `refusing to overwrite ${existing.join(", ")} in ${folder}`);
        for (const file of files) {
            const target = join(folder, ...file.path.split("/"));
            await mkdir(dirname(target), RECURSIVE);
            await writeFile(target, file.contents, EXCLUSIVE_WRITE);
        }
        return await this.open(folder);
    }

    private build(project: OpenProject, requested?: GameTarget): Promise<BuildProjectResult> {
        if (requested !== undefined) project.gameTarget = requested;
        const chosen = project.gameTarget;
        const run = project.buildChain.then(() => this.runBuild(project, chosen));
        project.buildChain = run.catch(() => undefined);
        return run;
    }

    private generate(project: OpenProject): Promise<GenerateProjectReport> {
        const run = project.buildChain.then(() => this.runGenerate(project));
        project.buildChain = run.catch(() => undefined);
        return run;
    }

    private async runGenerate(project: OpenProject): Promise<GenerateProjectReport> {
        const repoRoot = this.options.repoRoot;
        const bun = this.options.bun;
        const unavailable = this.buildUnavailableReason();
        if (unavailable !== undefined || repoRoot === undefined || !("path" in bun)) return {ok: false, errors: [unavailable ?? "generating is unavailable"]};
        return await generateProjectFiles({repoRoot, bunPath: bun.path, folder: project.folder});
    }

    private onSiteChain<T>(work: () => Promise<T>): Promise<T> {
        const run = this.siteChain.then(work);
        this.siteChain = run.catch(() => undefined);
        return run;
    }

    private targetReport(project: OpenProject, target: ProjectTarget): Promise<TargetReportResult> {
        return this.onSiteChain(async () => {
            const repoRoot = this.options.repoRoot;
            const bun = this.options.bun;
            const unavailable = this.buildUnavailableReason();
            if (unavailable !== undefined || repoRoot === undefined || !("path" in bun)) return {report: failedTargetReport(target, [unavailable ?? "building is unavailable"]), output: []};
            return await checkProjectTarget({repoRoot, bunPath: bun.path, folder: project.folder, target}, this.runToolchain);
        });
    }

    private packageWindow(project: OpenProject): Promise<PackageResult> {
        return this.onSiteChain(async () => {
            const repoRoot = this.options.repoRoot;
            const bun = this.options.bun;
            const unavailable = this.buildUnavailableReason();
            if (unavailable !== undefined || repoRoot === undefined || !("path" in bun)) return {ok: false, output: [unavailable ?? "packaging is unavailable"]};
            return await packageProjectWindow({repoRoot, bunPath: bun.path, folder: project.folder}, this.runToolchain);
        });
    }

    private async rememberedGameTarget(project: OpenProject): Promise<GameTarget> {
        project.gameTarget ??= (await this.editorSettings(project)).gameTarget ?? DEFAULT_GAME_TARGET;
        return project.gameTarget;
    }

    private async runBuild(project: OpenProject, chosen: GameTarget | undefined): Promise<BuildProjectResult> {
        const repoRoot = this.options.repoRoot;
        const bun = this.options.bun;
        const unavailable = this.buildUnavailableReason();
        if (unavailable !== undefined || repoRoot === undefined || !("path" in bun)) return {errors: [unavailable ?? "building is unavailable"]};
        const validation = await this.validate(project);
        if (!validation.ok) return {errors: validation.problems};
        const gameTarget = chosen ?? await this.rememberedGameTarget(project);
        const outcome = await buildProjectEditorWorker({repoRoot, bunPath: bun.path, folder: project.folder, gameTarget});
        project.generatedTexts = await this.readGeneratedFiles(project, outcome.generatedFiles);
        if (!outcome.ok) return {errors: outcome.errors};
        project.bundlePath = outcome.bundlePath;
        project.editorExtensionsPath = outcome.editorExtensionsPath;
        project.inputs = new Set(outcome.inputs.map(input => this.pathKey(input)));
        project.version++;
        await this.copyBundleIntoProject(project, outcome.bundlePath, projectBuildCopyPath(gameTarget));
        await this.copyEditorExtensionsIntoProject(project, outcome.editorExtensionsPath);
        if (project.events.subscriberCount > 0) this.watchInputs(project, outcome.inputs);
        const projectRoute = `${PROJECT_API_PREFIX}${encodeURIComponent(project.id)}`;
        const version = `?v=${project.version}`;
        const editorExtensionsUrl = outcome.editorExtensionsPath === undefined ? {} : {editorExtensionsUrl: `${projectRoute}/${EDITOR_EXTENSIONS_BUNDLE_FILE}${version}`};
        return {workerUrl: `${projectRoute}/${PROJECT_WORKER_FILE}${version}`, gameTarget, ...editorExtensionsUrl, warnings: outcome.warnings};
    }

    private async copyBundleIntoProject(project: OpenProject, bundlePath: string, copyPath: string): Promise<void> {
        const target = join(project.folder, ...copyPath.split("/"));
        try {
            await mkdir(dirname(target), RECURSIVE);
            await copyFile(bundlePath, target);
        } catch (error) {
            console.warn(`Could not copy ${basename(bundlePath)} into ${target}: ${describeError(error)}`);
        }
    }

    private async copyEditorExtensionsIntoProject(project: OpenProject, bundlePath: string | undefined): Promise<void> {
        if (bundlePath !== undefined) {
            await this.copyBundleIntoProject(project, bundlePath, PROJECT_EDITOR_EXTENSIONS_COPY_PATH);
            return;
        }
        const stale = join(project.folder, ...PROJECT_EDITOR_EXTENSIONS_COPY_PATH.split("/"));
        try {
            await rm(stale, {force: true});
        } catch (error) {
            console.warn(`Could not remove the stale ${stale}: ${describeError(error)}`);
        }
    }

    private async workerBundle(project: OpenProject): Promise<Response> {
        const bundle = project.bundlePath;
        if (bundle === undefined || !await pathExists(bundle)) throw new HttpError(HTTP_NOT_FOUND, "this project has not been built yet; POST build first");
        return new Response(new Uint8Array(await readFile(bundle)), {
            headers: {...ISOLATION_HEADERS, "Content-Type": SCRIPT_CONTENT_TYPE, "Cache-Control": NO_STORE},
        });
    }

    private async editorExtensionsBundle(project: OpenProject): Promise<Response> {
        const bundle = project.editorExtensionsPath;
        if (bundle === undefined || !await pathExists(bundle)) {
            throw new HttpError(HTTP_NOT_FOUND, `this project has no editor extensions bundle: name a module in "editorExtensions" in ${PROJECT_MANIFEST_FILE} and build it`);
        }
        return new Response(new Uint8Array(await readFile(bundle)), {
            headers: {...ISOLATION_HEADERS, "Content-Type": SCRIPT_CONTENT_TYPE, "Cache-Control": NO_STORE},
        });
    }

    private pathKey(path: string): string {
        const absolute = resolve(path);
        return process.platform === "win32" ? absolute.toLowerCase() : absolute;
    }

    private startWatching(project: OpenProject): void {
        try {
            const watcher = watch(project.folder, WATCH_RECURSIVE, (_event, filename) => {
                if (filename !== null) this.projectFileChanged(project, String(filename));
            });
            watcher.on("error", error => console.warn(`Stopped watching ${project.folder}: ${describeError(error)}`));
            project.folderWatchers.push(watcher);
        } catch (error) {
            console.warn(`Could not watch ${project.folder}: ${describeError(error)}`);
        }
        this.ensureSourceWatcher();
        this.watchInputs(project, [...project.inputs]);
    }

    private stopWatching(project: OpenProject): void {
        for (const watcher of project.folderWatchers.splice(0)) watcher.close();
        for (const watcher of project.inputWatchers.values()) watcher.close();
        project.inputWatchers.clear();
        if (project.changeTimer !== undefined) clearTimeout(project.changeTimer);
        if (project.rebuildTimer !== undefined) clearTimeout(project.rebuildTimer);
        project.changeTimer = undefined;
        project.rebuildTimer = undefined;
        project.pendingChanges.clear();
        if ([...this.projects.values()].every(each => each.events.subscriberCount === 0)) {
            this.sourceWatcher?.close();
            this.sourceWatcher = undefined;
        }
    }

    private ensureSourceWatcher(): void {
        const source = this.repoSource;
        if (this.sourceWatcher !== undefined || source === undefined || !existsSync(source)) return;
        try {
            this.sourceWatcher = watch(source, WATCH_RECURSIVE, (_event, filename) => {
                if (filename === null || !isCodeFile(String(filename))) return;
                const changed = this.pathKey(join(source, String(filename)));
                for (const project of this.projects.values()) {
                    if (project.events.subscriberCount > 0 && project.bundlePath !== undefined && project.inputs.has(changed)) this.scheduleRebuild(project);
                }
            });
            this.sourceWatcher.on("error", error => console.warn(`Stopped watching ${source}: ${describeError(error)}`));
        } catch (error) {
            console.warn(`Could not watch ${source}: ${describeError(error)}`);
        }
    }

    private watchInputs(project: OpenProject, inputs: readonly string[]): void {
        const outside = (directory: string) => !isInsideDirectory(project.folder, directory)
            && (this.repoSource === undefined || !isInsideDirectory(this.repoSource, directory))
            && (this.repoBuildOutput === undefined || !isInsideDirectory(this.repoBuildOutput, directory))
            && !directory.split(sep).includes("node_modules");
        const wanted = new Set(inputs.map(input => dirname(resolve(input))).filter(outside));
        for (const [directory, watcher] of [...project.inputWatchers]) {
            if (wanted.has(directory)) continue;
            watcher.close();
            project.inputWatchers.delete(directory);
        }
        for (const directory of wanted) {
            if (project.inputWatchers.has(directory) || !existsSync(directory)) continue;
            try {
                const watcher = watch(directory, WATCH_FLAT, (_event, filename) => {
                    if (filename === null) return;
                    const changed = this.pathKey(join(directory, String(filename)));
                    if (project.bundlePath !== undefined && project.inputs.has(changed)) this.scheduleRebuild(project);
                });
                watcher.on("error", () => watcher.close());
                project.inputWatchers.set(directory, watcher);
            } catch (error) {
                console.warn(`Could not watch ${directory}: ${describeError(error)}`);
            }
        }
    }

    private projectFileChanged(project: OpenProject, filename: string): void {
        const path = slashed(filename);
        if (IGNORED_CHANGE_DIRECTORIES.has(path.split("/")[0])) return;
        project.pendingChanges.add(path);
        if (project.changeTimer !== undefined) clearTimeout(project.changeTimer);
        project.changeTimer = setTimeout(() => {
            project.changeTimer = undefined;
            const paths = [...project.pendingChanges].sort();
            project.pendingChanges.clear();
            project.events.send(PROJECT_EVENT_FILES_CHANGED, {paths});
            const codePaths = paths.filter(isBuildInput);
            if (project.bundlePath !== undefined && codePaths.length > 0) void this.rebuildForCodeChanges(project, codePaths);
        }, CHANGE_DEBOUNCE_MS);
    }

    private async rebuildForCodeChanges(project: OpenProject, paths: readonly string[]): Promise<void> {
        const onlyGeneratedFiles = paths.every(path => project.generatedTexts.has(path));
        if (onlyGeneratedFiles && await this.generatedFilesAsLastBuilt(project, paths)) return;
        this.scheduleRebuild(project);
    }

    private async readGeneratedFiles(project: OpenProject, paths: readonly string[]): Promise<Map<string, string | undefined>> {
        const texts = await Promise.all(paths.map(path => readFile(join(project.folder, path), "utf8").catch(() => undefined)));
        return new Map(paths.map((path, index) => [path, texts[index]]));
    }

    private async generatedFilesAsLastBuilt(project: OpenProject, paths: readonly string[]): Promise<boolean> {
        await project.buildChain;
        const current = await this.readGeneratedFiles(project, paths);
        return paths.every(path => current.get(path) === project.generatedTexts.get(path));
    }

    private scheduleRebuild(project: OpenProject): void {
        if (project.rebuildTimer !== undefined) clearTimeout(project.rebuildTimer);
        project.rebuildTimer = setTimeout(() => {
            project.rebuildTimer = undefined;
            void this.build(project).then(result => {
                if (isBuildSuccess(result)) project.events.send(PROJECT_EVENT_REBUILT, result);
                else project.events.send(PROJECT_EVENT_BUILD_FAILED, {errors: result.errors});
            }, error => project.events.send(PROJECT_EVENT_BUILD_FAILED, {errors: [describeError(error)]}));
        }, REBUILD_DEBOUNCE_MS);
    }
}

export function createProjectServer(options: ProjectServerOptions): ProjectServer {
    return new ProjectServer(options);
}
