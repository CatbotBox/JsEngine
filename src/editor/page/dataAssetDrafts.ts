import {DATA_ASSET_FILE_SUFFIX, dataAssetDocumentText, newDataAssetDocument, parseDataAssetDocument} from "../../engine/scene/dataAssetDocument";
import {isSceneJsonObject, sceneJsonEquals} from "../../engine/scene/sceneDocument";
import type {SceneJsonObject, SceneJsonValue} from "../../engine/scene";
import type {EditorFieldDescription, EditorFieldTypeDescription, EditorResourceDescription} from "../editorProtocol";
import {projectRelativePath} from "../../engine/project/projectPaths";

export interface DataAssetFieldChanges {
    readonly addedKeys: readonly string[];
    readonly removedKeys: readonly string[];
}

export interface DataAssetDraft {
    readonly path: string;
    readonly type: string;
    readonly savedFields: SceneJsonObject;
    readonly fields: SceneJsonObject;
    readonly changes: DataAssetFieldChanges;
}

export interface DataAssetListing {
    readonly path: string;
    readonly type: string | undefined;
}

export interface DataAssetGroup {
    readonly type: string | undefined;
    readonly paths: readonly string[];
}

const NO_CHANGES: DataAssetFieldChanges = {addedKeys: [], removedKeys: []};
const MEMBER_SEPARATOR = ".";
const KEY_SEPARATOR = ", ";
const NO_VALUE: SceneJsonValue = null;

function byName(a: string, b: string): number {
    return a.localeCompare(b, undefined, {sensitivity: "base", numeric: true});
}

function collectChanges(fields: readonly EditorFieldDescription[], values: SceneJsonObject, prefix: string, added: string[], removed: string[]): void {
    for (const key of Object.keys(values)) {
        if (!fields.some(field => field.key === key)) removed.push(prefix + key);
    }
    for (const field of fields) {
        const value = values[field.key];
        if (value === undefined) added.push(prefix + field.key);
        else collectNestedChanges(field, value, `${prefix}${field.key}`, added, removed);
    }
}

function collectNestedChanges(type: EditorFieldTypeDescription, value: SceneJsonValue, path: string, added: string[], removed: string[]): void {
    if (type.kind === "struct" && isSceneJsonObject(value)) collectChanges(type.fields, value, path + MEMBER_SEPARATOR, added, removed);
    else if (type.kind === "list" && Array.isArray(value)) value.forEach((item, index) => collectNestedChanges(type.element, item, `${path}[${index}]`, added, removed));
}

export function dataAssetFieldChanges(fields: readonly EditorFieldDescription[], values: SceneJsonObject): DataAssetFieldChanges {
    const addedKeys: string[] = [];
    const removedKeys: string[] = [];
    collectChanges(fields, values, "", addedKeys, removedKeys);
    return addedKeys.length === 0 && removedKeys.length === 0 ? NO_CHANGES : {addedKeys, removedKeys};
}

export function hasFieldChanges(changes: DataAssetFieldChanges): boolean {
    return changes.addedKeys.length > 0 || changes.removedKeys.length > 0;
}

export function describeFieldChanges(type: string, changes: DataAssetFieldChanges): string {
    const parts: string[] = [];
    if (changes.addedKeys.length > 0) parts.push(`new fields ${changes.addedKeys.join(KEY_SEPARATOR)} show their defaults`);
    if (changes.removedKeys.length > 0) parts.push(`fields ${changes.removedKeys.join(KEY_SEPARATOR)} are no longer in the schema and are dropped on save`);
    return `This file was written for an older ${type}: ${parts.join("; ")}.`;
}

export function holdsEntityFields(fields: readonly EditorFieldTypeDescription[]): boolean {
    return fields.some(field => {
        switch (field.kind) {
            case "entity":
                return true;
            case "list":
                return holdsEntityFields([field.element]);
            case "struct":
                return holdsEntityFields(field.fields);
            default:
                return false;
        }
    });
}

export function isCreatableDataAssetType(description: EditorResourceDescription | undefined): boolean {
    return description !== undefined && !holdsEntityFields(description.fields);
}

export function knownFields(description: EditorResourceDescription, values: SceneJsonObject, defaults: SceneJsonObject): SceneJsonObject {
    const known: SceneJsonObject = {};
    for (const field of description.fields) known[field.key] = values[field.key] ?? defaults[field.key] ?? NO_VALUE;
    return known;
}

export function openDataAssetDraft(path: string, text: string, description: EditorResourceDescription | undefined, defaults: SceneJsonObject): DataAssetDraft {
    const document = parseDataAssetDocument(text, path);
    if (description === undefined) return {path, type: document.type, savedFields: document.fields, fields: document.fields, changes: NO_CHANGES};
    const changes = dataAssetFieldChanges(description.fields, document.fields);
    const fields = knownFields(description, document.fields, defaults);
    return {path, type: document.type, savedFields: fields, fields, changes};
}

export function withDraftField(draft: DataAssetDraft, key: string, value: SceneJsonValue): DataAssetDraft {
    return {...draft, fields: {...draft.fields, [key]: value}};
}

export function isDraftDirty(draft: DataAssetDraft): boolean {
    return !sceneJsonEquals(draft.fields, draft.savedFields);
}

export function savedDraft(draft: DataAssetDraft, savedFields: SceneJsonObject): DataAssetDraft {
    return {...draft, savedFields, changes: NO_CHANGES};
}

export function dataAssetText(type: string, fields: SceneJsonObject): string {
    return dataAssetDocumentText(newDataAssetDocument(type, fields));
}

export function dataAssetPathProblem(path: string, existing: ReadonlySet<string>): string | undefined {
    const relative = projectRelativePath(path.trim());
    if (relative === undefined) return "Give a path inside the project folder, such as assets/tuning.asset.json";
    if (!relative.toLowerCase().endsWith(DATA_ASSET_FILE_SUFFIX)) return `A data asset file name ends with ${DATA_ASSET_FILE_SUFFIX}`;
    if (existing.has(relative)) return `${relative} already exists`;
    return undefined;
}

export function groupDataAssetsByType(listings: readonly DataAssetListing[]): DataAssetGroup[] {
    const byType = new Map<string | undefined, string[]>();
    for (const listing of listings) {
        let paths = byType.get(listing.type);
        if (paths === undefined) byType.set(listing.type, paths = []);
        paths.push(listing.path);
    }
    const typed = [...byType.keys()].filter((type): type is string => type !== undefined).sort(byName);
    const groups: DataAssetGroup[] = typed.map(type => ({type, paths: [...byType.get(type)!].sort(byName)}));
    const untyped = byType.get(undefined);
    if (untyped !== undefined) groups.push({type: undefined, paths: [...untyped].sort(byName)});
    return groups;
}
