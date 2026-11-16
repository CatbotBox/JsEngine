import {DATA_ASSET_FORMAT} from "../../engine/scene/dataAssetDocument";
import {isSceneJsonObject} from "../../engine/scene/sceneDocument";
import type {ProjectEntry} from "../project/projectFileSystem";
import {normalizeProjectPath} from "./projectFiles";

export function matchesFileSuffix(path: string, suffixes: readonly string[]): boolean {
    const lower = path.toLowerCase();
    return suffixes.some(suffix => lower.endsWith(suffix.toLowerCase()));
}

export function filesWithSuffixes(entries: readonly ProjectEntry[], suffixes: readonly string[]): string[] {
    return entries
        .filter(entry => entry.kind === "file" && matchesFileSuffix(entry.path, suffixes))
        .map(entry => normalizeProjectPath(entry.path))
        .sort((a, b) => a.localeCompare(b, undefined, {sensitivity: "base", numeric: true}));
}

export function dataAssetTypeOf(text: string): string | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return undefined;
    }
    if (!isSceneJsonObject(parsed) || parsed.format !== DATA_ASSET_FORMAT) return undefined;
    return typeof parsed.type === "string" ? parsed.type : undefined;
}
