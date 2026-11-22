import {DATA_ASSET_FILE_SUFFIX} from "../scene/dataAssetDocument";
import {projectFileExtension, projectRelativePath} from "./projectPaths";
import {targetsProblems, TARGETS_MANIFEST_KEY} from "./projectTargets";
import type {ProjectTargets} from "./projectTargets";

export const PROJECT_MANIFEST_FILE = "jsengine.project.json";
export const PROJECT_ENTRY_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".js", ".mjs"];
export const SCENE_FILE_SUFFIX = ".scene.json";
export const SCHEMAS_MANIFEST_KEY = "schemas";
export const SYSTEMS_MANIFEST_KEY = "systems";
export const KEEP_MANIFEST_KEY = "keep";

export interface ProjectResourceBinding {
    readonly type: string;
    readonly path: string;
}

export interface GeneratedListSettings {
    readonly exclude: readonly string[];
}

export interface ProjectManifest {
    readonly name: string;
    readonly entry?: string;
    readonly startScene?: string;
    readonly resources?: readonly ProjectResourceBinding[];
    readonly schemas?: GeneratedListSettings;
    readonly systems?: GeneratedListSettings;
    readonly keep?: readonly string[];
    readonly targets?: ProjectTargets;
    readonly editorExtensions?: string;
}

export type ProjectManifestValidation =
    | {readonly ok: true; readonly manifest: ProjectManifest}
    | {readonly ok: false; readonly problems: readonly string[]};

type ManifestFields = {readonly [key: string]: unknown};

