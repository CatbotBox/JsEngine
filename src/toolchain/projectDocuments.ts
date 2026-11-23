import {readdirSync} from "fs";
import {join, relative} from "path";
import {SCENE_FILE_SUFFIX} from "../engine/project/projectManifest";
import {DATA_ASSET_FILE_SUFFIX, PREFAB_FILE_SUFFIX} from "../engine/scene";
import {compareText} from "./generate/projectSources";
import {GENERATED_FOLDER} from "./projectLayout";
import {slashed} from "./repoPaths";

const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([".jsengine", "node_modules", GENERATED_FOLDER]);

export function isSceneOrPrefab(path: string): boolean {
    const lower = path.toLowerCase();
    return lower.endsWith(SCENE_FILE_SUFFIX) || lower.endsWith(PREFAB_FILE_SUFFIX);
}

export function isProjectDocument(path: string): boolean {
    return isSceneOrPrefab(path) || path.toLowerCase().endsWith(DATA_ASSET_FILE_SUFFIX);
}

export function documentPathsUnder(folder: string, directory: string = folder): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return SKIPPED_FOLDERS.has(entry.name) ? [] : documentPathsUnder(folder, path);
        return isProjectDocument(entry.name) ? [slashed(relative(folder, path))] : [];
    }).sort(compareText);
}
