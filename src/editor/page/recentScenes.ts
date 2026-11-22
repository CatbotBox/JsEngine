import {normalizeProjectPath} from "./projectFiles";

export const RECENT_SCENES_STORAGE_KEY = "jsengine.editor.recentScenes";
export const MAX_RECENT_SCENES = 10;
export const MAX_REMEMBERED_PROJECTS = 20;

type RecentScenesByProject = {readonly [projectKey: string]: readonly string[]};

const PROJECT_KEY_SEPARATOR = "\n";

function isPathList(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(path => typeof path === "string" && path.length > 0);
}

function parsed(text: string | null): RecentScenesByProject {
    if (text === null) return {};
    try {
        const value = JSON.parse(text) as unknown;
        if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
        return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string[]] => isPathList(entry[1])));
    } catch {
        return {};
    }
}

function withProject(text: string | null, projectKey: string, paths: readonly string[]): string {
    const others = Object.entries(parsed(text)).filter(([key]) => key !== projectKey);
    const kept = paths.length === 0 ? others : [[projectKey, paths] as const, ...others];
    return JSON.stringify(Object.fromEntries(kept.slice(0, MAX_REMEMBERED_PROJECTS)));
}

export function recentScenesProjectKey(projectName: string, rootLabel: string): string {
    return `${projectName}${PROJECT_KEY_SEPARATOR}${rootLabel}`;
}

export function recentScenesOf(text: string | null, projectKey: string): string[] {
    return [...(parsed(text)[projectKey] ?? [])].slice(0, MAX_RECENT_SCENES);
}

export function withRecentScene(text: string | null, projectKey: string, path: string): string {
    const normalized = normalizeProjectPath(path);
    const paths = [normalized, ...recentScenesOf(text, projectKey).filter(recent => recent !== normalized)].slice(0, MAX_RECENT_SCENES);
    return withProject(text, projectKey, paths);
}

export function withoutRecentScene(text: string | null, projectKey: string, path: string): string {
    const normalized = normalizeProjectPath(path);
    return withProject(text, projectKey, recentScenesOf(text, projectKey).filter(recent => recent !== normalized));
}

export function withoutRecentScenes(text: string | null, projectKey: string): string {
    return withProject(text, projectKey, []);
}
