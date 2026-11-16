import {isSceneJsonObject, PARENT_COMPONENT_NAME, PARENT_ENTITY_KEY, refersToEntities, SCENE_INSTANCE_COMPONENT_NAME} from "../../engine/scene";
import type {ComponentSchemaRegistry, FieldType, SceneDocument, SceneEntityRecord, SceneFieldValues, SceneJsonObject, SceneJsonValue} from "../../engine/scene";

export const PREFAB_INSTANCE_COMPONENT_NAME = "PrefabInstance";
export const ROOT_DEFAULT_OVERRIDE_TYPES: readonly string[] = ["LocalPosition", "LocalRotation"];
export const ENTITY_NAME_PROPERTY = "@name";
export const ENTITY_ENABLED_PROPERTY = "@enabled";
export const ROOT_ENTITY_PATH = "";

const PATH_SEPARATOR = "/";
const FIELD_SEPARATOR = ".";
const UNORDERED_SIBLING = Number.POSITIVE_INFINITY;
const OUTSIDE_REFERENCE = "<outside>";

export interface DocumentTree {
    readonly roots: readonly number[];
    readonly indexById: ReadonlyMap<number, number>;

    childrenOf(index: number): readonly number[];
}

const NO_CHILDREN: readonly number[] = [];

export function parentIdOf(record: SceneEntityRecord): number | undefined {
    const link = record.components[PARENT_COMPONENT_NAME];
    if (!isSceneJsonObject(link)) return undefined;
    const id = link[PARENT_ENTITY_KEY];
    return typeof id === "number" ? id : undefined;
}

export function documentTree(document: SceneDocument): DocumentTree {
    const indexById = new Map<number, number>();
    document.entities.forEach((record, index) => indexById.set(record.id, index));
    const children = new Map<number, number[]>();
    const roots: number[] = [];
    document.entities.forEach((record, index) => {
        const parentId = parentIdOf(record);
        const parentIndex = parentId === undefined ? undefined : indexById.get(parentId);
        if (parentIndex === undefined || parentIndex === index) {
            roots.push(index);
            return;
        }
        let siblings = children.get(parentIndex);
        if (siblings === undefined) children.set(parentIndex, siblings = []);
        siblings.push(index);
    });
    const rank = (index: number) => document.entities[index].siblingIndex ?? UNORDERED_SIBLING;
    const bySiblingOrder = (a: number, b: number) => (rank(a) - rank(b)) || (a - b);
    for (const siblings of children.values()) siblings.sort(bySiblingOrder);
    roots.sort(bySiblingOrder);
    return {roots, indexById, childrenOf: index => children.get(index) ?? NO_CHILDREN};
}

export function childEntityPath(parentPath: string, childIndex: number): string {
    return parentPath === ROOT_ENTITY_PATH ? `${childIndex}` : `${parentPath}${PATH_SEPARATOR}${childIndex}`;
}

export function componentOverridePath(entityPath: string, typeName: string): string {
    return `${entityPath}${PATH_SEPARATOR}${typeName}`;
}

export function fieldOverridePath(entityPath: string, typeName: string, key: string): string {
    return `${componentOverridePath(entityPath, typeName)}${FIELD_SEPARATOR}${key}`;
}

export function entityPropertyPath(entityPath: string, property: string): string {
    return `${entityPath}${PATH_SEPARATOR}${property}`;
}

export function entityPathsOf(document: SceneDocument, tree: DocumentTree = documentTree(document)): Map<number, string> {
    const paths = new Map<number, string>();
    const root = tree.roots[0];
    if (root === undefined) return paths;
    const visit = (index: number, path: string) => {
        if (paths.has(index)) return;
        paths.set(index, path);
        tree.childrenOf(index).forEach((child, childIndex) => visit(child, childEntityPath(path, childIndex)));
    };
    visit(root, ROOT_ENTITY_PATH);
    return paths;
}

export function isComparedComponent(typeName: string, isRoot: boolean): boolean {
    if (typeName === PARENT_COMPONENT_NAME || typeName === PREFAB_INSTANCE_COMPONENT_NAME || typeName === SCENE_INSTANCE_COMPONENT_NAME) return false;
    return !isRoot || !ROOT_DEFAULT_OVERRIDE_TYPES.includes(typeName);
}

