import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import type {Entity, World} from "../../engine/core";
import {LocalPosition} from "../../engine/translation/localPosition";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import {Parent} from "../../engine/translation/parent";
import {EditorOnly, NO_SCENE_ID, parseSceneDocument, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION, SceneManager} from "../../engine/scene";
import {ask, byName, childrenOf, disposeEditorWorlds, editorWorld, failureOf} from "./editorServiceTestHarness";
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

const THIRD_PATH = "scenes/third.scene.json";
const STOP_FIRST_TEXT = "stop it first";
const RENAMED_PATH = "scenes/renamed.scene.json";
const EMPTY_TEXT = JSON.stringify({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: []});

function listing(harnessed: Harnessed) {
    return ask(harnessed, {op: "listEntities"});
}

async function sceneIdOfNamed(harnessed: Harnessed, name: string): Promise<number | undefined> {
    return byName((await listing(harnessed)).entities, name)?.sceneId;
}

async function openTwoScenes(harnessed: Harnessed): Promise<{readonly level: number, readonly other: number}> {
    const level = (await ask(harnessed, {op: "loadScene", sceneText: LEVEL_TEXT, path: LEVEL_PATH})).sceneId;
    const other = (await ask(harnessed, {op: "loadScene", sceneText: OTHER_TEXT, path: OTHER_PATH, additive: true})).sceneId;
    return {level, other};
}

