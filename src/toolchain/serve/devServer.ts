import {existsSync, watch} from "fs";
import {join} from "path";
import {contentTypeOf, createProjectServer, distFileFor, ISOLATION_HEADERS, LOOPBACK_HOSTNAMES, locateBun, ServerSentEventChannel} from "../../hosts/desktop";
import {DEV_EVENTS_PATH, DEV_RELOAD_EVENT} from "../../hosts/web/devReload";
import {CliError} from "../cliArguments";
import {isWebProjectDataFile} from "../build/webDistFiles";
import {isInside} from "../generate/projectSources";
import {GENERATED_FOLDER} from "../projectLayout";
import {builtProjectSite} from "../projectSites";
import {CLI_ENTRY, REPO_ROOT, repoRelative, slashed, webDistOf} from "../repoPaths";

export interface DevServerOptions {
    readonly prod: boolean;
    readonly build: boolean;
    readonly isolated: boolean;
    readonly open?: string;
    readonly project?: string;
}

const DEFAULT_PORT = 8080;
const HTTP_NOT_FOUND = 404;
const HTTP_FOUND = 302;
const DEV_LOOPBACK_ADDRESSES: readonly string[] = ["127.0.0.1", "::1"];
const ALL_INTERFACES = "0.0.0.0";
const MAX_IDLE_TIMEOUT_SECONDS = 255;
const WATCHED_REPO_DIRECTORIES: readonly string[] = ["src", "demo"];
const REBUILD_DEBOUNCE_MS = 300;
const IGNORED_CHANGE_MARKERS: readonly string[] = [".jsengine", "node_modules"];
const IGNORED_CHANGE_FOLDERS: readonly string[] = [GENERATED_FOLDER];
const PATH_SEPARATOR = "/";
const REBUILT_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".js", ".mjs", ".html", ".css", ".obj", ".mtl", ".png", ".jpg", ".jpeg", ".ppm"];
const WATCH_RECURSIVE = {recursive: true} as const;
const WEB_BUILD_ARGUMENTS: readonly string[] = ["build", "--target", "web"];
const PROD_FLAG = "--prod";
const PROJECT_FLAG = "--project";

function browserOpenCommand(url: string): string[] {
    if (process.platform === "win32") return ["cmd", "/c", "start", "", url];
    if (process.platform === "darwin") return ["open", url];
    return ["xdg-open", url];
}

function buildArguments(prod: boolean, project: string | undefined): string[] {
    return [process.execPath, CLI_ENTRY, ...WEB_BUILD_ARGUMENTS, ...(prod ? [PROD_FLAG] : []), ...(project === undefined ? [] : [PROJECT_FLAG, project])];
}

function watchedDirectories(project: string | undefined): string[] {
    const repoDirectories = WATCHED_REPO_DIRECTORIES.map(directory => join(REPO_ROOT, directory));
    if (project === undefined || repoDirectories.some(directory => isInside(directory, project))) return repoDirectories;
    return [...repoDirectories, project];
}

function watchedLabel(directory: string): string {
    return isInside(REPO_ROOT, directory) ? repoRelative(directory) : slashed(directory);
}

function folderPageLocation(dist: string, url: URL): string | undefined {
    if (url.pathname.endsWith(PATH_SEPARATOR)) return undefined;
    const folder = url.pathname + PATH_SEPARATOR;
    return distFileFor(dist, folder) === undefined ? undefined : folder + url.search;
}

function isIgnoredChange(filename: string): boolean {
    const lower = slashed(filename).toLowerCase();
    if (IGNORED_CHANGE_MARKERS.some(marker => lower.includes(marker))) return true;
    const folders = lower.split(PATH_SEPARATOR).slice(0, -1);
    if (folders.some(folder => IGNORED_CHANGE_FOLDERS.includes(folder))) return true;
    return !REBUILT_EXTENSIONS.some(extension => lower.endsWith(extension)) && !isWebProjectDataFile(lower);
}

