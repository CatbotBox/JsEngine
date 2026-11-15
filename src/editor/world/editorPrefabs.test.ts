import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import type {Entity, World} from "../../engine/core";
import {LocalPosition} from "../../engine/translation/localPosition";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import {Parent} from "../../engine/translation/parent";
import {parseSceneDocument} from "../../engine/scene";
import type {SceneDocument} from "../../engine/scene";
import {ask, byName, childrenOf, disposeEditorWorlds, editorWorld, failureOf, fieldsOf} from "./editorServiceTestHarness";
import type {Harnessed} from "./editorServiceTestHarness";
import {linkChild} from "./hierarchyEditing";

const ENEMY_PREFAB = "prefabs/enemy.prefab.json";

afterEach(disposeEditorWorlds);

function enemy(world: World): Entity {
    const em = world.entityManager;
    const root = em.createEntity("Enemy", [new LocalPosition(0, 0, 0), new LocalToWorld()]);
    const gun = em.createEntity("Gun", [new LocalPosition(1, 0, 0), new LocalToWorld(), new Parent(root)]);
    linkChild(world, gun, root);
    return root;
}

async function prefabText(harnessed: Harnessed, root: Entity): Promise<string> {
    const {documentText} = await ask(harnessed, {op: "serializeEntities", entities: [root]});
    await ask(harnessed, {op: "destroyEntity", entity: root});
    return documentText;
}

function nameOf(harnessed: Harnessed, entity: Entity): string | undefined {
    return harnessed.world.entityManager.nameOf(entity);
}

function editedPrefab(text: string, edit: (document: SceneDocument) => void): string {
    const document = parseSceneDocument(text);
    edit(document);
    return JSON.stringify(document);
}

