import type {PlatformFeature} from "../../engine/platform/platform";
import type {ProjectManifestValidation} from "../../engine/project/projectManifest";
import {isProjectTarget} from "../../engine/project/projectTargets";
import type {ProjectTarget} from "../../engine/project/projectTargets";
import {gameTargetKey, isGameTarget} from "./editorSettings";
import type {GameTarget} from "./editorSettings";

export const PROJECT_API_PREFIX = "/__project/";
export const PROJECT_EVENT_FILES_CHANGED = "files-changed";
export const PROJECT_EVENT_REBUILT = "rebuilt";
export const PROJECT_EVENT_BUILD_FAILED = "build-failed";
export const PROJECT_WORKER_FILE = "worker.js";
export const PROJECT_BUILD_FOLDER = ".jsengine/build";
export const PROJECT_OPEN_EXTERNALLY_ROUTE = "open-external";
export const PROJECT_SHOW_IN_FOLDER_ROUTE = "show-in-folder";
export const PROJECT_EDITOR_SETTINGS_ROUTE = "editor-settings";
export const PROJECT_GENERATE_ROUTE = "generate";
export const PROJECT_TARGET_REPORT_ROUTE = "target-report";
export const PROJECT_PACKAGE_ROUTE = "package";
export const PACKAGED_TARGET: ProjectTarget = "window";
export const EDITOR_SETTINGS_UPDATE_METHOD = "PATCH";

export interface ProjectCapabilities {
    readonly build: boolean;
    readonly buildUnavailableReason?: string;
    readonly pickFolder: boolean;
    readonly browse: boolean;
    readonly showInFolder: boolean;
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

export interface ShowInFolderRequest {
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

export type GenerateProjectReport =
    | {readonly ok: true; readonly written: readonly string[]; readonly unchanged: readonly string[]; readonly warnings: readonly string[]}
    | {readonly ok: false; readonly errors: readonly string[]};

export interface TargetReportRequest {
    readonly target: ProjectTarget;
}

export interface MissingFeatures {
    readonly anyOf: readonly PlatformFeature[];
    readonly allOf: readonly PlatformFeature[];
}

export interface FeatureProblem {
    readonly symbol: string;
    readonly file: string;
    readonly line: number;
    readonly column: number;
    readonly missing: MissingFeatures;
    readonly chain: readonly string[];
}

export interface BundleFeatureResult {
    readonly bundle: string;
    readonly target: ProjectTarget;
    readonly modules: number;
    readonly problems: readonly FeatureProblem[];
}

export interface TargetFeatureReport {
    readonly ok: boolean;
    readonly target: ProjectTarget;
    readonly bundles: readonly BundleFeatureResult[];
    readonly errors: readonly string[];
}

export interface TargetReportResult {
    readonly report: TargetFeatureReport;
    readonly output: readonly string[];
}

export interface PackageResult {
    readonly ok: boolean;
    readonly output: readonly string[];
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

export function isGenerateProjectReport(value: unknown): value is GenerateProjectReport {
    if (!isRecord(value)) return false;
    if (value.ok === false) return isStringList(value.errors);
    return value.ok === true && isStringList(value.written) && isStringList(value.unchanged) && isStringList(value.warnings);
}

function isMissingFeatures(value: unknown): value is MissingFeatures {
    return isRecord(value) && isStringList(value.anyOf) && isStringList(value.allOf);
}

function isFeatureProblem(value: unknown): value is FeatureProblem {
    return isRecord(value) && typeof value.symbol === "string" && typeof value.file === "string" && typeof value.line === "number"
        && typeof value.column === "number" && isMissingFeatures(value.missing) && isStringList(value.chain);
}

function isBundleFeatureResult(value: unknown): value is BundleFeatureResult {
    return isRecord(value) && typeof value.bundle === "string" && isProjectTarget(value.target) && typeof value.modules === "number"
        && Array.isArray(value.problems) && value.problems.every(isFeatureProblem);
}

export function isTargetFeatureReport(value: unknown): value is TargetFeatureReport {
    return isRecord(value) && typeof value.ok === "boolean" && isProjectTarget(value.target)
        && Array.isArray(value.bundles) && value.bundles.every(isBundleFeatureResult) && isStringList(value.errors);
}

export function isTargetReportResult(value: unknown): value is TargetReportResult {
    return isRecord(value) && isTargetFeatureReport(value.report) && isStringList(value.output);
}

export function isPackageResult(value: unknown): value is PackageResult {
    return isRecord(value) && typeof value.ok === "boolean" && isStringList(value.output);
}
