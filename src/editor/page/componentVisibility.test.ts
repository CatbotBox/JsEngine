import {describe, expect, test} from "../../engine/testing/harness";
import {ENGINE_COMPONENT_CATEGORIES} from "../../engine/scene/componentCategories";
import type {EditorComponentDescription} from "../editorProtocol";
import {addableComponentGroups} from "./addComponentPopup";
import {isHiddenComponent} from "./componentVisibility";

function described(typeName: string, category: string): EditorComponentDescription {
    return {typeName, persistence: "fields", fields: [], inferred: false, category};
}

const SCENE_INSTANCE = described("SceneInstance", ENGINE_COMPONENT_CATEGORIES.scene);
const PREFAB_INSTANCE = described("PrefabInstance", ENGINE_COMPONENT_CATEGORIES.prefab);
const SHIP = described("Ship", "Game");

describe("component visibility", () => {
    test("scene membership is hidden by its category, other components are not", () => {
        expect(isHiddenComponent(SCENE_INSTANCE)).toBe(true);
        expect(isHiddenComponent(PREFAB_INSTANCE)).toBe(false);
        expect(isHiddenComponent(SHIP)).toBe(false);
        expect(isHiddenComponent(undefined)).toBe(false);
    });

    test("Add Component never offers a hidden component", () => {
        const groups = addableComponentGroups([SCENE_INSTANCE, PREFAB_INSTANCE, SHIP], new Set(), "");
        expect(groups.map(group => group.category)).toEqual(["Game", ENGINE_COMPONENT_CATEGORIES.prefab]);
        expect(addableComponentGroups([SCENE_INSTANCE], new Set(), "scene")).toEqual([]);
    });
});
