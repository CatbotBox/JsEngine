import type {ProjectManifestValidation} from "../../engine/project/projectManifest";
import {gameTargetKey, isGameTarget} from "./editorSettings";
import type {GameTarget} from "./editorSettings";

export const PROJECT_API_PREFIX = "/__project/";
export const PROJECT_EVENT_FILES_CHANGED = "files-changed";
export const PROJECT_EVENT_REBUILT = "rebuilt";
export const PROJECT_EVENT_BUILD_FAILED = "build-failed";
export const PROJECT_WORKER_FILE = "worker.js";
export const PROJECT_BUILD_FOLDER = ".jsengine/build";
export const PROJECT_OPEN_EXTERNALLY_ROUTE = "open-external";
export const PROJECT_EDITOR_SETTINGS_ROUTE = "editor-settings";
export const EDITOR_SETTINGS_UPDATE_METHOD = "PATCH";

export interface ProjectCapabilities {
    readonly build: boolean;
    readonly buildUnavailableReason?: string;
    readonly pickFolder: boolean;
    readonly browse: boolean;
}

export interface PickFolderResult {
    readonly path: string | null;
}

export interface BrowsedDirectory {
    readonly name: string;
    readonly path: string;
}

export interface BrowseResult {
    readonly path: string;
    readonly parent: string | null;
    readonly directories: readonly BrowsedDirectory[];
    readonly roots: readonly BrowsedDirectory[];
}

export interface OpenProjectRequest {
    readonly path: string;
}

export interface CreateProjectRequest {
    readonly path: string;
    readonly name: string;
}

export interface OpenProjectResult {
    readonly id: string;
    readonly path: string;
    readonly validation: ProjectManifestValidation;
}

export interface BuildProjectRequest {
    readonly gameTarget?: GameTarget;
}

export interface BuiltProject {
    readonly workerUrl: string;
    readonly gameTarget: GameTarget;
    readonly editorExtensionsUrl?: string;
    readonly warnings: readonly string[];
}

export type BuildProjectResult = BuiltProject | {readonly errors: readonly string[]};

export interface RenameRequest {
    readonly from: string;
    readonly to: string;
}

export interface MakeDirectoryRequest {
    readonly path: string;
}

export interface OpenExternallyRequest {
    readonly path: string;
}

export interface FilesChangedEvent {
    readonly paths: readonly string[];
}

export type RebuiltEvent = BuiltProject;

export interface BuildFailedEvent {
    readonly errors: readonly string[];
}

export interface ProjectApiError {
    readonly error: string;
}

export function projectApiUrl(route: string): string {
    return PROJECT_API_PREFIX + route;
}

export function projectBuildCopyPath(gameTarget: GameTarget): string {
    return `${PROJECT_BUILD_FOLDER}/editor.${gameTargetKey(gameTarget)}.worker.js`;
}

export function projectFileRoute(path: string): string {
    return path.split("/").map(encodeURIComponent).join("/");
}

export function isBuildSuccess(result: BuildProjectResult): result is BuiltProject {
    return "workerUrl" in result;
}

function isRecord(value: unknown): value is {readonly [key: string]: unknown} {
    return typeof value === "object" && value !== null;
}

function isStringList(value: unknown): value is readonly string[] {
    return Array.isArray(value) && value.every(item => typeof item === "string");
}

export function isFilesChangedEvent(value: unknown): value is FilesChangedEvent {
    return isRecord(value) && isStringList(value.paths);
}

export function isRebuiltEvent(value: unknown): value is RebuiltEvent {
    if (!isRecord(value)) return false;
    const editorExtensionsUrl = value.editorExtensionsUrl;
    return typeof value.workerUrl === "string" && isGameTarget(value.gameTarget) && isStringList(value.warnings)
        && (editorExtensionsUrl === undefined || typeof editorExtensionsUrl === "string");
}

export function isBuildFailedEvent(value: unknown): value is BuildFailedEvent {
    return isRecord(value) && isStringList(value.errors);
}
