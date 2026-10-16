/**
 * Builds web/ (scripts/buildWeb.ts) and serves web/dist, cross-origin isolated from the start so
 * SharedArrayBuffer (threaded raster, Increment 3.3) needs no hosting change.
 *
 * Run: bun scripts/serveWeb.ts   (PORT overrides the default 8080)
 *      bun scripts/serveWeb.ts --no-coi   drops COOP/COEP, so pages are not cross-origin isolated
 *      and the world runs its raster single-threaded: the fallback a plain static host gets.
 */
import {join, resolve} from "path";
import {contentTypeOf, distFileFor, ISOLATION_HEADERS} from "./webDistFiles";

const ROOT = resolve(__dirname, "..");
const DIST = join(ROOT, "web", "dist");
const PORT = Number(process.env.PORT ?? 8080);
const ISOLATED = !process.argv.includes("--no-coi");
const HEADERS: Readonly<Record<string, string>> = ISOLATED ? ISOLATION_HEADERS : {};

function build(): void {
    const result = Bun.spawnSync([process.execPath, join(ROOT, "scripts", "buildWeb.ts")], {
        stdio: ["inherit", "inherit", "inherit"],
    });
    if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
}

function respond(request: Request): Response {
    const path = distFileFor(DIST, new URL(request.url).pathname);
    if (path === undefined) return new Response("Not found", {status: 404, headers: HEADERS});
    return new Response(Bun.file(path), {headers: {...HEADERS, "Content-Type": contentTypeOf(path)}});
}

build();
Bun.serve({port: PORT, fetch: respond});
console.log(`serving web/dist at http://localhost:${PORT}/ ${ISOLATED ? "(cross-origin isolated)" : "(--no-coi: not isolated, raster single-threaded)"}`);
