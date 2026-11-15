import {QUERY_OR_FRAGMENT} from "../src/hosts/desktop";

export {contentTypeOf, distFileFor, ISOLATION_HEADERS} from "../src/hosts/desktop";

const PAGES: Readonly<Record<string, string>> = {
    "2d": "2d.html",
    "3d": "3d.html",
    "2d-pixels": "2d.html?backend=pixels",
    "3d-pixels": "3d.html?backend=pixels",
    "3d-gpu": "3d.html?backend=gpu",
    "swarm": "swarm.html?backend=cells",
    "swarm-pixels": "swarm.html",
    "editor": "editor.html",
    "editor-gpu": "editor.html?backend=gpu",
};

const PROJECT_FLAG_PREFIX = "--project=";
const PROJECT_QUERY_PARAMETER = "project";

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

export function projectFromArgumentsOrUndefined(): string | undefined {
    return process.argv.slice(2).find(arg => arg.startsWith(PROJECT_FLAG_PREFIX))?.slice(PROJECT_FLAG_PREFIX.length);
}

function withProjectQuery(sitePath: string): string {
    const project = projectFromArgumentsOrUndefined();
    if (project === undefined) return sitePath;
    const separator = sitePath.includes("?") ? "&" : "?";
    return `${sitePath}${separator}${PROJECT_QUERY_PARAMETER}=${encodeURIComponent(project)}`;
}

export function pageFromArgumentsOrUndefined(): string | undefined {
    const pageName = pageNameFromArgumentsOrUndefined();
    return pageName === undefined ? undefined : withProjectQuery(PAGES[pageName]);
}

export function pageFromArguments(fallback: string): string {
    return pageFromArgumentsOrUndefined() ?? withProjectQuery(PAGES[fallback]);
}
