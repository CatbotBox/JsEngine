import {migrateDocumentJson, withRenamedKey} from "./documentMigrations";
import type {DocumentMigrations} from "./documentMigrations";

export const SCENE_DOCUMENT_FORMAT = "jsengine-scene";
export const SCENE_DOCUMENT_VERSION = 2;
export const FIRST_SCENE_ENTITY_ID = 1;

const MAX_DESCRIBED_LENGTH = 60;
const SCENE_TEXT_INDENT_SPACES = 2;
const GPU_MESH_PASS_SETTINGS_TYPE_NAME = "GpuMeshPassSettings";
const PREFAB_INSTANCE_TYPE_NAME = "PrefabInstance";
const FIRST_SCENE_DOCUMENT_VERSION = 1;

export type SceneJsonValue = null | boolean | number | string | SceneJsonValue[] | SceneJsonObject;

export interface SceneJsonObject {
    [key: string]: SceneJsonValue;
}

export type SceneFieldValues = SceneJsonObject;

export interface SceneEntityRecord {
    id: number;
    name: string | null;
    enabled: boolean;
    siblingIndex?: number;
    components: { [componentName: string]: SceneFieldValues };
}

export interface SceneDocument {
    format: typeof SCENE_DOCUMENT_FORMAT;
    version: typeof SCENE_DOCUMENT_VERSION;
    entities: SceneEntityRecord[];
    resources?: { [resourceName: string]: SceneFieldValues };
}

export function describeJson(value: unknown): string {
    if (value === undefined) return "nothing";
    let text: string;
    try {
        text = JSON.stringify(value) ?? String(value);
    } catch {
        text = String(value);
    }
    return text.length > MAX_DESCRIBED_LENGTH ? text.slice(0, MAX_DESCRIBED_LENGTH) + "..." : text;
}

export function isSceneJsonObject(value: unknown): value is SceneJsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sceneJsonEquals(a: SceneJsonValue, b: SceneJsonValue): boolean {
    if (a === b) return true;
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!sceneJsonEquals(a[i], b[i])) return false;
        return true;
    }
    if (!isSceneJsonObject(a) || !isSceneJsonObject(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
        const other = b[key];
        if (other === undefined || !sceneJsonEquals(a[key], other)) return false;
    }
    return true;
}

function withComponentFields(document: SceneJsonObject, typeName: string, update: (fields: SceneJsonObject) => SceneJsonObject): SceneJsonObject {
    const entities = document.entities;
    if (!Array.isArray(entities)) return document;
    return {
        ...document,
        entities: entities.map(entity => {
            if (!isSceneJsonObject(entity)) return entity;
            const components = entity.components;
            if (!isSceneJsonObject(components)) return entity;
            const fields = components[typeName];
            if (!isSceneJsonObject(fields)) return entity;
            return {...entity, components: {...components, [typeName]: update(fields)}};
        }),
    };
}

function withRenamedOverridePaths(document: SceneJsonObject, typeName: string, from: string, to: string): SceneJsonObject {
    const oldSuffix = `/${typeName}.${from}`;
    const newSuffix = `/${typeName}.${to}`;
    return withComponentFields(document, PREFAB_INSTANCE_TYPE_NAME, fields => {
        const overrides = fields.overrides;
        if (!Array.isArray(overrides)) return fields;
        const renamed = overrides.map(path => typeof path === "string" && path.endsWith(oldSuffix)
            ? path.slice(0, path.length - oldSuffix.length) + newSuffix
            : path);
        return {...fields, overrides: renamed};
    });
}

function withRenamedComponentField(document: SceneJsonObject, typeName: string, from: string, to: string): SceneJsonObject {
    const renamedFields = withComponentFields(document, typeName, fields => withRenamedKey(fields, from, to));
    return withRenamedOverridePaths(renamedFields, typeName, from, to);
}

export const SCENE_DOCUMENT_MIGRATIONS: DocumentMigrations = {
    currentVersion: SCENE_DOCUMENT_VERSION,
    steps: [
        {
            fromVersion: FIRST_SCENE_DOCUMENT_VERSION,
            migrate: document => withRenamedComponentField(document, GPU_MESH_PASS_SETTINGS_TYPE_NAME,
                "evictUnusedMeshAfterFrames", "evictUnusedAfterFrames"),
        },
    ],
};

