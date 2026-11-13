export const SCENE_DOCUMENT_FORMAT = "jsengine-scene";
export const SCENE_DOCUMENT_VERSION = 1;
export const FIRST_SCENE_ENTITY_ID = 1;

const MAX_DESCRIBED_LENGTH = 60;

export type SceneJsonValue = null | boolean | number | string | SceneJsonValue[] | SceneJsonObject;

export interface SceneJsonObject {
    [key: string]: SceneJsonValue;
}

export type SceneFieldValues = SceneJsonObject;

export interface SceneEntityRecord {
    id: number;
    name: string | null;
    enabled: boolean;
    components: { [componentName: string]: SceneFieldValues };
}

export interface SceneDocument {
    format: typeof SCENE_DOCUMENT_FORMAT;
    version: typeof SCENE_DOCUMENT_VERSION;
    entities: SceneEntityRecord[];
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

function documentError(path: string, expectation: string, actual: unknown): Error {
    return new Error(`Scene document: ${path} must be ${expectation}, got ${describeJson(actual)}`);
}

function parseEntityRecord(value: unknown, path: string): SceneEntityRecord {
    if (!isSceneJsonObject(value)) throw documentError(path, "an object", value);
    const id = value.id;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < FIRST_SCENE_ENTITY_ID) {
        throw documentError(`${path}.id`, `a whole number >= ${FIRST_SCENE_ENTITY_ID}`, id);
    }
    const name = value.name ?? null;
    if (name !== null && typeof name !== "string") throw documentError(`${path}.name`, "a string or null", name);
    const enabled = value.enabled ?? true;
    if (typeof enabled !== "boolean") throw documentError(`${path}.enabled`, "true or false", enabled);
    const components = value.components ?? {};
    if (!isSceneJsonObject(components)) throw documentError(`${path}.components`, "an object", components);
    const parsedComponents: { [componentName: string]: SceneFieldValues } = {};
    for (const componentName of Object.keys(components)) {
        const fields = components[componentName];
        if (!isSceneJsonObject(fields)) throw documentError(`${path}.components.${componentName}`, "an object of field values", fields);
        parsedComponents[componentName] = fields;
    }
    return {id, name, enabled, components: parsedComponents};
}

export function parseSceneDocument(source: unknown): SceneDocument {
    const value = typeof source === "string" ? JSON.parse(source) as unknown : source;
    if (!isSceneJsonObject(value)) throw documentError("the document", "an object", value);
    if (value.format !== SCENE_DOCUMENT_FORMAT) throw documentError("format", JSON.stringify(SCENE_DOCUMENT_FORMAT), value.format);
    const version = value.version;
    if (typeof version !== "number" || !Number.isSafeInteger(version) || version < SCENE_DOCUMENT_VERSION) {
        throw documentError("version", `a whole number >= ${SCENE_DOCUMENT_VERSION}`, version);
    }
    if (version > SCENE_DOCUMENT_VERSION) {
        throw new Error(`Scene document: version ${version} is newer than the supported version ${SCENE_DOCUMENT_VERSION}`);
    }
    const entities = value.entities;
    if (!Array.isArray(entities)) throw documentError("entities", "an array", entities);
    const records = entities.map((entity, index) => parseEntityRecord(entity, `entities[${index}]`));
    const indexById = new Map<number, number>();
    records.forEach((record, index) => {
        const previous = indexById.get(record.id);
        if (previous !== undefined) {
            throw new Error(`Scene document: entities[${index}].id ${record.id} repeats the id of entities[${previous}]`);
        }
        indexById.set(record.id, index);
    });
    return {format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: records};
}
