import {describe, expect, test} from "../../engine/testing/harness";
import type {Entity} from "../../engine/core";
import {parseSceneDocument} from "../../engine/scene/sceneDocument";
import type {EditorComponentDetails, EditorEntityDetails, EditorEntitySummary} from "../editorProtocol";
import {componentOfIndex, fieldValuesOf, missingInSome, mixedValueOf, sharedBoolean, sharedComponents} from "./multiSelection";
import {
    documentRootCount,
    fieldOverridePath,
    isComponentOverridden,
    overriddenFieldKeys,
    pathWithinInstance,
    prefabInstanceRootOf,
    withoutPrefabInstances,
} from "./prefabInstancePaths";

const SCENE_ID = 1;

function component(typeName: string, fields: EditorComponentDetails["fields"]): EditorComponentDetails {
    return {typeName, inspectable: true, inferred: false, fields};
}

function details(entity: number, components: readonly EditorComponentDetails[]): EditorEntityDetails {
    return {entity: entity as Entity, name: null, enabled: true, parent: null, siblingIndex: 0, prefabSourcePath: null, components};
}

describe("multi-selection", () => {
    const first = details(1, [component("LocalPosition", {xyz: [0, 1, 2]}), component("Sprite", {opacity: 1}), component("Spin", {speed: 2})]);
    const second = details(2, [component("Spin", {speed: 3}), component("LocalPosition", {xyz: [0, 5, 2]})]);

    test("only components every selected entity has are shown, in the first entity's order", () => {
        const shared = sharedComponents([first, second]);
        expect(shared.map(entry => entry.typeName)).toEqual(["LocalPosition", "Spin"]);
        expect(fieldValuesOf(shared[1], "speed")).toEqual([2, 3]);
        expect(sharedComponents([])).toEqual([]);
        expect(missingInSome([first, second], "Sprite")).toBe(true);
        expect(missingInSome([first, second], "Spin")).toBe(false);
    });

    test("equal values show as one value, differing ones as mixed", () => {
        expect(mixedValueOf([1, 1])).toEqual({mixed: false, value: 1});
        expect(mixedValueOf([1, 2])).toEqual({mixed: true, first: 1});
        expect(mixedValueOf([[0, 1, 2], [0, 1, 2]])).toEqual({mixed: false, value: [0, 1, 2]});
        expect(mixedValueOf([])).toBeUndefined();
    });

    test("a vector component is compared on its own, so equal axes stay editable as one value", () => {
        const values = fieldValuesOf(sharedComponents([first, second])[0], "xyz");
        expect(mixedValueOf(componentOfIndex(values, 0))).toEqual({mixed: false, value: 0});
        expect(mixedValueOf(componentOfIndex(values, 1))).toEqual({mixed: true, first: 1});
    });

    test("booleans are shared only when all agree", () => {
        expect(sharedBoolean([true, true])).toBe(true);
        expect(sharedBoolean([true, false])).toBeUndefined();
    });
});

function summary(entity: number, parent: number | null, siblingIndex: number, prefabSourcePath: string | null = null): EditorEntitySummary {
    return {entity: entity as Entity, name: null, enabled: true, parent: parent as Entity | null, siblingIndex, prefabSourcePath, componentTypeNames: [], sceneId: SCENE_ID};
}

describe("prefab instance paths", () => {
    const summaries = new Map([
        summary(1, null, 0, "prefabs/ship.prefab.json"),
        summary(2, 1, 0),
        summary(3, 1, 1),
        summary(4, 3, 0),
        summary(5, null, 1),
    ].map(entry => [entry.entity, entry]));
    const lookup = (entity: Entity) => summaries.get(entity);

    test("the instance root is the nearest ancestor that carries a prefab source", () => {
        expect(prefabInstanceRootOf(4 as Entity, lookup)).toBe(1);
        expect(prefabInstanceRootOf(1 as Entity, lookup)).toBe(1);
        expect(prefabInstanceRootOf(5 as Entity, lookup)).toBeUndefined();
    });

    test("an entity's path inside the instance is its chain of sibling indices", () => {
        expect(pathWithinInstance(1 as Entity, 1 as Entity, lookup)).toBe("");
        expect(pathWithinInstance(3 as Entity, 1 as Entity, lookup)).toBe("1");
        expect(pathWithinInstance(4 as Entity, 1 as Entity, lookup)).toBe("1/0");
        expect(pathWithinInstance(5 as Entity, 1 as Entity, lookup)).toBeUndefined();
    });

    test("override paths name fields and whole components", () => {
        const overrides = ["/Sprite.tint", "1/0/LocalPosition.xyz", "1/0/Spin"];
        expect(fieldOverridePath("1/0", "LocalPosition", "xyz")).toBe("1/0/LocalPosition.xyz");
        expect([...overriddenFieldKeys(overrides, "", "Sprite")]).toEqual(["tint"]);
        expect([...overriddenFieldKeys(overrides, "1/0", "LocalPosition")]).toEqual(["xyz"]);
        expect(isComponentOverridden(overrides, "1/0", "Spin")).toBe(true);
        expect(isComponentOverridden(overrides, "", "Spin")).toBe(false);
    });

    test("a prefab document counts its roots and drops instance data", () => {
        const document = parseSceneDocument({
            format: "jsengine-scene",
            version: 1,
            entities: [
                {id: 1, name: "ship", enabled: true, components: {PrefabInstance: {sourcePath: "a", overrides: []}}},
                {id: 2, name: "gun", enabled: true, components: {Parent: {entity: 1}}},
            ],
        });
        expect(documentRootCount(document)).toBe(1);
        const stripped = withoutPrefabInstances(document);
        expect(Object.keys(stripped.entities[0].components)).toEqual([]);
        expect(stripped.entities[1]).toBe(document.entities[1]);
    });
});