function nearlyEqual(a: SceneJsonValue, b: SceneJsonValue): boolean {
    if (a === b) return true;
    if (typeof a === "number" && typeof b === "number") return Math.fround(a) === Math.fround(b);
    if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((element, index) => nearlyEqual(element, b[index]));
    if (!isSceneJsonObject(a) || !isSceneJsonObject(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every(key => b[key] !== undefined && nearlyEqual(a[key], b[key]));
}

class DocumentView {
    public readonly tree: DocumentTree;
    public readonly pathByIndex: Map<number, string>;

    public constructor(public readonly document: SceneDocument) {
        this.tree = documentTree(document);
        this.pathByIndex = entityPathsOf(document, this.tree);
    }

    public referencedPath(value: SceneJsonValue): SceneJsonValue {
        if (typeof value !== "number") return value;
        const index = this.tree.indexById.get(value);
        return index === undefined ? OUTSIDE_REFERENCE : this.pathByIndex.get(index) ?? OUTSIDE_REFERENCE;
    }

    public withReferencedPaths(type: FieldType, value: SceneJsonValue): SceneJsonValue {
        switch (type.kind) {
            case "entity":
                return this.referencedPath(value);
            case "list":
                return Array.isArray(value) ? value.map(element => this.withReferencedPaths(type.element, element)) : value;
            case "struct": {
                if (!isSceneJsonObject(value)) return value;
                const resolved: SceneJsonObject = {...value};
                for (const member of type.fields) {
                    const memberValue = value[member.key];
                    if (memberValue !== undefined && refersToEntities(member)) resolved[member.key] = this.withReferencedPaths(member, memberValue);
                }
                return resolved;
            }
            default:
                return value;
        }
    }
}

function fieldValuesDiffer(
    registry: ComponentSchemaRegistry | undefined,
    typeName: string,
    key: string,
    prefab: DocumentView,
    prefabValue: SceneJsonValue,
    instance: DocumentView,
    instanceValue: SceneJsonValue,
): boolean {
    const field = registry?.byName(typeName)?.fields.find(candidate => candidate.key === key);
    if (field !== undefined && refersToEntities(field)) {
        return !nearlyEqual(prefab.withReferencedPaths(field, prefabValue), instance.withReferencedPaths(field, instanceValue));
    }
    return !nearlyEqual(prefabValue, instanceValue);
}

function diffComponents(
    registry: ComponentSchemaRegistry | undefined,
    path: string,
    isRoot: boolean,
    prefab: DocumentView,
    prefabComponents: {readonly [typeName: string]: SceneFieldValues},
    instance: DocumentView,
    instanceComponents: {readonly [typeName: string]: SceneFieldValues},
    overrides: string[],
): void {
    const typeNames = [...Object.keys(instanceComponents), ...Object.keys(prefabComponents).filter(name => instanceComponents[name] === undefined)];
    for (const typeName of typeNames) {
        if (!isComparedComponent(typeName, isRoot)) continue;
        const prefabFields = prefabComponents[typeName];
        const instanceFields = instanceComponents[typeName];
        if (prefabFields === undefined || instanceFields === undefined) {
            overrides.push(componentOverridePath(path, typeName));
            continue;
        }
        const keys = [...Object.keys(instanceFields), ...Object.keys(prefabFields).filter(key => instanceFields[key] === undefined)];
        for (const key of keys) {
            const prefabValue = prefabFields[key], instanceValue = instanceFields[key];
            const differs = prefabValue === undefined || instanceValue === undefined
                || fieldValuesDiffer(registry, typeName, key, prefab, prefabValue, instance, instanceValue);
            if (differs) overrides.push(fieldOverridePath(path, typeName, key));
        }
    }
}

export function diffPrefabOverrides(prefabDocument: SceneDocument, instanceDocument: SceneDocument, registry?: ComponentSchemaRegistry): string[] {
    const prefab = new DocumentView(prefabDocument);
    const instance = new DocumentView(instanceDocument);
    const overrides: string[] = [];
    const visit = (prefabIndex: number | undefined, instanceIndex: number | undefined, path: string) => {
        if (prefabIndex === undefined || instanceIndex === undefined) {
            overrides.push(path);
            return;
        }
        const isRoot = path === ROOT_ENTITY_PATH;
        const prefabRecord = prefabDocument.entities[prefabIndex];
        const instanceRecord = instanceDocument.entities[instanceIndex];
        if (!isRoot && prefabRecord.name !== instanceRecord.name) overrides.push(entityPropertyPath(path, ENTITY_NAME_PROPERTY));
        if (prefabRecord.enabled !== instanceRecord.enabled) overrides.push(entityPropertyPath(path, ENTITY_ENABLED_PROPERTY));
        diffComponents(registry, path, isRoot, prefab, prefabRecord.components, instance, instanceRecord.components, overrides);
        const prefabChildren = prefab.tree.childrenOf(prefabIndex);
        const instanceChildren = instance.tree.childrenOf(instanceIndex);
        const count = Math.max(prefabChildren.length, instanceChildren.length);
        for (let child = 0; child < count; child++) visit(prefabChildren[child], instanceChildren[child], childEntityPath(path, child));
    };
    const prefabRoot = prefab.tree.roots[0];
    const instanceRoot = instance.tree.roots[0];
    if (prefabRoot === undefined || instanceRoot === undefined) return prefabRoot === instanceRoot ? [] : [ROOT_ENTITY_PATH];
    visit(prefabRoot, instanceRoot, ROOT_ENTITY_PATH);
    return overrides;
}

export function subtreeRecordIndices(document: SceneDocument, rootIndex: number): number[] {
    const tree = documentTree(document);
    const included = new Set<number>();
    const visit = (index: number) => {
        if (included.has(index)) return;
        included.add(index);
        for (const child of tree.childrenOf(index)) visit(child);
    };
    visit(rootIndex);
    return [...included].sort((a, b) => a - b);
}

export function subtreeDocument(document: SceneDocument, rootIndex: number): SceneDocument {
    const included = subtreeRecordIndices(document, rootIndex);
    const entities = included.map(index => {
        const record = document.entities[index];
        if (index !== rootIndex) return record;
        const components = {...record.components};
        delete components[PARENT_COMPONENT_NAME];
        return {id: record.id, name: record.name, enabled: record.enabled, components};
    });
    return {format: document.format, version: document.version, entities};
}
