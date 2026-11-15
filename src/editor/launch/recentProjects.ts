export interface RecentProject {
    readonly path: string;
    readonly name: string;
    readonly openedAtMs: number;
}

export interface KeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export const RECENT_PROJECTS_KEY = "jsengine.editor.recentProjects";
export const MAX_RECENT_PROJECTS = 10;

function isRecentProject(value: unknown): value is RecentProject {
    if (typeof value !== "object" || value === null) return false;
    const project = value as {path?: unknown, name?: unknown, openedAtMs?: unknown};
    return typeof project.path === "string" && project.path.length > 0 && typeof project.name === "string"
        && typeof project.openedAtMs === "number" && Number.isFinite(project.openedAtMs);
}

export function readRecentProjects(storage: KeyValueStorage | undefined): RecentProject[] {
    if (storage === undefined) return [];
    try {
        const parsed = JSON.parse(storage.getItem(RECENT_PROJECTS_KEY) ?? "[]") as unknown;
        return Array.isArray(parsed) ? parsed.filter(isRecentProject).slice(0, MAX_RECENT_PROJECTS) : [];
    } catch {
        return [];
    }
}

function writeRecentProjects(storage: KeyValueStorage | undefined, projects: readonly RecentProject[]): void {
    try {
        storage?.setItem(RECENT_PROJECTS_KEY, JSON.stringify(projects));
    } catch {
        return;
    }
}

export function rememberRecentProject(storage: KeyValueStorage | undefined, path: string, name: string, nowMs: number): RecentProject[] {
    const projects = [{path, name, openedAtMs: nowMs}, ...readRecentProjects(storage).filter(project => project.path !== path)].slice(0, MAX_RECENT_PROJECTS);
    writeRecentProjects(storage, projects);
    return projects;
}

export function forgetRecentProject(storage: KeyValueStorage | undefined, path: string): RecentProject[] {
    const projects = readRecentProjects(storage).filter(project => project.path !== path);
    writeRecentProjects(storage, projects);
    return projects;
}

export function browserStorageOrUndefined(): KeyValueStorage | undefined {
    try {
        return globalThis.localStorage ?? undefined;
    } catch {
        return undefined;
    }
}
