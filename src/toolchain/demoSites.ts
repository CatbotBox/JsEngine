import {join, resolve} from "path";
import type {RenderBackendKind} from "../engine/rendering/renderBackend";
import {BACKEND_QUERY_PARAMETER, PIXEL_SCALE_QUERY_PARAMETER} from "../hosts/web/worldWorkerProtocol";
import {usageError} from "./cliArguments";
import {displayPath} from "./project";
import {REPO_ROOT} from "./repoPaths";

export interface DemoSite {
    readonly project: string;
    readonly page: string;
    readonly title: string;
}

export const DEMO_SITES: readonly DemoSite[] = [
    {project: "demo/2d", page: "2d.html", title: "JsEngine 2D"},
    {project: "demo/3d", page: "3d.html", title: "JsEngine 3D"},
    {project: "demo/swarm", page: "swarm.html", title: "JsEngine Swarm"},
];

const PROJECT_QUERY_PARAMETER = "project";

function folderKey(folder: string): string {
    const absolute = resolve(folder);
    return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

export function demoSiteFolder(site: DemoSite): string {
    return join(REPO_ROOT, ...site.project.split("/"));
}

export function demoSiteOf(projectFolder: string): DemoSite {
    const key = folderKey(projectFolder);
    const site = DEMO_SITES.find(candidate => folderKey(demoSiteFolder(candidate)) === key);
    if (site !== undefined) return site;
    throw usageError(`${displayPath(projectFolder)} has no web page; the web and window targets run ${DEMO_SITES.map(each => each.project).join(", ")}`);
}

export function demoSitePath(site: DemoSite, backend: RenderBackendKind, pixelScale?: number): string {
    const scale = pixelScale === undefined ? "" : `&${PIXEL_SCALE_QUERY_PARAMETER}=${pixelScale}`;
    return `${site.page}?${BACKEND_QUERY_PARAMETER}=${backend}${scale}`;
}

export function withProjectQuery(sitePath: string, projectPath: string | undefined): string {
    if (projectPath === undefined) return sitePath;
    const separator = sitePath.includes("?") ? "&" : "?";
    return `${sitePath}${separator}${PROJECT_QUERY_PARAMETER}=${encodeURIComponent(projectPath)}`;
}
