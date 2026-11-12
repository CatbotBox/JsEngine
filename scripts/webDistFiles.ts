import {existsSync, statSync} from "fs";
import {extname, isAbsolute, relative, resolve} from "path";

export const ISOLATION_HEADERS: Readonly<Record<string, string>> = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
};

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

export function contentTypeOf(path: string): string {
    return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export function distFileFor(distDirectory: string, urlPath: string): string | undefined {
    const decoded = decodeURIComponent(urlPath);
    const path = resolve(distDirectory, "." + (decoded.endsWith("/") ? decoded + "index.html" : decoded));
    const inside = relative(distDirectory, path);
    if (inside.startsWith("..") || isAbsolute(inside)) return undefined;
    return existsSync(path) && statSync(path).isFile() ? path : undefined;
}

const PAGES: Readonly<Record<string, string>> = {"2d": "2d.html", "3d": "3d.html"};

export function pageFromArgumentsOrUndefined(): string | undefined {
    const pageName = process.argv.slice(2).find(arg => !arg.startsWith("--"));
    if (pageName === undefined) return undefined;
    const page = PAGES[pageName];
    if (page === undefined) {
        console.error(`unknown page "${pageName}", expected one of: ${Object.keys(PAGES).join(", ")}`);
        process.exit(1);
    }
    return page;
}

export function pageFromArguments(fallback: string): string {
    return pageFromArgumentsOrUndefined() ?? PAGES[fallback];
}
