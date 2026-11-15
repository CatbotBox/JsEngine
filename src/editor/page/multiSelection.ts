import {sceneJsonEquals} from "../../engine/scene/sceneDocument";
import type {SceneJsonValue} from "../../engine/scene";
import type {EditorComponentDetails, EditorEntityDetails, EditorFieldValue} from "../editorProtocol";

export interface SharedComponent {
    readonly typeName: string;
    readonly inspectable: boolean;
    readonly inferred: boolean;
    readonly perEntity: readonly EditorComponentDetails[];
}

export type MixedValue =
    | {readonly mixed: false, readonly value: EditorFieldValue}
    | {readonly mixed: true, readonly first: EditorFieldValue};

export function sharedComponents(details: readonly EditorEntityDetails[]): SharedComponent[] {
    const first = details[0];
    if (first === undefined) return [];
    const shared: SharedComponent[] = [];
    for (const component of first.components) {
        const perEntity = details.map(entity => entity.components.find(candidate => candidate.typeName === component.typeName));
        if (perEntity.some(found => found === undefined)) continue;
        const present = perEntity as EditorComponentDetails[];
        shared.push({
            typeName: component.typeName,
            inspectable: present.every(found => found.inspectable),
            inferred: present.some(found => found.inferred),
            perEntity: present,
        });
    }
    return shared;
}

export function fieldValuesOf(component: SharedComponent, key: string): EditorFieldValue[] {
    return component.perEntity.map(details => details.fields[key]).filter((value): value is EditorFieldValue => value !== undefined);
}

export function fieldValuesEqual(a: EditorFieldValue, b: EditorFieldValue): boolean {
    return sceneJsonEquals(a as SceneJsonValue, b as SceneJsonValue);
}

export function mixedValueOf(values: readonly EditorFieldValue[]): MixedValue | undefined {
    const first = values[0];
    if (first === undefined) return undefined;
    return values.every(value => fieldValuesEqual(value, first)) ? {mixed: false, value: first} : {mixed: true, first};
}

export function componentOfIndex(values: readonly EditorFieldValue[], index: number): EditorFieldValue[] {
    return values.map(value => Array.isArray(value) ? value[index] ?? null : null);
}

export function sharedBoolean(values: readonly boolean[]): boolean | undefined {
    const first = values[0];
    return first !== undefined && values.every(value => value === first) ? first : undefined;
}

export function missingInSome(details: readonly EditorEntityDetails[], typeName: string): boolean {
    return details.some(entity => !entity.components.some(component => component.typeName === typeName));
}
