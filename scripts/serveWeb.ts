/**
 * Builds web/ (scripts/buildWeb.ts) and serves the site, cross-origin isolated from the start so
 * SharedArrayBuffer (threaded raster, Increment 3.3) needs no hosting change.
 *
 * Run: bun scripts/serveWeb.ts   (PORT overrides the default 8080)
 *      bun scripts/serveWeb.ts --prod   builds and serves the production site, web/dist-prod
 *      bun scripts/serveWeb.ts --no-build   serves what the last build left
 *      bun scripts/serveWeb.ts --no-coi   drops COOP/COEP, as a plain static host would: the pages
 *      then rely on the coi-serviceworker (isolated after one reload), or run single-threaded.
 */
import {existsSync, statSync} from "fs";
import {extname, isAbsolute, join, relative, resolve} from "path";

const ROOT = resolve(__dirname, "..");
const PROD = process.argv.includes("--prod");
const BUILD = !process.argv.includes("--no-build");
const DIST = join(ROOT, "web", PROD ? "dist-prod" : "dist");
const PORT = Number(process.env.PORT ?? 8080);
const ISOLATED = !process.argv.includes("--no-coi");

const ISOLATION_HEADERS: Readonly<Record<string, string>> = ISOLATED ? {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
} : {};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".obj": "text/plain; charset=utf-8",
    ".mtl": "text/plain; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ppm": "image/x-portable-pixmap",
    ".meshcache": "application/octet-stream",
};

function build(): void {
    const result = Bun.spawnSync([process.execPath, join(ROOT, "scripts", "buildWeb.ts"), ...(PROD ? ["--prod"] : [])], {
        stdio: ["inherit", "inherit", "inherit"],
    });
    if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
}

function fileFor(pathname: string): string | undefined {
    const decoded = decodeURIComponent(pathname);
    const path = resolve(DIST, "." + (decoded.endsWith("/") ? decoded + "index.html" : decoded));
    const inside = relative(DIST, path);
    if (inside.startsWith("..") || isAbsolute(inside)) return undefined;
    return existsSync(path) && statSync(path).isFile() ? path : undefined;
}

function respond(request: Request): Response {
    const path = fileFor(new URL(request.url).pathname);
    if (path === undefined) return new Response("Not found", {status: 404, headers: ISOLATION_HEADERS});
    return new Response(Bun.file(path), {
        headers: {
            ...ISOLATION_HEADERS,
            "Content-Type": CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
        },
    });
}

if (BUILD) build();
if (!existsSync(DIST)) {
    console.error(`${DIST} does not exist; build it first (drop --no-build)`);
    process.exit(1);
}
Bun.serve({port: PORT, fetch: respond});
const site = relative(ROOT, DIST).replace(/\\/g, "/");
console.log(`serving ${site} at http://localhost:${PORT}/ ${ISOLATED ? "(cross-origin isolated)" : "(--no-coi: isolated only through the coi-serviceworker, else single-threaded)"}`);
