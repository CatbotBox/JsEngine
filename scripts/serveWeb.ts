import {existsSync} from "fs";
import {join, relative, resolve} from "path";
import {contentTypeOf, distFileFor, ISOLATION_HEADERS, pageFromArgumentsOrUndefined} from "./webDistFiles";

const ROOT = resolve(__dirname, "..");
const PROD = process.argv.includes("--prod");
const BUILD = !process.argv.includes("--no-build");
const DIST = join(ROOT, "dist", PROD ? "web-prod" : "web");
const DEFAULT_PORT = 8080;
const PORT = Number(process.env.PORT ?? DEFAULT_PORT);
const HTTP_NOT_FOUND = 404;
const ISOLATED = !process.argv.includes("--no-coi");
const HEADERS: Readonly<Record<string, string>> = ISOLATED ? ISOLATION_HEADERS : {};
const PAGE_TO_OPEN = pageFromArgumentsOrUndefined();

function browserOpenCommand(url: string): string[] {
    if (process.platform === "win32") return ["cmd", "/c", "start", "", url];
    if (process.platform === "darwin") return ["open", url];
    return ["xdg-open", url];
}

function build(): void {
    const result = Bun.spawnSync([process.execPath, join(ROOT, "scripts", "buildWeb.ts"), ...(PROD ? ["--prod"] : [])], {
        stdio: ["inherit", "inherit", "inherit"],
    });
    if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
}

function respond(request: Request): Response {
    const path = distFileFor(DIST, new URL(request.url).pathname);
    if (path === undefined) return new Response("Not found", {status: HTTP_NOT_FOUND, headers: HEADERS});
    return new Response(Bun.file(path), {headers: {...HEADERS, "Content-Type": contentTypeOf(path)}});
}

if (BUILD) build();
if (!existsSync(DIST)) {
    console.error(`${DIST} does not exist; build it first (drop --no-build)`);
    process.exit(1);
}
Bun.serve({port: PORT, fetch: respond});
const site = relative(ROOT, DIST).replace(/\\/g, "/");
const siteUrl = `http://localhost:${PORT}/`;
console.log(`serving ${site} at ${siteUrl} ${ISOLATED ? "(cross-origin isolated)" : "(--no-coi: isolated only through the coi-serviceworker, else single-threaded)"}`);
if (PAGE_TO_OPEN !== undefined) Bun.spawn(browserOpenCommand(siteUrl + PAGE_TO_OPEN));
