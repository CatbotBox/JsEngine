import {isSceneJsonObject} from "../../engine/scene/sceneDocument";
import type {SceneJsonObject, SceneJsonValue} from "../../engine/scene";
import type {EditorFieldValue} from "../editorProtocol";

export type MoveDirection = -1 | 1;

export const MOVE_UP: MoveDirection = -1;
export const MOVE_DOWN: MoveDirection = 1;
export const NOT_A_LIST = -1;

const EMPTY_LIST: readonly SceneJsonValue[] = [];
const EMPTY_OBJECT: SceneJsonObject = {};

function itemsOf(value: EditorFieldValue | undefined): readonly SceneJsonValue[] {
    return Array.isArray(value) ? value : EMPTY_LIST;
}

function membersOf(value: EditorFieldValue | undefined): SceneJsonObject {
    return isSceneJsonObject(value) ? value : EMPTY_OBJECT;
}

export function listLengthOf(value: EditorFieldValue | undefined): number {
    return Array.isArray(value) ? value.length : NOT_A_LIST;
}

export function sharedListLength(values: readonly EditorFieldValue[]): number | undefined {
    const first = values[0];
    if (first === undefined) return undefined;
    const length = listLengthOf(first);
    return length !== NOT_A_LIST && values.every(value => listLengthOf(value) === length) ? length : undefined;
}

export function listItemAt(value: EditorFieldValue | undefined, index: number): SceneJsonValue {
    return itemsOf(value)[index] ?? null;
}

export function withListItem(value: EditorFieldValue, index: number, item: SceneJsonValue): SceneJsonValue {
    const items = [...itemsOf(value)];
    if (index >= 0 && index < items.length) items[index] = item;
    return items;
}

export function withAppendedListItem(value: EditorFieldValue, item: SceneJsonValue): SceneJsonValue {
    return [...itemsOf(value), item];
}

export function withoutListItem(value: EditorFieldValue, index: number): SceneJsonValue {
    return itemsOf(value).filter((_, itemIndex) => itemIndex !== index);
}

export function canMoveListItem(length: number, index: number, direction: MoveDirection): boolean {
    const target = index + direction;
    return index >= 0 && index < length && target >= 0 && target < length;
}

export function withMovedListItem(value: EditorFieldValue, index: number, direction: MoveDirection): SceneJsonValue {
    const items = [...itemsOf(value)];
    if (!canMoveListItem(items.length, index, direction)) return items;
    const target = index + direction;
    [items[index], items[target]] = [items[target], items[index]];
    return items;
}

export function structMemberOf(value: EditorFieldValue | undefined, key: string): SceneJsonValue {
    return membersOf(value)[key] ?? null;
}

export function withStructMember(value: EditorFieldValue, key: string, member: SceneJsonValue): SceneJsonValue {
    return {...membersOf(value), [key]: member};
}

export function listItemPath(listPath: string, index: number): string {
    return `${listPath}[${index}]`;
}

export function structMemberPath(structPath: string, key: string): string {
    return `${structPath}.${key}`;
}

export function isListItemPath(path: string): boolean {
    return path.endsWith("]");
}
