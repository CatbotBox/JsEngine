import {existsSync, watch} from "fs";
import {join, relative, resolve} from "path";
import {createProjectServer, LOOPBACK_HOSTNAMES, locateBun, ServerSentEventChannel} from "../src/hosts/desktop";
import {DEV_EVENTS_PATH, DEV_RELOAD_EVENT} from "../src/hosts/web/devReload";
import {contentTypeOf, distFileFor, ISOLATION_HEADERS, pageFromArgumentsOrUndefined} from "./webDistFiles";

const ROOT = resolve(__dirname, "..");
const PROD = process.argv.includes("--prod");
const DEV = !PROD;
const BUILD = !process.argv.includes("--no-build");
const DIST = join(ROOT, "dist", PROD ? "web-prod" : "web");
const DEFAULT_PORT = 8080;
const PORT = Number(process.env.PORT ?? DEFAULT_PORT);
const HTTP_NOT_FOUND = 404;
const ISOLATED = !process.argv.includes("--no-coi");
const HEADERS: Readonly<Record<string, string>> = ISOLATED ? ISOLATION_HEADERS : {};
const PAGE_TO_OPEN = pageFromArgumentsOrUndefined();
const DEV_LOOPBACK_ADDRESSES: readonly string[] = ["127.0.0.1", "::1"];
const ALL_INTERFACES = "0.0.0.0";
const MAX_IDLE_TIMEOUT_SECONDS = 255;
const WATCHED_DIRECTORIES: readonly string[] = ["src", "demo"];
const REBUILD_DEBOUNCE_MS = 300;
const IGNORED_CHANGE_MARKERS: readonly string[] = [".jsengine", "node_modules", ".scene.json", ".prefab.json", "jsengine.project.json"];
const REBUILT_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".js", ".mjs", ".html", ".css", ".obj", ".mtl", ".png", ".jpg", ".jpeg", ".ppm"];
const WATCH_RECURSIVE = {recursive: true} as const;

function browserOpenCommand(url: string): string[] {
    if (process.platform === "win32") return ["cmd", "/c", "start", "", url];
    if (process.platform === "darwin") return ["open", url];
    return ["xdg-open", url];
}

function buildArguments(): string[] {
    return [process.execPath, join(ROOT, "scripts", "buildWeb.ts"), ...(PROD ? ["--prod"] : [])];
}

function build(): void {
    const result = Bun.spawnSync(buildArguments(), {stdio: ["inherit", "inherit", "inherit"]});
    if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
}

const projectServer = DEV
    ? createProjectServer({repoRoot: ROOT, bun: locateBun(), browse: true, allowedHostnames: LOOPBACK_HOSTNAMES})
    : undefined;
const devEvents = DEV ? new ServerSentEventChannel() : undefined;

async function respond(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (projectServer !== undefined && projectServer.handles(url)) return await projectServer.handle(request);
    if (devEvents !== undefined && url.pathname === DEV_EVENTS_PATH) return devEvents.respond(request, HEADERS);
    const path = distFileFor(DIST, url.pathname);
    if (path === undefined) return new Response("Not found", {status: HTTP_NOT_FOUND, headers: HEADERS});
    return new Response(Bun.file(path), {headers: {...HEADERS, "Content-Type": contentTypeOf(path)}});
}

function isIgnoredChange(filename: string): boolean {
    const lower = filename.toLowerCase();
    return IGNORED_CHANGE_MARKERS.some(marker => lower.includes(marker)) || !REBUILT_EXTENSIONS.some(extension => lower.endsWith(extension));
}

function watchAndRebuild(events: ServerSentEventChannel): void {
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
        const child = Bun.spawn(buildArguments(), {stdout: "pipe", stderr: "pipe"});
        const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        building = false;
        if (exitCode === 0) {
            console.log(`rebuilt ${relative(ROOT, DIST).replace(/\\/g, "/")} in ${Math.round(performance.now() - started)} ms; reloading ${events.subscriberCount} page(s)`);
            events.send(DEV_RELOAD_EVENT, {});
        } else {
            console.error(`dev rebuild failed (exit ${exitCode}):\n${stdout}${stderr}`);
        }
        if (buildAgain) {
            buildAgain = false;
            void rebuild();
        }
    };
    for (const directory of WATCHED_DIRECTORIES) {
        const watched = join(ROOT, directory);
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

function serveOn(hostname: string): boolean {
    try {
        Bun.serve({port: PORT, hostname, idleTimeout: MAX_IDLE_TIMEOUT_SECONDS, fetch: respond});
        return true;
    } catch (error) {
        console.warn(`could not listen on ${hostname} port ${PORT}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

if (BUILD) build();
if (!existsSync(DIST)) {
    console.error(`${DIST} does not exist; build it first (drop --no-build)`);
    process.exit(1);
}
const boundAddresses = (DEV ? DEV_LOOPBACK_ADDRESSES : [ALL_INTERFACES]).filter(serveOn);
if (boundAddresses.length === 0) process.exit(1);
if (devEvents !== undefined) watchAndRebuild(devEvents);
const site = relative(ROOT, DIST).replace(/\\/g, "/");
const siteUrl = `http://localhost:${PORT}/`;
console.log(`serving ${site} at ${siteUrl} ${ISOLATED ? "(cross-origin isolated)" : "(--no-coi: isolated only through the coi-serviceworker, else single-threaded)"}`);
if (DEV) console.log(`dev: bound to ${boundAddresses.join(" and ")}; watching ${WATCHED_DIRECTORIES.join(", ")} to rebuild and reload game pages; editor at ${siteUrl}editor.html`);
if (PAGE_TO_OPEN !== undefined) Bun.spawn(browserOpenCommand(siteUrl + PAGE_TO_OPEN));
