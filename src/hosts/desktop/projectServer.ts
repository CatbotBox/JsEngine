import {spawn} from "child_process";
import {createHash, randomBytes} from "crypto";
import {existsSync, statSync, watch} from "fs";
import type {FSWatcher} from "fs";
import {copyFile, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile} from "fs/promises";
import {homedir} from "os";
import {delimiter, dirname, isAbsolute, join, relative, resolve, sep} from "path";
import {createProjectFiles, PROJECT_ENTRY_EXTENSIONS, PROJECT_MANIFEST_FILE, validateProjectManifest} from "../../editor/project/projectManifest";
import type {ProjectManifestValidation} from "../../editor/project/projectManifest";
import {PROJECT_ENTRY_EXPORTS} from "../../editor/project/projectEntry";
import {projectFileExtension, projectRelativePath} from "../../editor/project/projectPaths";
import {
    isBuildSuccess,
    PROJECT_API_PREFIX,
    PROJECT_BUILD_COPY_PATH,
    PROJECT_EVENT_BUILD_FAILED,
    PROJECT_EVENT_FILES_CHANGED,
    PROJECT_EVENT_REBUILT,
    PROJECT_WORKER_FILE,
} from "../../editor/project/projectServerApi";
import type {
    BrowsedDirectory,
    BrowseResult,
    BuildProjectResult,
    OpenProjectResult,
    PickFolderResult,
    ProjectCapabilities,
} from "../../editor/project/projectServerApi";
import type {ProjectEntry} from "../../editor/project/projectFileSystem";
import {ServerSentEventChannel} from "./serverSentEvents";
import {ISOLATION_HEADERS} from "./webDistFiles";

export type BunLocation = {readonly path: string} | {readonly unavailableReason: string};

export interface ProjectServerOptions {
    readonly repoRoot?: string;
    readonly bun: BunLocation;
    readonly pickFolder?: () => Promise<string | null>;
    readonly browse: boolean;
    readonly allowedHostnames?: readonly string[];
}

export interface ProjectWorkerBuildError {
    readonly message: string;
    readonly file?: string;
    readonly line?: number;
    readonly column?: number;
}

export type ProjectWorkerBuildReport =
    | {readonly ok: true; readonly inputs: readonly string[]}
    | {readonly ok: false; readonly errors: readonly ProjectWorkerBuildError[]};

export interface ProjectBuildRequest {
    readonly repoRoot: string;
    readonly bunPath: string;
    readonly folder: string;
    readonly entry: string;
}

export type ProjectBuildOutcome =
    | {readonly ok: true; readonly bundlePath: string; readonly inputs: readonly string[]}
    | {readonly ok: false; readonly errors: readonly string[]};

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
const FOLDER_HASH_HEX_DIGITS = 16;
const CHANGE_DEBOUNCE_MS = 200;
const REBUILD_DEBOUNCE_MS = 250;
const EDITOR_PROJECTS_DIRECTORY: readonly string[] = ["dist", "editor-projects"];
const GENERATED_ENTRY_FILE = "editorWorkerEntry.ts";
const BUNDLE_FILE = "editor.worker.js";
const BUILD_SCRIPT: readonly string[] = ["scripts", "buildProjectWorker.ts"];
const WORKER_TEMPLATE: readonly string[] = ["src", "editor", "launch", "projectEditorWorker.ts"];
const SOURCE_DIRECTORY = "src";
const BUILD_OUTPUT_DIRECTORY = "dist";
const IGNORED_LISTING_DIRECTORIES: ReadonlySet<string> = new Set([".git", "node_modules", ".jsengine"]);
const IGNORED_CHANGE_DIRECTORIES: ReadonlySet<string> = new Set([".git", "node_modules", ".jsengine", "dist"]);
const HIDDEN_DIRECTORY_PREFIXES: readonly string[] = [".", "$"];
const DRIVE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MISSING_EXPORT = /No matching export in "(.+?)" for import "(.+?)"/;
const DRIVE_PATH = /[A-Za-z]:[\\/]/;
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const SCRIPT_CONTENT_TYPE = "text/javascript; charset=utf-8";
const BINARY_CONTENT_TYPE = "application/octet-stream";
const NO_STORE = "no-store";
const RECURSIVE = {recursive: true} as const;
const WATCH_RECURSIVE = {recursive: true} as const;
const WATCH_FLAT = {recursive: false} as const;
const EXCLUSIVE_WRITE = {flag: "wx"} as const;

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
    inputs: ReadonlySet<string>;
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

function failure(status: number, message: string): Response {
    return json({error: message}, status);
}