describe("editor multi-scene editing", () => {
    test("an additive load keeps the open scene, lists both scenes and leaves the first one active", async () => {
        const harnessed = editorWorld();
        const {level, other} = await openTwoScenes(harnessed);
        const listed = await listing(harnessed);
        expect(level).not.toBe(other);
        expect(listed.entities.map(entity => entity.name)).toEqual(["Level", "Door", "Elsewhere"]);
        expect(listed.scenes).toEqual([{id: level, path: LEVEL_PATH}, {id: other, path: OTHER_PATH}]);
        expect(listed.activeSceneId).toBe(level);
        expect(listed.entities.map(entity => entity.sceneId)).toEqual([level, level, other]);
        expect(listed.editedSceneIds).toEqual([]);
    });

    test("edits mark only the scene they touch, saving clears the mark and edits during play mark nothing", async () => {
        const harnessed = editorWorld();
        const {level, other} = await openTwoScenes(harnessed);
        const elsewhere = byName((await listing(harnessed)).entities, "Elsewhere")!.entity;
        await ask(harnessed, {op: "setField", entity: elsewhere, typeName: "LocalPosition", key: "xyz", value: [3, 0, 0]});
        expect((await listing(harnessed)).editedSceneIds).toEqual([other]);

        await ask(harnessed, {op: "createEntity", name: "Added"});
        expect([...(await listing(harnessed)).editedSceneIds].sort()).toEqual([level, other].sort());
        expect(await sceneIdOfNamed(harnessed, "Added")).toBe(level);

        await ask(harnessed, {op: "saveScene", scene: {id: other, path: OTHER_PATH}});
        expect((await listing(harnessed)).editedSceneIds).toEqual([level]);

        await ask(harnessed, {op: "setMode", mode: "play"});
        await ask(harnessed, {op: "setField", entity: elsewhere, typeName: "LocalPosition", key: "xyz", value: [9, 0, 0]});
        await ask(harnessed, {op: "setMode", mode: "edit"});
        expect((await listing(harnessed)).editedSceneIds).toEqual([level]);
    });

    test("destroying the last root of a scene marks that scene, even though the world forgets it", async () => {
        const harnessed = editorWorld();
        const {other} = await openTwoScenes(harnessed);
        const elsewhere = byName((await listing(harnessed)).entities, "Elsewhere")!.entity;
        await ask(harnessed, {op: "destroyEntity", entity: elsewhere});
        const listed = await listing(harnessed);
        expect(listed.editedSceneIds).toEqual([other]);
        expect(listed.scenes.some(scene => scene.id === other)).toBe(false);
    });

    test("saving one of several scenes writes only its entities, and a new path retags the scene", async () => {
        const harnessed = editorWorld();
        const {level, other} = await openTwoScenes(harnessed);
        const savedOther = await ask(harnessed, {op: "saveScene", scene: {id: other, path: OTHER_PATH}});
        expect(parseSceneDocument(savedOther.sceneText).entities.map(record => record.name)).toEqual(["Elsewhere"]);
        expect(mentionsMembership(savedOther.sceneText)).toBe(false);
        const savedLevel = await ask(harnessed, {op: "saveScene", scene: {id: level, path: RENAMED_PATH}});
        expect(savedLevel.sceneText).toBe(LEVEL_TEXT);
        expect(savedLevel.sceneId).toBe(level);
        const scenes = scenesOf(harnessed);
        expect(scenes.active()?.path).toBe(RENAMED_PATH);
        expect(scenes.loaded().map(handle => handle.path)).toEqual([RENAMED_PATH, OTHER_PATH]);
    });

    test("a scene holding every entity saves exactly what the whole-world save writes", async () => {
        const harnessed = editorWorld();
        const level = (await ask(harnessed, {op: "loadScene", sceneText: LEVEL_TEXT, path: LEVEL_PATH})).sceneId;
        await ask(harnessed, {op: "createEntity", name: "Added"});
        const whole = await ask(harnessed, {op: "saveScene"});
        const scene = await ask(harnessed, {op: "saveScene", scene: {id: level, path: LEVEL_PATH}});
        expect(scene.sceneText).toBe(whole.sceneText);
        expect(parseSceneDocument(scene.sceneText).entities.map(record => record.name)).toEqual(["Level", "Door", "Added"]);
    });

    test("unloading a scene destroys only its entities and hands the active scene to another loaded scene", async () => {
        const harnessed = editorWorld();
        const {level, other} = await openTwoScenes(harnessed);
        await ask(harnessed, {op: "createEntity", name: "Added"});
        const unloaded = await ask(harnessed, {op: "unloadScene", sceneId: level});
        expect(unloaded.activeSceneId).toBe(other);
        expect(await entityNames(harnessed)).toEqual(["Elsewhere"]);
        expect((await listing(harnessed)).editedSceneIds).toEqual([]);
        expect((await ask(harnessed, {op: "unloadScene", sceneId: level})).activeSceneId).toBe(other);
    });

    test("setting another scene active first keeps unsaved roots in the scene they were made in", async () => {
        const harnessed = editorWorld();
        const {level, other} = await openTwoScenes(harnessed);
        await ask(harnessed, {op: "createEntity", name: "Added"});
        expect((await ask(harnessed, {op: "setActiveScene", scene: {id: other, path: OTHER_PATH}})).sceneId).toBe(other);
        expect(await sceneIdOfNamed(harnessed, "Added")).toBe(level);
        await ask(harnessed, {op: "createEntity", name: "Later"});
        expect(await sceneIdOfNamed(harnessed, "Later")).toBe(other);
        expect((await listing(harnessed)).activeSceneId).toBe(other);
    });

    test("activating a scene the world has forgotten makes a fresh empty scene with its path", async () => {
        const harnessed = editorWorld();
        const {level} = await openTwoScenes(harnessed);
        const empty = (await ask(harnessed, {op: "loadScene", sceneText: EMPTY_TEXT, path: THIRD_PATH, additive: true})).sceneId;
        expect((await listing(harnessed)).scenes.some(scene => scene.id === empty)).toBe(false);
        const activated = (await ask(harnessed, {op: "setActiveScene", scene: {id: empty, path: THIRD_PATH}})).sceneId;
        const listed = await listing(harnessed);
        expect(listed.activeSceneId).toBe(activated);
        expect(listed.scenes.find(scene => scene.id === activated)?.path).toBe(THIRD_PATH);
        expect(listed.scenes.some(scene => scene.id === level)).toBe(true);
        await ask(harnessed, {op: "createEntity", name: "Third"});
        expect(await sceneIdOfNamed(harnessed, "Third")).toBe(activated);
    });

    test("unparenting keeps an entity in its scene, and a root instantiated with a scene goes back into it", async () => {
        const harnessed = editorWorld();
        const {level, other} = await openTwoScenes(harnessed);
        await ask(harnessed, {op: "setActiveScene", scene: {id: other, path: OTHER_PATH}});
        const door = byName((await listing(harnessed)).entities, "Door")!.entity;
        await ask(harnessed, {op: "setParent", entity: door, parent: null});
        expect(await sceneIdOfNamed(harnessed, "Door")).toBe(level);

        const levelRoot = byName((await listing(harnessed)).entities, "Level")!.entity;
        const {documentText} = await ask(harnessed, {op: "serializeEntities", entities: [levelRoot]});
        await ask(harnessed, {op: "destroyEntity", entity: levelRoot});
        await ask(harnessed, {op: "destroyEntity", entity: door});
        expect((await listing(harnessed)).scenes.map(scene => scene.id)).toEqual([other]);
        await ask(harnessed, {op: "instantiateEntities", documentText, parent: null, scene: {id: level, path: LEVEL_PATH}});
        expect(await sceneIdOfNamed(harnessed, "Level")).toBe(level);
        expect((await listing(harnessed)).scenes).toEqual([{id: level, path: LEVEL_PATH}, {id: other, path: OTHER_PATH}]);
        await ask(harnessed, {op: "instantiateEntities", documentText});
        expect((await listing(harnessed)).entities.filter(entity => entity.name === "Level").map(entity => entity.sceneId)).toEqual([level, other]);
    });

    test("saving the entities of a world without scenes makes them a scene with that path", async () => {
        const harnessed = editorWorld(world => {
            world.entityManager.createEntity("codeMade", [new LocalPosition(), new LocalToWorld()]);
        });
        expect((await listing(harnessed)).activeSceneId).toBe(NO_SCENE_ID);
        const saved = await ask(harnessed, {op: "saveScene", scene: {id: NO_SCENE_ID, path: LEVEL_PATH}});
        expect(saved.sceneId).not.toBe(NO_SCENE_ID);
        expect(parseSceneDocument(saved.sceneText).entities.map(record => record.name)).toEqual(["codeMade"]);
        const listed = await listing(harnessed);
        expect(listed.activeSceneId).toBe(saved.sceneId);
        expect(listed.scenes).toEqual([{id: saved.sceneId, path: LEVEL_PATH}]);
        expect(listed.entities[0].sceneId).toBe(saved.sceneId);
    });

    test("scenes are added, unloaded and activated only while editing", async () => {
        const harnessed = editorWorld();
        const {other} = await openTwoScenes(harnessed);
        await ask(harnessed, {op: "setMode", mode: "play"});
        expect((await failureOf(ask(harnessed, {op: "unloadScene", sceneId: other}))).includes(STOP_FIRST_TEXT)).toBe(true);
        expect((await failureOf(ask(harnessed, {op: "setActiveScene", scene: {id: other, path: OTHER_PATH}}))).includes(STOP_FIRST_TEXT)).toBe(true);
        expect((await failureOf(ask(harnessed, {op: "loadScene", sceneText: OTHER_TEXT, path: THIRD_PATH, additive: true}))).includes(STOP_FIRST_TEXT)).toBe(true);
    });

    test("importing a snapshot keeps scene membership and the active scene, and clears edit marks", async () => {
        const harnessed = editorWorld();
        const {level, other} = await openTwoScenes(harnessed);
        await ask(harnessed, {op: "setActiveScene", scene: {id: other, path: OTHER_PATH}});
        await ask(harnessed, {op: "createEntity", name: "Added"});
        const exported = await ask(harnessed, {op: "exportSnapshot"});
        await ask(harnessed, {op: "loadScene", sceneText: OTHER_TEXT, path: THIRD_PATH});
        await ask(harnessed, {op: "importSnapshot", documentText: exported.documentText, mode: "edit"});
        const listed = await listing(harnessed);
        expect(listed.entities.map(entity => [entity.name, entity.sceneId])).toEqual([["Level", level], ["Door", level], ["Elsewhere", other], ["Added", other]]);
        expect(listed.activeSceneId).toBe(other);
        expect(listed.editedSceneIds).toEqual([]);
    });
});
