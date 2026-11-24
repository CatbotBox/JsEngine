import {existsSync} from "fs";
import {join, resolve} from "path";
import type {RenderBackendKind} from "../engine/rendering/renderBackend";
import {SAMPLE_PROJECTS} from "../editor/project/sampleProjects";
import {BACKEND_QUERY_PARAMETER, PIXEL_SCALE_QUERY_PARAMETER} from "../hosts/web/worldWorkerProtocol";
import {CliError} from "./cliArguments";
import {projectSlug} from "./projectLayout";
import {REPO_ROOT, repoRelative} from "./repoPaths";

const PROJECT_QUERY_PARAMETER = "project";
const SAMPLE_PATH_SEPARATOR = "/";
const SITE_FOLDER_SEPARATOR = "/";

export function sampleProjectPaths(): string[] {
    return SAMPLE_PROJECTS.map(sample => sample.path);
}

export function sampleProjectFolders(): string[] {
    return sampleProjectPaths().map(path => join(REPO_ROOT, ...path.split(SAMPLE_PATH_SEPARATOR)));
}

export function siteProjectFolders(project: string | undefined): string[] {
    return project === undefined ? sampleProjectFolders() : [resolve(project)];
}

function projectSiteFolder(projectFolder: string): string {
    return projectSlug(projectFolder) + SITE_FOLDER_SEPARATOR;
}

export function builtProjectSite(dist: string, projectFolder: string): string {
    const site = join(dist, projectSlug(projectFolder));
    if (!existsSync(site)) throw new CliError(`${repoRelative(site)} does not exist; build the project first (drop --no-build)`);
    return site;
}

export function projectPagePath(projectFolder: string, backend: RenderBackendKind, pixelScale?: number): string {
    const scale = pixelScale === undefined ? "" : `&${PIXEL_SCALE_QUERY_PARAMETER}=${pixelScale}`;
    return `${projectSiteFolder(projectFolder)}?${BACKEND_QUERY_PARAMETER}=${backend}${scale}`;
}

export function withProjectQuery(sitePath: string, projectPath: string | undefined): string {
    if (projectPath === undefined) return sitePath;
    const separator = sitePath.includes("?") ? "&" : "?";
    return `${sitePath}${separator}${PROJECT_QUERY_PARAMETER}=${encodeURIComponent(projectPath)}`;
}