function isManifestObject(value: unknown): value is ManifestFields {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codeModuleProblems(key: string, value: unknown, fileExists: ((path: string) => boolean) | undefined): {readonly path?: string, readonly problems: string[]} {
    if (typeof value !== "string" || value.trim().length === 0) return {problems: [`"${key}" must be a non-empty string path, got ${JSON.stringify(value)}`]};
    const path = projectRelativePath(value.trim());
    if (path === undefined) return {problems: [`"${key}" ${JSON.stringify(value)} must be a relative path that stays inside the project folder`]};
    const problems: string[] = [];
    if (!PROJECT_ENTRY_EXTENSIONS.includes(projectFileExtension(path))) {
        problems.push(`"${key}" ${JSON.stringify(value)} must name a ${PROJECT_ENTRY_EXTENSIONS.join(", ")} module`);
    } else if (fileExists !== undefined && !fileExists(path)) {
        problems.push(`"${key}" names ${path}, which does not exist in the project folder`);
    }
    return {path, problems};
}

function entryProblems(value: unknown, entryExists: ((path: string) => boolean) | undefined): {readonly entry?: string, readonly problems: string[]} {
    if (value === undefined) return {problems: []};
    const checked = codeModuleProblems("entry", value, entryExists);
    return {entry: checked.path, problems: checked.problems};
}

function editorExtensionsProblems(value: unknown, fileExists: ((path: string) => boolean) | undefined): {readonly editorExtensions?: string, readonly problems: string[]} {
    if (value === undefined) return {problems: []};
    const checked = codeModuleProblems("editorExtensions", value, fileExists);
    return {editorExtensions: checked.path, problems: checked.problems};
}

function startSceneProblems(value: unknown): {readonly startScene?: string, readonly problems: string[]} {
    if (value === undefined) return {problems: []};
    if (typeof value !== "string" || value.trim().length === 0) return {problems: [`"startScene" must be a non-empty string path when present, got ${JSON.stringify(value)}`]};
    const startScene = projectRelativePath(value.trim());
    if (startScene === undefined) return {problems: [`"startScene" ${JSON.stringify(value)} must be a relative path that stays inside the project folder`]};
    if (!startScene.toLowerCase().endsWith(SCENE_FILE_SUFFIX)) return {problems: [`"startScene" ${JSON.stringify(value)} must name a ${SCENE_FILE_SUFFIX} file`]};
    return {startScene, problems: []};
}

function trimmedNonEmpty(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function resourcePathOf(value: unknown, label: string): {readonly path?: string, readonly problem?: string} {
    const text = trimmedNonEmpty(value);
    if (text === undefined) return {problem: `${label} must be a non-empty string path, got ${JSON.stringify(value)}`};
    const path = projectRelativePath(text);
    if (path === undefined) return {problem: `${label} ${JSON.stringify(value)} must be a relative path that stays inside the project folder`};
    if (!path.toLowerCase().endsWith(DATA_ASSET_FILE_SUFFIX)) return {problem: `${label} ${JSON.stringify(value)} must name a ${DATA_ASSET_FILE_SUFFIX} file`};
    return {path};
}

function resourceBindingProblems(value: unknown, index: number, boundTypes: Map<string, number>): {readonly binding?: ProjectResourceBinding, readonly problems: string[]} {
    const label = (key?: string) => key === undefined ? `"resources[${index}]"` : `"resources[${index}].${key}"`;
    if (!isManifestObject(value)) return {problems: [`${label()} must be an object {"type", "path"}, got ${JSON.stringify(value)}`]};
    const problems: string[] = [];
    const type = trimmedNonEmpty(value.type);
    const boundAt = type === undefined ? undefined : boundTypes.get(type);
    if (type === undefined) problems.push(`${label("type")} must name a registered resource type, got ${JSON.stringify(value.type)}`);
    else if (boundAt !== undefined) problems.push(`${label("type")} ${JSON.stringify(type)} is already bound by "resources[${boundAt}]"`);
    else boundTypes.set(type, index);
    const path = resourcePathOf(value.path, label("path"));
    if (path.problem !== undefined) problems.push(path.problem);
    if (type === undefined || path.path === undefined || problems.length > 0) return {problems};
    return {binding: {type, path: path.path}, problems};
}

function resourcesProblems(value: unknown): {readonly resources?: readonly ProjectResourceBinding[], readonly problems: string[]} {
    if (value === undefined) return {problems: []};
    if (!Array.isArray(value)) return {problems: [`"resources" must be an array of {"type", "path"} objects when present, got ${JSON.stringify(value)}`]};
    const boundTypes = new Map<string, number>();
    const checked = value.map((entry, index) => resourceBindingProblems(entry, index, boundTypes));
    const problems = checked.flatMap(entry => entry.problems);
    if (problems.length > 0) return {problems};
    return {resources: checked.map(entry => entry.binding!), problems};
}

function typeNameListProblems(label: string, value: unknown): {readonly names?: readonly string[], readonly problems: string[]} {
    if (!Array.isArray(value)) return {problems: [`"${label}" must be an array of type names, got ${JSON.stringify(value)}`]};
    const names = value.map(trimmedNonEmpty);
    const problems = value.flatMap((name, index) => names[index] === undefined ? [`"${label}[${index}]" must be a non-empty type name, got ${JSON.stringify(name)}`] : []);
    return problems.length > 0 ? {problems} : {names: names as string[], problems};
}

function excludeListProblems(key: string, value: unknown): {readonly exclude?: readonly string[], readonly problems: string[]} {
    if (value === undefined) return {exclude: [], problems: []};
    const checked = typeNameListProblems(`${key}.exclude`, value);
    return {exclude: checked.names, problems: checked.problems};
}

function keepListProblems(value: unknown): {readonly keep?: readonly string[], readonly problems: string[]} {
    if (value === undefined) return {problems: []};
    const checked = typeNameListProblems(KEEP_MANIFEST_KEY, value);
    return {keep: checked.names, problems: checked.problems};
}

function generatedListProblems(key: string, value: unknown): {readonly settings?: GeneratedListSettings, readonly problems: string[]} {
    if (value === undefined) return {problems: []};
    if (!isManifestObject(value)) return {problems: [`"${key}" must be an object {"exclude": [type names]} when present, got ${JSON.stringify(value)}`]};
    const checked = excludeListProblems(key, value.exclude);
    return checked.exclude === undefined ? {problems: checked.problems} : {settings: {exclude: checked.exclude}, problems: []};
}

export function validateProjectManifest(text: string | undefined, entryExists?: (path: string) => boolean): ProjectManifestValidation {
    if (text === undefined) return {ok: false, problems: [`${PROJECT_MANIFEST_FILE} is missing: this folder is not a JsEngine project`]};
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        return {ok: false, problems: [`${PROJECT_MANIFEST_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`]};
    }
    if (!isManifestObject(parsed)) return {ok: false, problems: [`${PROJECT_MANIFEST_FILE} must hold a JSON object, got ${JSON.stringify(parsed)}`]};
    const problems: string[] = [];
    const name = parsed.name;
    if (name === undefined) problems.push(`"name" is missing: give the project a name`);
    else if (typeof name !== "string" || name.trim().length === 0) problems.push(`"name" must be a non-empty string, got ${JSON.stringify(name)}`);
    const entry = entryProblems(parsed.entry, entryExists);
    const startScene = startSceneProblems(parsed.startScene);
    const resources = resourcesProblems(parsed.resources);
    const schemas = generatedListProblems(SCHEMAS_MANIFEST_KEY, parsed.schemas);
    const systems = generatedListProblems(SYSTEMS_MANIFEST_KEY, parsed.systems);
    const keep = keepListProblems(parsed[KEEP_MANIFEST_KEY]);
    const targets = targetsProblems(parsed[TARGETS_MANIFEST_KEY]);
    const editorExtensions = editorExtensionsProblems(parsed.editorExtensions, entryExists);
    problems.push(...entry.problems, ...startScene.problems, ...resources.problems, ...schemas.problems, ...systems.problems, ...keep.problems, ...targets.problems, ...editorExtensions.problems);
    if (problems.length > 0) return {ok: false, problems};
    const manifest: ProjectManifest = {
        name: (name as string).trim(),
        ...(entry.entry === undefined ? {} : {entry: entry.entry}),
        ...(startScene.startScene === undefined ? {} : {startScene: startScene.startScene}),
        ...(resources.resources === undefined ? {} : {resources: resources.resources}),
        ...(schemas.settings === undefined ? {} : {schemas: schemas.settings}),
        ...(systems.settings === undefined ? {} : {systems: systems.settings}),
        ...(keep.keep === undefined ? {} : {keep: keep.keep}),
        ...(targets.targets === undefined ? {} : {targets: targets.targets}),
        ...(editorExtensions.editorExtensions === undefined ? {} : {editorExtensions: editorExtensions.editorExtensions}),
    };
    return {ok: true, manifest};
}
