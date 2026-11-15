import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {World} from "../core";
import type {Entity} from "../core";
import {LocalPosition} from "../translation/localPosition";
import {LocalToWorld} from "../translation/localToWorld";
import {Parent} from "../translation/parent";
import {Children} from "../translation/children";
import {TranslationSystemGroup} from "../translation/translationSystemGroup";
import {LocalToWorldSystem} from "../translation/localToWorldSystem";
import {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {registerEngineComponentSchemas} from "./engineComponentSchemas";
import {EditorOnly} from "./editorOnly";
import {parseSceneDocument} from "./sceneDocument";
import {orderedSceneRoots, SceneRootOrder, setSceneRootOrder} from "./sceneHierarchy";
import {applySceneInPlace, deserializeInto, instantiateDocument, sceneEntitiesInCreationOrder, serializeEntities, serializeWorld} from "./sceneSerialization";

const SETTLE_STEPS = 3;

function newWorld(): World {
    const world = new World({platform: new MemoryPlatform()});
    world.getOrCreateSystem(TranslationSystemGroup);
    world.getOrCreateSystem(LocalToWorldSystem);
    return world;
}

function engineRegistry(): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    return registry;
}

function childrenOf(world: World, parent: Entity): readonly Entity[] {
    return world.entityManager.getComponent<Children>(parent, Children)?.children ?? [];
}

function namesOf(world: World, entities: readonly Entity[]): (string | undefined)[] {
    return entities.map(entity => world.entityManager.nameOf(entity));
}

function family(world: World): {parent: Entity, a: Entity, b: Entity, c: Entity} {
    const em = world.entityManager;
    const parent = em.createEntity("parent", [new LocalPosition(), new LocalToWorld()]);
    const [a, b, c] = ["a", "b", "c"].map(name => em.createEntity(name, [new LocalPosition(), new LocalToWorld(), new Parent(parent)]));
    const children = em.getComponent<Children>(parent, Children)!;
    for (const child of [a, b, c]) children.addChild(child);
    return {parent, a, b, c};
}

function sceneRoots(world: World): Entity[] {
    return orderedSceneRoots(world, sceneEntitiesInCreationOrder(world).filter(entity => !world.entityManager.hasComponent(entity, Parent)));
}

describe("Children order", () => {
    test("insertChild, moveChild and removeChildKeepingOrder keep the other siblings in order", () => {
        const world = newWorld();
        const {parent, a, b, c} = family(world);
        const children = world.entityManager.getComponent<Children>(parent, Children)!;
        children.moveChild(c, 0);
        expect(children.children).toEqual([c, a, b]);
        children.moveChild(c, 99);
        expect(children.children).toEqual([a, b, c]);
        children.removeChildKeepingOrder(a);
        expect(children.children).toEqual([b, c]);
        children.insertChild(a, 1);
        expect(children.children).toEqual([b, a, c]);
        expect(children.indexOf(c)).toBe(2);
        expect(() => children.moveChild(parent, 0)).toThrow("is not a child here");
    });
});

describe("sibling order in scene documents", () => {
    test("children in creation order save no sibling index", () => {
        const world = newWorld();
        family(world);
        expect(serializeWorld(world, engineRegistry()).document.entities.some(record => record.siblingIndex !== undefined)).toBe(false);
    });

    test("reordered children save their sibling index and load in that order before any tick", () => {
        const world = newWorld();
        const {parent, c} = family(world);
        world.entityManager.getComponent<Children>(parent, Children)!.moveChild(c, 0);
        const saved = serializeWorld(world, engineRegistry());
        expect(saved.document.entities.map(record => record.siblingIndex)).toEqual([undefined, 1, 2, 0]);

        const target = newWorld();
        const loaded = deserializeInto(target, engineRegistry(), parseSceneDocument(JSON.stringify(saved.document)));
        expect(namesOf(target, childrenOf(target, loaded.entities[0]))).toEqual(["c", "a", "b"]);
        for (let i = 0; i < SETTLE_STEPS; i++) target.step();
        expect(namesOf(target, childrenOf(target, loaded.entities[0]))).toEqual(["c", "a", "b"]);
        expect(serializeWorld(target, engineRegistry()).document).toEqual(saved.document);
    });

    test("a reordered scene root order saves root sibling indices and loads back", () => {
        const world = newWorld();
        const em = world.entityManager;
        const first = em.createEntity("first", [new LocalPosition()]);
        const second = em.createEntity("second", [new LocalPosition()]);
        setSceneRootOrder(world, [second, first]);
        const saved = serializeWorld(world, engineRegistry());
        expect(saved.document.entities.map(record => record.siblingIndex)).toEqual([1, 0]);

        const target = newWorld();
        deserializeInto(target, engineRegistry(), parseSceneDocument(JSON.stringify(saved.document)));
        expect(namesOf(target, sceneRoots(target))).toEqual(["second", "first"]);
        expect(serializeWorld(target, engineRegistry()).document).toEqual(saved.document);
    });

    test("applySceneInPlace restores sibling and root order, including a recreated child", () => {
        const world = newWorld();
        const {parent, a, b, c} = family(world);
        const loose = world.entityManager.createEntity("loose", [new LocalPosition()]);
        const snapshot = serializeWorld(world, engineRegistry());
        const children = world.entityManager.getComponent<Children>(parent, Children)!;
        children.moveChild(a, 2);
        world.entityManager.destroyEntity(b);
        children.removeChildKeepingOrder(b);
        setSceneRootOrder(world, [loose, parent]);

        const restored = applySceneInPlace(world, engineRegistry(), snapshot);
        const recreatedB = restored.entities[2];
        expect(childrenOf(world, parent)).toEqual([a, recreatedB, c]);
        expect(namesOf(world, sceneRoots(world))).toEqual(["parent", "loose"]);
    });
});