function samePath(a: string, b: string): boolean {
    const left = resolve(a);
    const right = resolve(b);
    return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
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

export function projectBuildDirectory(repoRoot: string, folder: string): string {
    const key = process.platform === "win32" ? resolve(folder).toLowerCase() : resolve(folder);
    const hash = createHash("sha1").update(key).digest("hex").slice(0, FOLDER_HASH_HEX_DIGITS);
    return join(repoRoot, ...EDITOR_PROJECTS_DIRECTORY, hash);
}

function generatedEntrySource(repoRoot: string, entryPath: string): string {
    const template = slashed(join(repoRoot, ...WORKER_TEMPLATE));
    const exportsList = PROJECT_ENTRY_EXPORTS.join(", ");
    return [
        `import {${exportsList}} from ${JSON.stringify(slashed(entryPath))};`,
        `import {runProjectEditorWorker} from ${JSON.stringify(template)};`,
        ``,
        `runProjectEditorWorker({${exportsList}});`,
        ``,
    ].join("\n");
}

function absoluteMessagePath(repoRoot: string, path: string): string {
    const drive = DRIVE_PATH.exec(path);
    return drive === null ? resolve(repoRoot, path) : resolve(path.slice(drive.index));
}

function displayPath(path: string, folder: string, repoRoot: string): string {
    if (isInsideDirectory(folder, path)) return slashed(relative(folder, path));
    if (isInsideDirectory(repoRoot, path)) return slashed(relative(repoRoot, path));
    return slashed(path);
}

export function describeBuildErrors(errors: readonly ProjectWorkerBuildError[], request: ProjectBuildRequest, generatedEntry: string): string[] {
    const entryPath = resolve(request.folder, request.entry);
    const described = errors.map(error => {
        const missing = MISSING_EXPORT.exec(error.message);
        if (missing !== null) {
            const exporter = absoluteMessagePath(request.repoRoot, missing[1]);
            const importer = error.file === undefined ? undefined : resolve(error.file);
            const fromGeneratedEntry = importer !== undefined && samePath(importer, generatedEntry);
            if (samePath(exporter, entryPath) || (fromGeneratedEntry && (PROJECT_ENTRY_EXPORTS as readonly string[]).includes(missing[2]))) {
                return `entry ${slashed(request.entry)} does not export ${missing[2]}`;
            }
        }
        if (error.file === undefined) return error.message;
        return `${displayPath(error.file, request.folder, request.repoRoot)}:${error.line ?? 0}:${error.column ?? 0}: ${error.message}`;
    });
    return described.length > 0 ? described : ["bun build failed without reporting an error"];
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

function runBuildScript(request: ProjectBuildRequest, generatedEntry: string, bundlePath: string): Promise<{readonly report: unknown, readonly stderr: string, readonly exitCode: number | null}> {
    return new Promise((resolveRun, rejectRun) => {
        const child = spawn(request.bunPath, [join(request.repoRoot, ...BUILD_SCRIPT), generatedEntry, bundlePath], {
            cwd: request.repoRoot,
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
        child.on("close", exitCode => resolveRun({report: lastJsonLine(stdout), stderr, exitCode}));
    });
}

function isBuildReport(value: unknown): value is ProjectWorkerBuildReport {
    if (typeof value !== "object" || value === null) return false;
    const report = value as {ok?: unknown, inputs?: unknown, errors?: unknown};
    return (report.ok === true && Array.isArray(report.inputs)) || (report.ok === false && Array.isArray(report.errors));
}

export async function buildProjectEditorWorker(request: ProjectBuildRequest): Promise<ProjectBuildOutcome> {
    const directory = projectBuildDirectory(request.repoRoot, request.folder);
    await mkdir(directory, RECURSIVE);
    const generatedEntry = join(directory, GENERATED_ENTRY_FILE);
    const bundlePath = join(directory, BUNDLE_FILE);
    const source = generatedEntrySource(request.repoRoot, resolve(request.folder, request.entry));
    if (await readFile(generatedEntry, "utf8").catch(() => undefined) !== source) await writeFile(generatedEntry, source);
    let run: Awaited<ReturnType<typeof runBuildScript>>;
    try {
        run = await runBuildScript(request, generatedEntry, bundlePath);
    } catch (error) {
        return {ok: false, errors: [`Could not run ${request.bunPath}: ${describeError(error)}`]};
    }
    if (!isBuildReport(run.report)) {
        const output = run.stderr.trim();
        return {ok: false, errors: [`bun build exited with ${run.exitCode}${output.length > 0 ? `: ${output}` : " and no report"}`]};
    }
    if (!run.report.ok) return {ok: false, errors: describeBuildErrors(run.report.errors, request, generatedEntry)};
    return {ok: true, bundlePath, inputs: run.report.inputs.map(input => resolve(input))};
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

async function jsonBody(request: Request): Promise<{readonly [key: string]: unknown}> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        throw new HttpError(HTTP_BAD_REQUEST, "the request body must be JSON");
    }
    if (typeof body !== "object" || body === null) throw new HttpError(HTTP_BAD_REQUEST, "the request body must be a JSON object");
    return body as {readonly [key: string]: unknown};
}

function requiredString(body: {readonly [key: string]: unknown}, key: string): string {
    const value = body[key];
    if (typeof value !== "string" || value.trim().length === 0) throw new HttpError(HTTP_BAD_REQUEST, `"${key}" must be a non-empty string`);
    return value;
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
    private sourceWatcher: FSWatcher | undefined;

    public constructor(private readonly options: ProjectServerOptions) {
        this.repoSource = options.repoRoot === undefined ? undefined : join(options.repoRoot, SOURCE_DIRECTORY);
        this.repoBuildOutput = options.repoRoot === undefined ? undefined : join(options.repoRoot, BUILD_OUTPUT_DIRECTORY);
    }

    public handles(url: URL): boolean {
        return url.pathname.startsWith(PROJECT_API_PREFIX);
    }

    public capabilities(): ProjectCapabilities {
        const reason = this.buildUnavailableReason();
        const base = {build: reason === undefined, pickFolder: this.options.pickFolder !== undefined, browse: this.options.browse};
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
            return failure(HTTP_INTERNAL_ERROR, describeError(error));
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
                return json(await this.build(project));
            case PROJECT_WORKER_FILE:
                requireMethod(request, "GET");
                return await this.workerBundle(project);
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
            inputs: new Set(),
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

    private build(project: OpenProject): Promise<BuildProjectResult> {
        const run = project.buildChain.then(() => this.runBuild(project));
        project.buildChain = run.catch(() => undefined);
        return run;
    }

    private async runBuild(project: OpenProject): Promise<BuildProjectResult> {
        const repoRoot = this.options.repoRoot;
        const bun = this.options.bun;
        const unavailable = this.buildUnavailableReason();
        if (unavailable !== undefined || repoRoot === undefined || !("path" in bun)) return {errors: [unavailable ?? "building is unavailable"]};
        const validation = await this.validate(project);
        if (!validation.ok) return {errors: validation.problems};
        const outcome = await buildProjectEditorWorker({repoRoot, bunPath: bun.path, folder: project.folder, entry: validation.manifest.entry});
        if (!outcome.ok) return {errors: outcome.errors};
        project.bundlePath = outcome.bundlePath;
        project.inputs = new Set(outcome.inputs.map(input => this.pathKey(input)));
        project.version++;
        await this.copyBundleIntoProject(project, outcome.bundlePath);
        if (project.events.subscriberCount > 0) this.watchInputs(project, outcome.inputs);
        return {workerUrl: `${PROJECT_API_PREFIX}${encodeURIComponent(project.id)}/${PROJECT_WORKER_FILE}?v=${project.version}`};
    }

    private async copyBundleIntoProject(project: OpenProject, bundlePath: string): Promise<void> {
        const target = join(project.folder, ...PROJECT_BUILD_COPY_PATH.split("/"));
        try {
            await mkdir(dirname(target), RECURSIVE);
            await copyFile(bundlePath, target);
        } catch (error) {
            console.warn(`Could not copy the editor worker into ${target}: ${describeError(error)}`);
        }
    }

    private async workerBundle(project: OpenProject): Promise<Response> {
        const bundle = project.bundlePath;
        if (bundle === undefined || !await pathExists(bundle)) throw new HttpError(HTTP_NOT_FOUND, "this project has not been built yet; POST build first");
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
            if (project.bundlePath !== undefined && paths.some(isCodeFile)) this.scheduleRebuild(project);
        }, CHANGE_DEBOUNCE_MS);
    }

    private scheduleRebuild(project: OpenProject): void {
        if (project.rebuildTimer !== undefined) clearTimeout(project.rebuildTimer);
        project.rebuildTimer = setTimeout(() => {
            project.rebuildTimer = undefined;
            void this.build(project).then(result => {
                if (isBuildSuccess(result)) project.events.send(PROJECT_EVENT_REBUILT, {workerUrl: result.workerUrl});
                else project.events.send(PROJECT_EVENT_BUILD_FAILED, {errors: result.errors});
            }, error => project.events.send(PROJECT_EVENT_BUILD_FAILED, {errors: [describeError(error)]}));
        }, REBUILD_DEBOUNCE_MS);
    }
}

export function createProjectServer(options: ProjectServerOptions): ProjectServer {
    return new ProjectServer(options);
}
