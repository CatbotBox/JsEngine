import {relative} from "path";
import {DATA_ASSET_FILE_SUFFIX} from "../../engine/scene/dataAssetDocument";
import {DEV_DATA_ASSETS_EVENT, DEV_RELOAD_EVENT} from "../../hosts/web/devReload";
import type {DevDataAssetsChange} from "../../hosts/web/devReload";
import {isInside} from "../generate/projectSources";
import {projectSlug} from "../projectLayout";
import {sampleProjectFolders} from "../projectSites";
import {slashed} from "../repoPaths";

export type DevChange =
    | {readonly kind: "dataAssets", readonly sitePaths: readonly string[]}
    | {readonly kind: "code"};

const CODE_CHANGE: DevChange = {kind: "code"};
const SITE_SEPARATOR = "/";

function isDataAssetFile(path: string): boolean {
    return path.toLowerCase().endsWith(DATA_ASSET_FILE_SUFFIX);
}

function sitePathOf(file: string, projectFolders: readonly string[]): string | undefined {
    const folder = projectFolders.find(candidate => isInside(candidate, file));
    if (folder === undefined) return undefined;
    return SITE_SEPARATOR + projectSlug(folder) + SITE_SEPARATOR + slashed(relative(folder, file));
}

export interface DevPageEvent {
    readonly event: string;
    readonly data: unknown;
    readonly action: string;
}

export function devPageEventOf(change: DevChange): DevPageEvent {
    if (change.kind === "code") return {event: DEV_RELOAD_EVENT, data: {}, action: "reloading"};
    const data: DevDataAssetsChange = {paths: change.sitePaths};
    return {event: DEV_DATA_ASSETS_EVENT, data, action: `applying ${change.sitePaths.join(", ")} in place`};
}

export function servedProjectFolders(project: string | undefined): string[] {
    return project === undefined ? sampleProjectFolders() : [project];
}

export function classifyDevChanges(changedFiles: Iterable<string>, projectFolders: readonly string[]): DevChange {
    const sitePaths = new Set<string>();
    for (const file of changedFiles) {
        const sitePath = isDataAssetFile(file) ? sitePathOf(file, projectFolders) : undefined;
        if (sitePath === undefined) return CODE_CHANGE;
        sitePaths.add(sitePath);
    }
    return sitePaths.size === 0 ? CODE_CHANGE : {kind: "dataAssets", sitePaths: [...sitePaths].sort()};
}
