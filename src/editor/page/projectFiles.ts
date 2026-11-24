import {SPRITE_PATTERN_FILE_SUFFIX} from "../../engine/rendering/2d/spritePatternFile";
import {DATA_ASSET_FILE_SUFFIX} from "../../engine/scene/dataAssetDocument";
import type {ProjectEntry} from "../project/projectFileSystem";
import {PROJECT_ENTRY_EXTENSIONS} from "../../engine/project/projectManifest";

export type ProjectFileKind = "scene" | "prefab" | "dataAsset" | "mesh" | "image" | "pattern" | "code" | "other";

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
    pattern: "Sprite Pattern",
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
const COMPOUND_EXTENSIONS: readonly string[] = [SCENE_EXTENSION, PREFAB_EXTENSION, DATA_ASSET_FILE_SUFFIX, SPRITE_PATTERN_FILE_SUFFIX];

export function normalizeProjectPath(path: string): string {
    return path.replace(BACKSLASH, PATH_SEPARATOR).replace(LEADING_DOT_SLASH, "").replace(REPEATED_SLASHES, PATH_SEPARATOR).replace(EDGE_SLASHES, "");
}

export function projectFileKind(path: string): ProjectFileKind {
    const lower = path.toLowerCase();
    if (lower.endsWith(SCENE_EXTENSION)) return "scene";
    if (lower.endsWith(PREFAB_EXTENSION)) return "prefab";
    if (lower.endsWith(DATA_ASSET_FILE_SUFFIX)) return "dataAsset";
    if (lower.endsWith(SPRITE_PATTERN_FILE_SUFFIX)) return "pattern";
    if (MESH_EXTENSIONS.some(extension => lower.endsWith(extension))) return "mesh";
    if (IMAGE_EXTENSIONS.some(extension => lower.endsWith(extension))) return "image";
    if (PROJECT_ENTRY_EXTENSIONS.some(extension => lower.endsWith(extension))) return "code";
    return "other";
}

export function isImageKind(kind: ProjectFileKind): kind is "image" | "pattern" {
    return kind === "image" || kind === "pattern";
}

export function isAssetKind(kind: ProjectFileKind): kind is "mesh" | "image" | "pattern" | "prefab" {
    return kind === "mesh" || isImageKind(kind) || kind === "prefab";
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

export function projectFolderPaths(entries: readonly ProjectEntry[], extra: readonly string[] = []): string[] {
    const folders = new Set<string>([ROOT_FOLDER_PATH]);
    const addWithParents = (folder: string): void => {
        for (let path = normalizeProjectPath(folder); path !== ROOT_FOLDER_PATH && !folders.has(path); path = parentFolderOf(path)) folders.add(path);
    };
    for (const entry of entries) addWithParents(entry.kind === "directory" ? entry.path : parentFolderOf(entry.path));
    for (const folder of extra) addWithParents(folder);
    return [...folders].sort((a, b) => a.localeCompare(b));
}

export function allProjectPaths(entries: readonly ProjectEntry[]): Set<string> {
    return new Set(entries.map(entry => normalizeProjectPath(entry.path)));
}

export function renamedPath(path: string, newName: string): string {
    return joinProjectPath(parentFolderOf(path), newName.trim());
}

const SCENE_DOCUMENT_KINDS: ReadonlySet<ProjectFileKind> = new Set(["scene", "prefab"]);

export function sceneAndPrefabPaths(entries: readonly ProjectEntry[]): string[] {
    return entries
        .filter(entry => entry.kind === "file")
        .map(entry => normalizeProjectPath(entry.path))
        .filter(path => SCENE_DOCUMENT_KINDS.has(projectFileKind(path)))
        .sort((a, b) => a.localeCompare(b));
}

const EDITOR_DOCUMENT_KINDS: ReadonlySet<ProjectFileKind> = new Set(["scene", "prefab", "dataAsset"]);

export function opensInEditor(kind: ProjectFileKind): boolean {
    return EDITOR_DOCUMENT_KINDS.has(kind);
}

export type ProjectItemKind = ProjectFileKind | "folder";

export interface ProjectItemRef {
    readonly path: string;
    readonly kind: ProjectItemKind;
}

export const PROJECT_ITEM_KIND_TITLES: Readonly<Record<ProjectItemKind, string>> = {folder: "Folder", ...PROJECT_FILE_KIND_TITLES};

const DUPLICATE_NUMBER_SUFFIX = / \d+$/;

export function projectItemsOf(entries: readonly ProjectEntry[]): ProjectItemRef[] {
    return entries
        .map(entry => {
            const path = normalizeProjectPath(entry.path);
            return {path, kind: entry.kind === "directory" ? "folder" as const : projectFileKind(path)};
        })
        .filter(item => item.path !== ROOT_FOLDER_PATH);
}

export function duplicatePath(existing: ReadonlySet<string>, path: string, isFolder: boolean): string {
    const name = baseNameOf(path);
    const extension = isFolder ? "" : extensionOf(name);
    const stem = name.slice(0, name.length - extension.length);
    const unnumbered = stem.replace(DUPLICATE_NUMBER_SUFFIX, "");
    const base = unnumbered.length === 0 ? stem : unnumbered;
    const folder = parentFolderOf(path);
    for (let suffix = FIRST_DUPLICATE_SUFFIX; ; suffix++) {
        const candidate = joinProjectPath(folder, `${base}${DUPLICATE_SEPARATOR}${suffix}${extension}`);
        if (!existing.has(candidate)) return candidate;
    }
}

export function duplicatePaths(existing: ReadonlySet<string>, items: readonly ProjectItemRef[]): string[] {
    const taken = new Set(existing);
    return items.map(item => {
        const target = duplicatePath(taken, item.path, item.kind === "folder");
        taken.add(target);
        return target;
    });
}
