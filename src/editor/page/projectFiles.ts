import {DATA_ASSET_FILE_SUFFIX} from "../../engine/scene/dataAssetDocument";
import type {ProjectEntry} from "../project/projectFileSystem";
import {PROJECT_ENTRY_EXTENSIONS} from "../project/projectManifest";

export type ProjectFileKind = "scene" | "prefab" | "dataAsset" | "mesh" | "image" | "code" | "other";

export interface ProjectFolder {
    readonly path: string;
    readonly name: string;
    readonly folders: ProjectFolder[];
    readonly files: ProjectEntry[];
}

export const ROOT_FOLDER_PATH = "";
export const SCENE_EXTENSION = ".scene.json";
export const PREFAB_EXTENSION = ".prefab.json";
export const SCENES_FOLDER = "scenes";
export const PROJECT_FILE_KIND_TITLES: Readonly<Record<ProjectFileKind, string>> = {
    scene: "Scene",
    prefab: "Prefab",
    dataAsset: "Data Asset",
    mesh: "Mesh",
    image: "Image",
    code: "Code",
    other: "File",
};

const PATH_SEPARATOR = "/";
const BACKSLASH = /\\/g;
const LEADING_DOT_SLASH = /^(\.\/)+/;
const EDGE_SLASHES = /^\/+|\/+$/g;
const REPEATED_SLASHES = /\/{2,}/g;
const FORBIDDEN_NAME_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f]/;
const RESERVED_NAMES: ReadonlySet<string> = new Set([".", ".."]);
const FIRST_DUPLICATE_SUFFIX = 1;
const DUPLICATE_SEPARATOR = " ";
const MESH_EXTENSIONS: readonly string[] = [".obj"];
const IMAGE_EXTENSIONS: readonly string[] = [".png", ".jpg", ".jpeg", ".ppm"];
const COMPOUND_EXTENSIONS: readonly string[] = [SCENE_EXTENSION, PREFAB_EXTENSION, DATA_ASSET_FILE_SUFFIX];

export function normalizeProjectPath(path: string): string {
    return path.replace(BACKSLASH, PATH_SEPARATOR).replace(LEADING_DOT_SLASH, "").replace(REPEATED_SLASHES, PATH_SEPARATOR).replace(EDGE_SLASHES, "");
}

export function projectFileKind(path: string): ProjectFileKind {
    const lower = path.toLowerCase();
    if (lower.endsWith(SCENE_EXTENSION)) return "scene";
    if (lower.endsWith(PREFAB_EXTENSION)) return "prefab";
    if (lower.endsWith(DATA_ASSET_FILE_SUFFIX)) return "dataAsset";
    if (MESH_EXTENSIONS.some(extension => lower.endsWith(extension))) return "mesh";
    if (IMAGE_EXTENSIONS.some(extension => lower.endsWith(extension))) return "image";
    if (PROJECT_ENTRY_EXTENSIONS.some(extension => lower.endsWith(extension))) return "code";
    return "other";
}

export function isAssetKind(kind: ProjectFileKind): kind is "mesh" | "image" | "prefab" {
    return kind === "mesh" || kind === "image" || kind === "prefab";
}

export function parentFolderOf(path: string): string {
    const normalized = normalizeProjectPath(path);
    const index = normalized.lastIndexOf(PATH_SEPARATOR);
    return index < 0 ? ROOT_FOLDER_PATH : normalized.slice(0, index);
}

export function baseNameOf(path: string): string {
    const normalized = normalizeProjectPath(path);
    return normalized.slice(normalized.lastIndexOf(PATH_SEPARATOR) + 1);
}

export function joinProjectPath(folder: string, name: string): string {
    const normalizedFolder = normalizeProjectPath(folder);
    return normalizedFolder === ROOT_FOLDER_PATH ? normalizeProjectPath(name) : `${normalizedFolder}${PATH_SEPARATOR}${normalizeProjectPath(name)}`;
}