describe("editor prefabs", () => {
    test("an instantiated prefab carries PrefabInstance and tracks, reverts and applies its overrides", async () => {
        let root = 0 as Entity;
        const harnessed = editorWorld(world => {
            root = enemy(world);
        });
        const documentText = await prefabText(harnessed, root);
        const created = await ask(harnessed, {op: "instantiateEntities", documentText, prefabSourcePath: ENEMY_PREFAB});
        const instance = created.roots[0];
        const gun = childrenOf(harnessed.world, instance)[0];
        expect(await ask(harnessed, {op: "getPrefabOverrides", entity: instance})).toEqual({sourcePath: ENEMY_PREFAB, overrides: []});
        const listed = (await ask(harnessed, {op: "listEntities"})).entities;
        expect([byName(listed, "Enemy")?.prefabSourcePath, byName(listed, "Gun")?.prefabSourcePath]).toEqual([ENEMY_PREFAB, null]);

        await ask(harnessed, {op: "setField", entity: instance, typeName: "LocalPosition", key: "xyz", value: [9, 9, 9]});
        await ask(harnessed, {op: "setField", entity: gun, typeName: "LocalPosition", key: "xyz", value: [5, 0, 0]});
        await ask(harnessed, {op: "renameEntity", entity: gun, name: "Big Gun"});
        await ask(harnessed, {op: "addComponent", entity: gun, typeName: "Camera"});
        expect((await ask(harnessed, {op: "getPrefabOverrides", entity: instance})).overrides)
            .toEqual(["0/@name", "0/LocalPosition.xyz", "0/Camera"]);

        const reverted = await ask(harnessed, {op: "revertPrefabInstance", entity: instance, paths: ["0/@name", "0/Camera"]});
        expect(reverted.overrides).toEqual(["0/LocalPosition.xyz"]);
        expect(nameOf(harnessed, gun)).toBe("Gun");
        expect((await ask(harnessed, {op: "getEntity", entity: gun})).components.some(component => component.typeName === "Camera")).toBe(false);

        const applied = parseSceneDocument((await ask(harnessed, {op: "applyPrefabInstance", entity: instance})).documentText);
        expect(applied.entities.map(record => record.name)).toEqual(["Enemy", "Gun"]);
        expect(applied.entities[0].components.PrefabInstance).toBeUndefined();
        expect(applied.entities[0].components.Parent).toBeUndefined();
        expect(applied.entities[0].components.LocalPosition).toEqual({xyz: [0, 0, 0]});
        expect(applied.entities[1].components.LocalPosition).toEqual({xyz: [5, 0, 0]});

        expect((await ask(harnessed, {op: "revertPrefabInstance", entity: instance})).overrides).toEqual([]);
        expect(fieldsOf(await ask(harnessed, {op: "getEntity", entity: gun}), "LocalPosition")).toEqual({xyz: [1, 0, 0]});
        expect(fieldsOf(await ask(harnessed, {op: "getEntity", entity: instance}), "LocalPosition")).toEqual({xyz: [9, 9, 9]});
    });

    test("updatePrefabInstances brings non-overridden values and added or removed children to every instance", async () => {
        let root = 0 as Entity;
        const harnessed = editorWorld(world => {
            root = enemy(world);
        });
        const documentText = await prefabText(harnessed, root);
        const first = (await ask(harnessed, {op: "instantiateEntities", documentText, prefabSourcePath: ENEMY_PREFAB})).roots[0];
        const second = (await ask(harnessed, {op: "instantiateEntities", documentText, prefabSourcePath: ENEMY_PREFAB})).roots[0];
        const firstGun = childrenOf(harnessed.world, first)[0];
        const secondGun = childrenOf(harnessed.world, second)[0];
        await ask(harnessed, {op: "setField", entity: firstGun, typeName: "LocalPosition", key: "xyz", value: [5, 5, 5]});

        const withScope = editedPrefab(documentText, document => {
            document.entities[1].components.LocalPosition = {xyz: [2, 0, 0]};
            document.entities[1].name = "Rifle";
            document.entities.push({id: 3, name: "Scope", enabled: false, components: {LocalPosition: {xyz: [0, 1, 0]}, Parent: {entity: 1}}});
        });
        const {updated} = await ask(harnessed, {op: "updatePrefabInstances", sourcePath: ENEMY_PREFAB, documentText: withScope});
        expect(updated).toEqual([first, second]);
        expect(fieldsOf(await ask(harnessed, {op: "getEntity", entity: firstGun}), "LocalPosition")).toEqual({xyz: [5, 5, 5]});
        expect(fieldsOf(await ask(harnessed, {op: "getEntity", entity: secondGun}), "LocalPosition")).toEqual({xyz: [2, 0, 0]});
        expect([nameOf(harnessed, firstGun), nameOf(harnessed, secondGun)]).toEqual(["Rifle", "Rifle"]);
        for (const instance of [first, second]) {
            const children = childrenOf(harnessed.world, instance);
            expect(children.map(child => nameOf(harnessed, child))).toEqual(["Rifle", "Scope"]);
            expect(harnessed.world.entityManager.isEnabled(children[1])).toBe(false);
        }
        expect((await ask(harnessed, {op: "getPrefabOverrides", entity: first})).overrides).toEqual(["0/LocalPosition.xyz"]);
        expect((await ask(harnessed, {op: "getPrefabOverrides", entity: second})).overrides).toEqual([]);

        const withoutScope = editedPrefab(withScope, document => {
            document.entities.pop();
        });
        await ask(harnessed, {op: "updatePrefabInstances", sourcePath: ENEMY_PREFAB, documentText: withoutScope});
        expect(childrenOf(harnessed.world, second).map(child => nameOf(harnessed, child))).toEqual(["Rifle"]);
        expect((await ask(harnessed, {op: "listEntities"})).entities.filter(entity => entity.name === "Scope")).toEqual([]);
    });

    test("prefab requests refuse what is not an instance, a document with several roots and an unloaded prefab", async () => {
        let root = 0 as Entity;
        const harnessed = editorWorld(world => {
            root = enemy(world);
            world.entityManager.createEntity("Other", [new LocalPosition()]);
        });
        expect(await failureOf(ask(harnessed, {op: "getPrefabOverrides", entity: root})))
            .toBe(`Editor request "getPrefabOverrides" failed: Entity ${root} is not a prefab instance root (it has no PrefabInstance)`);
        const listed = (await ask(harnessed, {op: "listEntities"})).entities;
        const {documentText} = await ask(harnessed, {op: "serializeEntities", entities: [root, byName(listed, "Other")!.entity]});
        expect(await failureOf(ask(harnessed, {op: "instantiateEntities", documentText, prefabSourcePath: ENEMY_PREFAB})))
            .toBe('Editor request "instantiateEntities" failed: A prefab document needs exactly one root entity; this one has 2');
        await ask(harnessed, {op: "addComponent", entity: root, typeName: "PrefabInstance", values: {sourcePath: "prefabs/unknown.prefab.json"}});
        expect(await failureOf(ask(harnessed, {op: "revertPrefabInstance", entity: root})))
            .toBe('Editor request "revertPrefabInstance" failed: The prefab "prefabs/unknown.prefab.json" is not loaded; instantiate it or send updatePrefabInstances first');
    });
});
