import {describe, expect, test} from "../../engine/testing/harness";
import {Component, NULL_ENTITY} from "../../engine/core";
import type {Entity} from "../../engine/core";
import {componentSchema, ComponentSchemaRegistry, registerEngineComponentSchemas, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "../../engine/scene";
import type {SceneDocument, SceneEntityRecord} from "../../engine/scene";
import {diffPrefabOverrides, documentTree, subtreeDocument} from "./prefabOverrides";

const TENTH = 0.1;

class Aim extends Component {
    public static readonly schema = componentSchema(Aim, "Aim").entity("target").build();
    public target: Entity = NULL_ENTITY;
}

function document(entities: SceneEntityRecord[]): SceneDocument {
    return {format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities};
}

function prefab(): SceneDocument {
    return document([
        {id: 1, name: "Enemy", enabled: true, components: {LocalPosition: {xyz: [0, 0, 0]}, Camera: {nearPlaneDistance: TENTH, farPlaneDistance: 100}}},
        {id: 2, name: "Gun", enabled: true, components: {LocalPosition: {xyz: [1, 0, 0]}, Parent: {entity: 1}}},
        {id: 3, name: "Shield", enabled: true, components: {LocalPosition: {xyz: [0, 1, 0]}, Parent: {entity: 1}}},
        {id: 4, name: "Barrel", enabled: true, components: {LocalScale: {xyz: [1, 1, 1]}, Parent: {entity: 2}}},
    ]);
}

function edited(edit: (entities: SceneEntityRecord[]) => void): SceneDocument {
    const copy = JSON.parse(JSON.stringify(prefab())) as SceneDocument;
    edit(copy.entities);
    return copy;
}

function registry(): ComponentSchemaRegistry {
    const result = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(result);
    result.registerComponentClass(Aim);
    return result;
}

describe("diffPrefabOverrides", () => {
    test("an instance equal to its prefab has no overrides, whatever its root name, position, rotation, parent and PrefabInstance", () => {
        const instance = edited(entities => {
            entities[0].name = "Enemy (2)";
            entities[0].components.LocalPosition = {xyz: [9, 9, 9]};
            entities[0].components.LocalRotation = {xyzw: [0, 0, 1, 0]};
            entities[0].components.Parent = {entity: null};
            entities[0].components.PrefabInstance = {sourcePath: "enemy.prefab.json", overrides: []};
        });
        expect(diffPrefabOverrides(prefab(), instance)).toEqual([]);
    });

    test("changed fields are listed by child path, type and key; float32 rounding is not a change", () => {
        const instance = edited(entities => {
            entities[1].components.LocalPosition = {xyz: [5, 0, 0]};
            entities[3].components.LocalScale = {xyz: [2, 1, 1]};
            entities[0].components.Camera = {nearPlaneDistance: Math.fround(TENTH), farPlaneDistance: 50};
        });
        expect(diffPrefabOverrides(prefab(), instance)).toEqual(["/Camera.farPlaneDistance", "0/LocalPosition.xyz", "0/0/LocalScale.xyz"]);
    });

    test("added and removed components, children, names and enabled states are listed", () => {
        const instance = edited(entities => {
            entities[1].name = "Big Gun";
            entities[0].enabled = false;
            delete entities[2].components.LocalPosition;
            entities[3].components.FieldOfView = {radians: 1};
            entities.push({id: 5, name: "Scope", enabled: true, components: {Parent: {entity: 1}}});
        });
        expect(diffPrefabOverrides(prefab(), instance)).toEqual(["/@enabled", "0/@name", "0/0/FieldOfView", "1/LocalPosition", "2"]);
        const withoutShield = edited(entities => {
            entities.splice(2, 1);
        });
        expect(diffPrefabOverrides(prefab(), withoutShield)).toEqual(["1"]);
    });

    test("sibling order comes from siblingIndex, not record order", () => {
        const swapped = edited(entities => {
            entities[1].siblingIndex = 1;
            entities[2].siblingIndex = 0;
        });
        expect(documentTree(swapped).childrenOf(0)).toEqual([2, 1]);
        expect(diffPrefabOverrides(prefab(), swapped)).toEqual(["0/@name", "0/LocalPosition.xyz", "0/0", "1/@name", "1/LocalPosition.xyz", "1/0"]);
    });

    test("with a registry, entity fields compare the entities they point at, not their scene ids", () => {
        const aimed = edited(entities => {
            entities[0].components.Aim = {target: 3};
        });
        const reordered = document([
            {id: 1, name: "Enemy", enabled: true, components: {LocalPosition: {xyz: [0, 0, 0]}, Camera: {nearPlaneDistance: TENTH, farPlaneDistance: 100}, Aim: {target: 2}}},
            {id: 2, name: "Shield", enabled: true, siblingIndex: 1, components: {LocalPosition: {xyz: [0, 1, 0]}, Parent: {entity: 1}}},
            {id: 3, name: "Gun", enabled: true, siblingIndex: 0, components: {LocalPosition: {xyz: [1, 0, 0]}, Parent: {entity: 1}}},
            {id: 4, name: "Barrel", enabled: true, components: {LocalScale: {xyz: [1, 1, 1]}, Parent: {entity: 3}}},
        ]);
        expect(diffPrefabOverrides(aimed, reordered, registry())).toEqual([]);
        expect(diffPrefabOverrides(aimed, reordered)).toEqual(["/Aim.target"]);
    });

    test("subtreeDocument keeps one child and its descendants and drops the root's Parent", () => {
        const gun = subtreeDocument(prefab(), 1);
        expect(gun.entities.map(record => record.name)).toEqual(["Gun", "Barrel"]);
        expect(gun.entities[0].components.Parent).toBeUndefined();
        expect(gun.entities[1].components.Parent).toEqual({entity: 2});
    });
});
