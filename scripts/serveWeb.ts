/**
 * Builds web/ (scripts/buildWeb.ts) and serves web/dist, cross-origin isolated from the start so
 * SharedArrayBuffer (threaded raster, Increment 3.3) needs no hosting change.
 *
 * Run: bun scripts/serveWeb.ts   (PORT overrides the default 8080)
 *      bun scripts/serveWeb.ts --no-coi   drops COOP/COEP, so pages are not cross-origin isolated
 *      and the world runs its raster single-threaded: the fallback a plain static host gets.
 */
import {existsSync, statSync} from "fs";
import {extname, isAbsolute, join, relative, resolve} from "path";

const ROOT = resolve(__dirname, "..");
const DIST = join(ROOT, "web", "dist");
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
    const result = Bun.spawnSync([process.execPath, join(ROOT, "scripts", "buildWeb.ts")], {
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

build();
Bun.serve({port: PORT, fetch: respond});
console.log(`serving web/dist at http://localhost:${PORT}/ ${ISOLATED ? "(cross-origin isolated)" : "(--no-coi: not isolated, raster single-threaded)"}`);
