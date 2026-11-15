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

export const QUERY_OR_FRAGMENT = /[?#]/;

export function distFileFor(distDirectory: string, urlPath: string): string | undefined {
    const [pathOnly] = urlPath.split(QUERY_OR_FRAGMENT, 1);
    const decoded = decodeURIComponent(pathOnly);
    const path = resolve(distDirectory, "." + (decoded.endsWith("/") ? decoded + "index.html" : decoded));
    const inside = relative(distDirectory, path);
    if (inside.startsWith("..") || isAbsolute(inside)) return undefined;
    return existsSync(path) && statSync(path).isFile() ? path : undefined;
}