describe("subtree documents", () => {
    test("serializeEntities saves the roots and every descendant, an outside parent as null without reporting it", () => {
        const world = newWorld();
        const em = world.entityManager;
        const {parent, a, b} = family(world);
        const grandchild = em.createEntity("grandchild", [new LocalPosition(), new Parent(a)]);
        em.createEntity("helper", [new LocalPosition(), new Parent(a), new EditorOnly()]);
        const saved = serializeEntities(world, engineRegistry(), [a]);
        expect(saved.entities).toEqual([a, grandchild]);
        expect(saved.document.entities.map(record => record.name)).toEqual(["a", "grandchild"]);
        expect(saved.document.entities[0].components.Parent).toEqual({entity: null});
        expect(saved.document.entities[1].components.Parent).toEqual({entity: 1});
        expect(saved.report.danglingEntityRefs).toEqual([]);
        expect(() => serializeEntities(world, engineRegistry(), [parent, 0 as Entity])).toThrow("entity 0 is not a scene entity");
        expect(serializeEntities(world, engineRegistry(), [b, a]).document.entities.map(record => [record.name, record.siblingIndex]))
            .toEqual([["a", 1], ["b", 0], ["grandchild", undefined]]);
    });

    test("instantiateDocument parents the roots under a new parent at a sibling index", () => {
        const world = newWorld();
        const {parent, a, b, c} = family(world);
        const document = serializeEntities(world, engineRegistry(), [a]).document;
        const created = instantiateDocument(world, engineRegistry(), document, {parent, siblingIndex: 1});
        expect(created.roots.length).toBe(1);
        expect(created.report.droppedComponents).toEqual([]);
        expect(childrenOf(world, parent)).toEqual([a, created.roots[0], b, c]);
        expect(world.entityManager.getComponent<Parent>(created.roots[0], Parent)!.entity).toBe(parent);
    });

    test("instantiateDocument without a parent places its roots in the scene root order", () => {
        const world = newWorld();
        const em = world.entityManager;
        const first = em.createEntity("first", [new LocalPosition()]);
        em.createEntity("second", [new LocalPosition()]);
        const document = serializeEntities(world, engineRegistry(), [first]).document;
        const created = instantiateDocument(world, engineRegistry(), document, {parent: null, siblingIndex: 1});
        expect(created.roots.length).toBe(1);
        expect(world.entityManager.hasComponent(created.roots[0], Parent)).toBe(false);
        expect(namesOf(world, sceneRoots(world))).toEqual(["first", "first", "second"]);
        expect(world.resources.get(SceneRootOrder).roots[1]).toBe(created.roots[0]);
    });
});

describe("editor-only entities", () => {
    test("are never saved and survive an in-place restore", () => {
        const world = newWorld();
        const em = world.entityManager;
        em.createEntity("scene", [new LocalPosition()]);
        const helper = em.createEntity("helper", [new LocalPosition(), new EditorOnly()]);
        const snapshot = serializeWorld(world, engineRegistry());
        expect(snapshot.document.entities.map(record => record.name)).toEqual(["scene"]);
        expect(snapshot.entities.includes(helper)).toBe(false);
        applySceneInPlace(world, engineRegistry(), snapshot);
        expect(em.exists(helper)).toBe(true);
    });
});
