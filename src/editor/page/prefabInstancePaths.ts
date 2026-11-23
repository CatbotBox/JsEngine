import type {Entity} from "../../engine/core";
import {isSceneJsonObject} from "../../engine/scene/sceneDocument";
import type {SceneDocument, SceneEntityRecord} from "../../engine/scene";
import type {EditorEntitySummary} from "../editorProtocol";

export type SummaryLookup = (entity: Entity) => EditorEntitySummary | undefined;

export const PREFAB_INSTANCE_TYPE_NAME = "PrefabInstance";
export const PARENT_COMPONENT_TYPE_NAME = "Parent";
export const ROOT_INSTANCE_PATH = "";

const PATH_SEPARATOR = "/";
const FIELD_SEPARATOR = ".";
const PARENT_ENTITY_KEY = "entity";

export function prefabInstanceRootOf(entity: Entity, summaryOf: SummaryLookup): Entity | undefined {
    const visited = new Set<Entity>();
    for (let summary = summaryOf(entity); summary !== undefined && !visited.has(summary.entity); summary = summary.parent === null ? undefined : summaryOf(summary.parent)) {
        if (summary.prefabSourcePath !== null) return summary.entity;
        visited.add(summary.entity);
    }
    return undefined;
}

export function pathWithinInstance(entity: Entity, root: Entity, summaryOf: SummaryLookup): string | undefined {
    const indices: number[] = [];
    const visited = new Set<Entity>();
    let current = summaryOf(entity);
    while (current !== undefined && current.entity !== root) {
        if (visited.has(current.entity) || current.parent === null) return undefined;
        visited.add(current.entity);
        indices.unshift(current.siblingIndex);
        current = summaryOf(current.parent);
    }
    return current === undefined ? undefined : indices.join(PATH_SEPARATOR);
}

export function componentOverridePath(entityPath: string, typeName: string): string {
    return `${entityPath}${PATH_SEPARATOR}${typeName}`;
}

export function fieldOverridePath(entityPath: string, typeName: string, key: string): string {
    return `${componentOverridePath(entityPath, typeName)}${FIELD_SEPARATOR}${key}`;
}

export function overriddenFieldKeys(overrides: readonly string[], entityPath: string, typeName: string): Set<string> {
    const prefix = `${componentOverridePath(entityPath, typeName)}${FIELD_SEPARATOR}`;
    return new Set(overrides.filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length)));
}

export function isComponentOverridden(overrides: readonly string[], entityPath: string, typeName: string): boolean {
    return overrides.includes(componentOverridePath(entityPath, typeName));
}

function parentIdOf(record: SceneEntityRecord): number | undefined {
    const link = record.components[PARENT_COMPONENT_TYPE_NAME];
    if (!isSceneJsonObject(link)) return undefined;
    const id = link[PARENT_ENTITY_KEY];
    return typeof id === "number" ? id : undefined;
}

export function documentRootCount(document: SceneDocument): number {
    const ids = new Set(document.entities.map(record => record.id));
    return document.entities.filter(record => {
        const parentId = parentIdOf(record);
        return parentId === undefined || parentId === record.id || !ids.has(parentId);
    }).length;
}

export function withoutPrefabInstances(document: SceneDocument): SceneDocument {
    return {
        ...document,
        entities: document.entities.map(record => {
            if (!(PREFAB_INSTANCE_TYPE_NAME in record.components)) return record;
            const components = {...record.components};
            delete components[PREFAB_INSTANCE_TYPE_NAME];
            return {...record, components};
        }),
    };
}