export function extensionOf(name: string): string {
    const lower = name.toLowerCase();
    for (const compound of COMPOUND_EXTENSIONS) if (lower.endsWith(compound)) return name.slice(name.length - compound.length);
    const dot = name.lastIndexOf(".");
    return dot <= 0 ? "" : name.slice(dot);
}

export function stemOf(path: string): string {
    const name = baseNameOf(path);
    return name.slice(0, name.length - extensionOf(name).length);
}

export function isAncestorFolder(folder: string, path: string): boolean {
    const normalizedFolder = normalizeProjectPath(folder);
    const normalizedPath = normalizeProjectPath(path);
    return normalizedFolder === ROOT_FOLDER_PATH || normalizedPath === normalizedFolder || normalizedPath.startsWith(normalizedFolder + PATH_SEPARATOR);
}

export function fileNameProblem(name: string): string | undefined {
    const trimmed = name.trim();
    if (trimmed.length === 0) return "A name cannot be empty";
    if (RESERVED_NAMES.has(trimmed)) return `"${trimmed}" is not a usable name`;
    if (FORBIDDEN_NAME_CHARACTERS.test(trimmed)) return `"${trimmed}" contains a character that cannot be in a file name`;
    return undefined;
}

export function uniqueChildPath(existing: ReadonlySet<string>, folder: string, stem: string, extension: string): string {
    const first = joinProjectPath(folder, `${stem}${extension}`);
    if (!existing.has(first)) return first;
    for (let suffix = FIRST_DUPLICATE_SUFFIX; ; suffix++) {
        const candidate = joinProjectPath(folder, `${stem}${DUPLICATE_SEPARATOR}${suffix}${extension}`);
        if (!existing.has(candidate)) return candidate;
    }
}

function byName(a: {readonly name: string}, b: {readonly name: string}): number {
    return a.name.localeCompare(b.name, undefined, {sensitivity: "base", numeric: true});
}

interface MutableFolder {
    readonly path: string;
    readonly name: string;
    readonly folders: MutableFolder[];
    readonly files: ProjectEntry[];
}

export function buildProjectTree(entries: readonly ProjectEntry[]): ProjectFolder {
    const root: MutableFolder = {path: ROOT_FOLDER_PATH, name: "", folders: [], files: []};
    const folders = new Map<string, MutableFolder>([[ROOT_FOLDER_PATH, root]]);
    const folderAt = (path: string): MutableFolder => {
        const existing = folders.get(path);
        if (existing !== undefined) return existing;
        const parent = folderAt(parentFolderOf(path));
        const created: MutableFolder = {path, name: baseNameOf(path), folders: [], files: []};
        folders.set(path, created);
        parent.folders.push(created);
        return created;
    };
    for (const entry of entries) {
        const path = normalizeProjectPath(entry.path);
        if (path === ROOT_FOLDER_PATH) continue;
        if (entry.kind === "directory") folderAt(path);
        else folderAt(parentFolderOf(path)).files.push(path === entry.path ? entry : {...entry, path});
    }
    for (const folder of folders.values()) {
        folder.folders.sort(byName);
        folder.files.sort((a, b) => byName({name: baseNameOf(a.path)}, {name: baseNameOf(b.path)}));
    }
    return root;
}

export function findFolder(root: ProjectFolder, path: string): ProjectFolder | undefined {
    const normalized = normalizeProjectPath(path);
    if (normalized === ROOT_FOLDER_PATH) return root;
    let current: ProjectFolder | undefined = root;
    for (const part of normalized.split(PATH_SEPARATOR)) {
        current = current?.folders.find(folder => folder.name === part);
        if (current === undefined) return undefined;
    }
    return current;
}

export function allProjectPaths(entries: readonly ProjectEntry[]): Set<string> {
    return new Set(entries.map(entry => normalizeProjectPath(entry.path)));
}

export function renamedPath(path: string, newName: string): string {
    return joinProjectPath(parentFolderOf(path), newName.trim());
}
