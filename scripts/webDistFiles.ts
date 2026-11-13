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

const QUERY_OR_FRAGMENT = /[?#]/;

export function distFileFor(distDirectory: string, urlPath: string): string | undefined {
    const [pathOnly] = urlPath.split(QUERY_OR_FRAGMENT, 1);
    const decoded = decodeURIComponent(pathOnly);
    const path = resolve(distDirectory, "." + (decoded.endsWith("/") ? decoded + "index.html" : decoded));
    const inside = relative(distDirectory, path);
    if (inside.startsWith("..") || isAbsolute(inside)) return undefined;
    return existsSync(path) && statSync(path).isFile() ? path : undefined;
}

const PAGES: Readonly<Record<string, string>> = {
    "2d": "2d.html",
    "3d": "3d.html",
    "2d-pixels": "2d.html?backend=pixels",
    "3d-pixels": "3d.html?backend=pixels",
    "swarm": "swarm.html",
    "swarm-pixels": "swarm.html?backend=pixels",
    "editor-2d": "editor.html?game=2d",
    "editor-3d": "editor.html?game=3d",
};

const EDITOR_SITE_FILE_PREFIX = "editor";
const SITE_PATH_SEPARATOR = /[\\/]/;

export function isEditorSiteFile(sitePath: string): boolean {
    const [pathOnly] = sitePath.split(QUERY_OR_FRAGMENT, 1);
    const parts = pathOnly.split(SITE_PATH_SEPARATOR).filter(part => part.length > 0);
    return parts.length === 1 && parts[0].startsWith(EDITOR_SITE_FILE_PREFIX);
}

export function pageNameFromArgumentsOrUndefined(): string | undefined {
    const pageName = process.argv.slice(2).find(arg => !arg.startsWith("--"));
    if (pageName === undefined) return undefined;
    if (PAGES[pageName] === undefined) {
        console.error(`unknown page "${pageName}", expected one of: ${Object.keys(PAGES).join(", ")}`);
        process.exit(1);
    }
    return pageName;
}

export function sitePathOfPage(pageName: string): string {
    return PAGES[pageName];
}

export function pageFromArgumentsOrUndefined(): string | undefined {
    const pageName = pageNameFromArgumentsOrUndefined();
    return pageName === undefined ? undefined : PAGES[pageName];
}

export function pageFromArguments(fallback: string): string {
    return pageFromArgumentsOrUndefined() ?? PAGES[fallback];
}