function documentLabel(documentPath: string | undefined): string {
    return documentPath === undefined ? "Scene document" : `Scene document "${documentPath}"`;
}

function documentError(label: string, path: string, expectation: string, actual: unknown): Error {
    return new Error(`${label}: ${path} must be ${expectation}, got ${describeJson(actual)}`);
}

function parseEntityRecord(value: unknown, path: string, label: string): SceneEntityRecord {
    if (!isSceneJsonObject(value)) throw documentError(label, path, "an object", value);
    const id = value.id;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < FIRST_SCENE_ENTITY_ID) {
        throw documentError(label, `${path}.id`, `a whole number >= ${FIRST_SCENE_ENTITY_ID}`, id);
    }
    const name = value.name ?? null;
    if (name !== null && typeof name !== "string") throw documentError(label, `${path}.name`, "a string or null", name);
    const enabled = value.enabled ?? true;
    if (typeof enabled !== "boolean") throw documentError(label, `${path}.enabled`, "true or false", enabled);
    const siblingIndex = value.siblingIndex;
    if (siblingIndex !== undefined && (typeof siblingIndex !== "number" || !Number.isSafeInteger(siblingIndex) || siblingIndex < 0)) {
        throw documentError(label, `${path}.siblingIndex`, "a whole number >= 0", siblingIndex);
    }
    const components = parseFieldValueGroups(value.components ?? {}, `${path}.components`, label);
    return siblingIndex === undefined ? {id, name, enabled, components} : {id, name, enabled, siblingIndex, components};
}

function parseFieldValueGroups(groups: SceneJsonValue, path: string, label: string): { [typeName: string]: SceneFieldValues } {
    if (!isSceneJsonObject(groups)) throw documentError(label, path, "an object", groups);
    const parsed: { [typeName: string]: SceneFieldValues } = {};
    for (const typeName of Object.keys(groups)) {
        const fields = groups[typeName];
        if (!isSceneJsonObject(fields)) throw documentError(label, `${path}.${typeName}`, "an object of field values", fields);
        parsed[typeName] = fields;
    }
    return parsed;
}

export function migrateSceneJson(source: unknown, documentPath?: string): SceneJsonObject {
    const label = documentLabel(documentPath);
    const value = typeof source === "string" ? JSON.parse(source) as unknown : source;
    if (!isSceneJsonObject(value)) throw documentError(label, "the document", "an object", value);
    if (value.format !== SCENE_DOCUMENT_FORMAT) throw documentError(label, "format", JSON.stringify(SCENE_DOCUMENT_FORMAT), value.format);
    const version = value.version;
    if (typeof version !== "number" || !Number.isSafeInteger(version)) throw documentError(label, "version", "a whole number", version);
    return migrateDocumentJson(value, version, SCENE_DOCUMENT_MIGRATIONS, label);
}

export function parseSceneDocument(source: unknown, documentPath?: string): SceneDocument {
    const label = documentLabel(documentPath);
    const value = migrateSceneJson(source, documentPath);
    const entities = value.entities;
    if (!Array.isArray(entities)) throw documentError(label, "entities", "an array", entities);
    const records = entities.map((entity, index) => parseEntityRecord(entity, `entities[${index}]`, label));
    const indexById = new Map<number, number>();
    records.forEach((record, index) => {
        const previous = indexById.get(record.id);
        if (previous !== undefined) {
            throw new Error(`${label}: entities[${index}].id ${record.id} repeats the id of entities[${previous}]`);
        }
        indexById.set(record.id, index);
    });
    const document: SceneDocument = {format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: records};
    if (value.resources !== undefined) document.resources = parseFieldValueGroups(value.resources, "resources", label);
    return document;
}

export function sceneDocumentText(document: SceneDocument | SceneJsonObject): string {
    return JSON.stringify(document, null, SCENE_TEXT_INDENT_SPACES);
}
