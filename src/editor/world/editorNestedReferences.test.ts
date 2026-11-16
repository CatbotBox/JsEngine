import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import {Component} from "../../engine/core";
import type {Entity, World} from "../../engine/core";
import {NULL_ENTITY} from "../../engine/core/entity";
import {LocalPosition} from "../../engine/translation/localPosition";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import {Parent} from "../../engine/translation/parent";
import {componentSchema, structFields} from "../../engine/scene";
import {ask, byName, childrenOf, disposeEditorWorlds, editorWorld, fieldsOf} from "./editorServiceTestHarness";
import type {Harnessed} from "./editorServiceTestHarness";
import {linkChild} from "./hierarchyEditing";

const GUARD_PREFAB = "prefabs/guard.prefab.json";

class Link {
    public to: Entity = NULL_ENTITY;
    public weight = 1;
}

class Patrol extends Component {
    public static readonly schema = componentSchema(Patrol, "Patrol")
        .list("stops", {kind: "entity", nullable: true})
        .struct("link", structFields<Link>().entity("to").number("weight").build(), {typeName: "Link", create: () => new Link()})
        .build();

    public stops: Entity[] = [];
    public link = new Link();
}

afterEach(disposeEditorWorlds);

function guard(world: World): Entity {
    const em = world.entityManager;
    const root = em.createEntity("Guard", [new LocalPosition(), new LocalToWorld()]);
    const first = em.createEntity("Post A", [new LocalPosition(1, 0, 0), new LocalToWorld(), new Parent(root)]);
    const second = em.createEntity("Post B", [new LocalPosition(2, 0, 0), new LocalToWorld(), new Parent(root)]);
    linkChild(world, first, root);
    linkChild(world, second, root);
    const patrol = new Patrol();
    patrol.stops = [first, second];
    patrol.link.to = second;
    em.addComponent(root, patrol);
    return root;
}

function patrolWorld(): {readonly harnessed: Harnessed, readonly root: Entity} {
    let root = 0 as Entity;
    const harnessed = editorWorld(world => {
        root = guard(world);
    }, {register: registry => registry.registerComponentClass(Patrol)});
    return {harnessed, root};
}

async function patrolOf(harnessed: Harnessed, entity: Entity): Promise<{readonly [key: string]: unknown} | undefined> {
    return fieldsOf(await ask(harnessed, {op: "getEntity", entity}), "Patrol");
}

describe("entity references nested in lists and structs", () => {
    test("the inspector sees and edits them as handles, and a save then load remaps them to the new entities", async () => {
        const {harnessed, root} = patrolWorld();
        const [first, second] = childrenOf(harnessed.world, root);
        expect(await patrolOf(harnessed, root)).toEqual({stops: [first, second], link: {to: second, weight: 1}});
        await ask(harnessed, {op: "setField", entity: root, typeName: "Patrol", key: "stops", value: [second, null, first]});
        expect((await patrolOf(harnessed, root))?.stops).toEqual([second, null, first]);

        const {sceneText} = await ask(harnessed, {op: "saveScene"});
        await ask(harnessed, {op: "loadScene", sceneText});
        const listed = (await ask(harnessed, {op: "listEntities"})).entities;
        const loadedRoot = byName(listed, "Guard")!.entity;
        const [postA, postB] = [byName(listed, "Post A")!.entity, byName(listed, "Post B")!.entity];
        expect(loadedRoot === root).toBe(false);
        expect(await patrolOf(harnessed, loadedRoot)).toEqual({stops: [postB, null, postA], link: {to: postB, weight: 1}});
    });

    test("a prefab instance compares nested references by the entities they point at, and reverts them", async () => {
        const {harnessed, root} = patrolWorld();
        const {documentText} = await ask(harnessed, {op: "serializeEntities", entities: [root]});
        await ask(harnessed, {op: "destroyEntity", entity: root});
        const instance = (await ask(harnessed, {op: "instantiateEntities", documentText, prefabSourcePath: GUARD_PREFAB})).roots[0];
        const [first, second] = childrenOf(harnessed.world, instance);
        expect((await ask(harnessed, {op: "getPrefabOverrides", entity: instance})).overrides).toEqual([]);

        await ask(harnessed, {op: "setField", entity: instance, typeName: "Patrol", key: "link", value: {to: first, weight: 1}});
        expect((await ask(harnessed, {op: "getPrefabOverrides", entity: instance})).overrides).toEqual(["/Patrol.link"]);
        await ask(harnessed, {op: "revertPrefabInstance", entity: instance});
        expect(await patrolOf(harnessed, instance)).toEqual({stops: [first, second], link: {to: second, weight: 1}});
    });

    test("duplicating a subtree points the copy's nested references at the copied entities", async () => {
        const {harnessed, root} = patrolWorld();
        const copy = (await ask(harnessed, {op: "duplicateEntities", entities: [root]})).roots[0];
        const [first, second] = childrenOf(harnessed.world, copy);
        expect(await patrolOf(harnessed, copy)).toEqual({stops: [first, second], link: {to: second, weight: 1}});
    });
});