function watchAndRebuild(events: ServerSentEventChannel, prod: boolean, dist: string, project: string | undefined): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let building = false;
    let buildAgain = false;
    const rebuild = async (): Promise<void> => {
        if (building) {
            buildAgain = true;
            return;
        }
        building = true;
        const started = performance.now();
        const child = Bun.spawn(buildArguments(prod, project), {cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe"});
        const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        building = false;
        if (exitCode === 0) {
            console.log(`rebuilt ${repoRelative(dist)} in ${Math.round(performance.now() - started)} ms; reloading ${events.subscriberCount} page(s)`);
            events.send(DEV_RELOAD_EVENT, {});
        } else {
            console.error(`dev rebuild failed (exit ${exitCode}):\n${stdout}${stderr}`);
        }
        if (buildAgain) {
            buildAgain = false;
            void rebuild();
        }
    };
    for (const watched of watchedDirectories(project)) {
        if (!existsSync(watched)) continue;
        watch(watched, WATCH_RECURSIVE, (_event, filename) => {
            if (filename === null || isIgnoredChange(String(filename))) return;
            if (timer !== undefined) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = undefined;
                void rebuild();
            }, REBUILD_DEBOUNCE_MS);
        });
    }
}

export function serveSite(options: DevServerOptions): void {
    const dev = !options.prod;
    const dist = webDistOf(options.prod);
    const port = Number(process.env.PORT ?? DEFAULT_PORT);
    const headers: Readonly<Record<string, string>> = options.isolated ? ISOLATION_HEADERS : {};
    if (options.build) {
        const result = Bun.spawnSync(buildArguments(options.prod, options.project), {cwd: REPO_ROOT, stdio: ["inherit", "inherit", "inherit"]});
        if (result.exitCode !== 0) throw new CliError(`the web build failed (exit ${result.exitCode}); fix the errors above`);
    }
    if (!existsSync(dist)) throw new CliError(`${dist} does not exist; build it first (drop --no-build)`);
    if (options.project !== undefined) builtProjectSite(dist, options.project);

    const projectServer = dev
        ? createProjectServer({repoRoot: REPO_ROOT, bun: locateBun(), browse: true, allowedHostnames: LOOPBACK_HOSTNAMES})
        : undefined;
    const devEvents = dev ? new ServerSentEventChannel() : undefined;
    const respond = async (request: Request): Promise<Response> => {
        const url = new URL(request.url);
        if (projectServer !== undefined && projectServer.handles(url)) return await projectServer.handle(request);
        if (devEvents !== undefined && url.pathname === DEV_EVENTS_PATH) return devEvents.respond(request, headers);
        const path = distFileFor(dist, url.pathname);
        if (path === undefined) {
            const folderPage = folderPageLocation(dist, url);
            if (folderPage !== undefined) return new Response(null, {status: HTTP_FOUND, headers: {...headers, Location: folderPage}});
            return new Response("Not found", {status: HTTP_NOT_FOUND, headers});
        }
        return new Response(Bun.file(path), {headers: {...headers, "Content-Type": contentTypeOf(path)}});
    };
    const serveOn = (hostname: string): boolean => {
        try {
            Bun.serve({port, hostname, idleTimeout: MAX_IDLE_TIMEOUT_SECONDS, fetch: respond});
            return true;
        } catch (error) {
            console.warn(`could not listen on ${hostname} port ${port}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    };

    const boundAddresses = (dev ? DEV_LOOPBACK_ADDRESSES : [ALL_INTERFACES]).filter(serveOn);
    if (boundAddresses.length === 0) throw new CliError(`nothing could listen on port ${port}; free it or set PORT to another one`);
    if (devEvents !== undefined) watchAndRebuild(devEvents, options.prod, dist, options.project);
    const siteUrl = `http://localhost:${port}/`;
    console.log(`serving ${repoRelative(dist)} at ${siteUrl} ${options.isolated ? "(cross-origin isolated)" : "(--no-coi: isolated only through the coi-serviceworker, else single-threaded)"}`);
    if (dev) console.log(`dev: bound to ${boundAddresses.join(" and ")}; watching ${watchedDirectories(options.project).map(watchedLabel).join(", ")} to rebuild and reload game pages; editor at ${siteUrl}editor.html`);
    if (options.open !== undefined) Bun.spawn(browserOpenCommand(siteUrl + options.open));
}
