import {ENGINE_COMPONENT_CATEGORIES} from "../../engine/scene/componentCategories";
import type {EditorComponentDescription} from "../editorProtocol";

export const HIDDEN_COMPONENT_CATEGORIES: ReadonlySet<string> = new Set([ENGINE_COMPONENT_CATEGORIES.scene]);

export function isHiddenComponent(schema: Pick<EditorComponentDescription, "category"> | undefined): boolean {
    return schema !== undefined && HIDDEN_COMPONENT_CATEGORIES.has(schema.category);
}
