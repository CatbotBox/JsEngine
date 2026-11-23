import {ENGINE_COMPONENT_CATEGORIES} from "../../engine/scene/componentCategories";
import type {EditorComponentDescription, EditorResourceDescription} from "../editorProtocol";

export const HIDDEN_SCHEMA_CATEGORIES: ReadonlySet<string> = new Set([ENGINE_COMPONENT_CATEGORIES.scene]);

function isHiddenCategory(category: string | undefined): boolean {
    return category !== undefined && HIDDEN_SCHEMA_CATEGORIES.has(category);
}

export function isHiddenComponent(schema: Pick<EditorComponentDescription, "category"> | undefined): boolean {
    return isHiddenCategory(schema?.category);
}

export function isHiddenResource(schema: Pick<EditorResourceDescription, "category"> | undefined): boolean {
    return isHiddenCategory(schema?.category);
}
