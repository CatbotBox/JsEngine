import {join, relative, resolve} from "path";

export const REPO_ROOT = resolve(__dirname, "..", "..");
export const SOURCE_ROOT = join(REPO_ROOT, "src");
export const CLI_ENTRY = join(SOURCE_ROOT, "toolchain", "cli.ts");
export const WEB_DIST = join(REPO_ROOT, "dist", "web");
export const WEB_PROD_DIST = join(REPO_ROOT, "dist", "web-prod");
export const WINDOW_DIST = join(REPO_ROOT, "dist", "desktop");
export const EDITOR_PROJECTS_DIST = join(REPO_ROOT, "dist", "editor-projects");
export const RELEASE_DIRECTORY = join(REPO_ROOT, "release");

const BACKSLASHES = /\\/g;

export function slashed(path: string): string {
    return path.replace(BACKSLASHES, "/");
}

export function repoRelative(path: string): string {
    return slashed(relative(REPO_ROOT, path));
}

export function webDistOf(prod: boolean): string {
    return prod ? WEB_PROD_DIST : WEB_DIST;
}
