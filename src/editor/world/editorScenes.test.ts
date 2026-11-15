import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import type {Entity, World} from "../../engine/core";
import {LocalPosition} from "../../engine/translation/localPosition";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import {Parent} from "../../engine/translation/parent";
import {EditorOnly, parseSceneDocument, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION, SceneManager} from "../../engine/scene";
import {ask, byName, childrenOf, disposeEditorWorlds, editorWorld} from "./editorServiceTestHarness";
import type {Harnessed} from "./editorServiceTestHarness";
import {linkChild} from "./hierarchyEditing";

const LEVEL_PATH = "scenes/level.scene.json";
const OTHER_PATH = "scenes/other.scene.json";
const ENEMY_PREFAB = "prefabs/enemy.prefab.json";
const MEMBERSHIP_NAMES = ["SceneInstance", "ActiveScene"];

const LEVEL_TEXT = JSON.stringify({
    format: SCENE_DOCUMENT_FORMAT,
    version: SCENE_DOCUMENT_VERSION,
    entities: [
        {id: 1, name: "Level", enabled: true, components: {LocalPosition: {xyz: [0, 0, 0]}}},
        {id: 2, name: "Door", enabled: true, components: {LocalPosition: {xyz: [1, 0, 0]}, Parent: {entity: 1}}},
    ],
}, null, 2);

const OTHER_TEXT = JSON.stringify({
    format: SCENE_DOCUMENT_FORMAT,
    version: SCENE_DOCUMENT_VERSION,
    entities: [{id: 1, name: "Elsewhere", enabled: true, components: {LocalPosition: {xyz: [0, 0, 0]}}}],
});

afterEach(disposeEditorWorlds);

function scenesOf(harnessed: Harnessed): SceneManager {
    return new SceneManager(harnessed.world, harnessed.registry);
}

function mentionsMembership(text: string): boolean {
    return MEMBERSHIP_NAMES.some(name => text.includes(name));
}

async function entityNames(harnessed: Harnessed): Promise<(string | null)[]> {
    return (await ask(harnessed, {op: "listEntities"})).entities.map(entity => entity.name);
}

async function componentNames(harnessed: Harnessed, entity: Entity): Promise<string[]> {
    return (await ask(harnessed, {op: "getEntity", entity})).components.map(component => component.typeName);
}

function enemy(world: World): Entity {
    const em = world.entityManager;
    const root = em.createEntity("Enemy", [new LocalPosition(0, 0, 0), new LocalToWorld()]);
    const gun = em.createEntity("Gun", [new LocalPosition(1, 0, 0), new LocalToWorld(), new Parent(root)]);
    linkChild(world, gun, root);
    return root;
}

describe("editor scenes", () => {
    test("loadScene replaces code-created entities, keeps EditorOnly ones and makes the file the active scene", async () => {
        let gizmo = 0 as Entity;
        const harnessed = editorWorld(world => {
            world.entityManager.createEntity("codeMade", [new LocalPosition(), new LocalToWorld()]);
            gizmo = world.entityManager.createEntity("gizmo", [new LocalPosition(), new EditorOnly()]);
        });

        const loaded = await ask(harnessed, {op: "loadScene", sceneText: LEVEL_TEXT, path: LEVEL_PATH});
        expect(loaded.entityCount).toBe(2);
        expect(await entityNames(harnessed)).toEqual(["Level", "Door"]);
        expect(harnessed.world.entityManager.exists(gizmo)).toBe(true);
        const scenes = scenesOf(harnessed);
        expect(scenes.loaded().map(handle => handle.path)).toEqual([LEVEL_PATH]);
        expect(scenes.active()?.path).toBe(LEVEL_PATH);
        expect(scenes.sceneOf(gizmo)).toBeUndefined();
    });

    test("saveScene leaves scene membership out of the file", async () => {
        const harnessed = editorWorld();
        await ask(harnessed, {op: "loadScene", sceneText: LEVEL_TEXT, path: LEVEL_PATH});
        const level = byName((await ask(harnessed, {op: "listEntities"})).entities, "Level")!.entity;
        expect((await componentNames(harnessed, level)).includes("SceneInstance")).toBe(true);

        const saved = await ask(harnessed, {op: "saveScene"});
        expect(mentionsMembership(saved.sceneText)).toBe(false);
        expect(saved.sceneText).toBe(LEVEL_TEXT);
    });

    test("play then stop keeps scene membership after the game switched scenes, and roots made while editing join the open scene", async () => {
        const harnessed = editorWorld();
        await ask(harnessed, {op: "loadScene", sceneText: LEVEL_TEXT, path: LEVEL_PATH});
        const added = (await ask(harnessed, {op: "createEntity", name: "Added"})).entity;
        const scenes = scenesOf(harnessed);
        expect(scenes.sceneOf(added)).toBeUndefined();

        await ask(harnessed, {op: "setMode", mode: "play"});
        expect(scenes.sceneOf(added)?.path).toBe(LEVEL_PATH);
        scenes.loadDocument(parseSceneDocument(OTHER_TEXT), {path: OTHER_PATH});
        expect(await entityNames(harnessed)).toEqual(["Elsewhere"]);
        expect(scenes.active()?.path).toBe(OTHER_PATH);

        await ask(harnessed, {op: "setMode", mode: "edit"});
        const listed = (await ask(harnessed, {op: "listEntities"})).entities;
        expect(listed.map(entity => entity.name)).toEqual(["Level", "Door", "Added"]);
        expect(scenes.loaded().map(handle => handle.path)).toEqual([LEVEL_PATH]);
        expect(scenes.active()?.path).toBe(LEVEL_PATH);
        expect(listed.every(entity => scenes.sceneOf(entity.entity)?.path === LEVEL_PATH)).toBe(true);
        expect(mentionsMembership((await ask(harnessed, {op: "saveScene"})).sceneText)).toBe(false);
    });

    test("a prefab instance root in a scene counts no override for its membership and applies without it", async () => {
        let root = 0 as Entity;
        const harnessed = editorWorld(world => {
            root = enemy(world);
        });
        const {documentText} = await ask(harnessed, {op: "serializeEntities", entities: [root]});
        await ask(harnessed, {op: "destroyEntity", entity: root});
        await ask(harnessed, {op: "instantiateEntities", documentText, prefabSourcePath: ENEMY_PREFAB});
        const {sceneText} = await ask(harnessed, {op: "saveScene"});
        await ask(harnessed, {op: "loadScene", sceneText, path: LEVEL_PATH});
        const instance = byName((await ask(harnessed, {op: "listEntities"})).entities, "Enemy")!.entity;
        const gun = childrenOf(harnessed.world, instance)[0];
        expect((await componentNames(harnessed, instance)).includes("SceneInstance")).toBe(true);

        await ask(harnessed, {op: "setField", entity: gun, typeName: "LocalPosition", key: "xyz", value: [5, 0, 0]});
        expect((await ask(harnessed, {op: "getPrefabOverrides", entity: instance})).overrides).toEqual(["0/LocalPosition.xyz"]);
        const applied = await ask(harnessed, {op: "applyPrefabInstance", entity: instance});
        expect(mentionsMembership(applied.documentText)).toBe(false);
        expect((await ask(harnessed, {op: "revertPrefabInstance", entity: instance})).overrides).toEqual([]);
        expect((await componentNames(harnessed, instance)).includes("SceneInstance")).toBe(true);
    });
});
