import type {Resource} from "../core";
import type {AssetType} from "./assetTypes";
import type {ResourceSchema} from "./fieldSchema";
import {describeJson, isSceneJsonObject} from "./sceneDocument";
import type {SceneFieldValues} from "./sceneDocument";

export const DATA_ASSET_FORMAT = "jsengine-asset";
export const DATA_ASSET_VERSION = 1;
export const DATA_ASSET_FILE_SUFFIX = ".asset.json";

const DATA_ASSET_FILE_SUFFIXES: readonly string[] = [DATA_ASSET_FILE_SUFFIX];
const DATA_ASSET_TEXT_INDENT_SPACES = 2;
const DATA_ASSET_TEXT_END = "\n";

export interface DataAssetDocument {
    format: typeof DATA_ASSET_FORMAT;
    version: typeof DATA_ASSET_VERSION;
    type: string;
    fields: SceneFieldValues;
}

const sourcePathByDataAsset = new WeakMap<object, string>();

export function dataAssetPathOf(asset: object): string | undefined {
    return sourcePathByDataAsset.get(asset);
}

export function rememberDataAssetPath(asset: Resource, path: string): void {
    sourcePathByDataAsset.set(asset, path);
}

function documentLabel(path: string | undefined): string {
    return path === undefined ? "Data asset" : `Data asset "${path}"`;
}

function documentError(path: string | undefined, key: string, expectation: string, actual: unknown): Error {
    return new Error(`${documentLabel(path)}: ${key} must be ${expectation}, got ${describeJson(actual)}`);
}

export function parseDataAssetDocument(source: unknown, path?: string): DataAssetDocument {
    let value: unknown;
    try {
        value = typeof source === "string" ? JSON.parse(source) as unknown : source;
    } catch (error) {
        throw new Error(`${documentLabel(path)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isSceneJsonObject(value)) throw documentError(path, "the document", "an object", value);
    if (value.format !== DATA_ASSET_FORMAT) throw documentError(path, "format", JSON.stringify(DATA_ASSET_FORMAT), value.format);
    const version = value.version;
    if (typeof version !== "number" || !Number.isSafeInteger(version) || version < DATA_ASSET_VERSION) {
        throw documentError(path, "version", `a whole number >= ${DATA_ASSET_VERSION}`, version);
    }
    if (version > DATA_ASSET_VERSION) {
        throw new Error(`${documentLabel(path)}: version ${version} is newer than the supported version ${DATA_ASSET_VERSION}`);
    }
    const type = value.type;
    if (typeof type !== "string" || type.length === 0) throw documentError(path, "type", "a resource type name", type);
    const fields = value.fields ?? {};
    if (!isSceneJsonObject(fields)) throw documentError(path, "fields", "an object of field values", fields);
    return {format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION, type, fields};
}

export function dataAssetDocumentText(document: DataAssetDocument): string {
    return JSON.stringify(document, null, DATA_ASSET_TEXT_INDENT_SPACES) + DATA_ASSET_TEXT_END;
}

export function newDataAssetDocument(type: string, fields: SceneFieldValues): DataAssetDocument {
    return {format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION, type, fields};
}

export function dataAssetType(schema: ResourceSchema): AssetType<Resource> {
    return {
        name: schema.name,
        valueName: schema.name,
        fileSuffixes: DATA_ASSET_FILE_SUFFIXES,
        isAsset: (value): value is Resource => value instanceof schema.ctor,
        load: (path, loader) => loader.loadDataAsset(path, schema.ctor),
        pathOf: asset => dataAssetPathOf(asset),
    };
}
