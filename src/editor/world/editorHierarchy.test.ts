import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import {Component} from "../../engine/core";
import type {Entity, World} from "../../engine/core";
import {Vec, Vec4} from "../../engine/math/types/vec";
import {LocalPosition} from "../../engine/translation/localPosition";
import {LocalRotation} from "../../engine/translation/localRotation";
import {LocalScale} from "../../engine/translation/localScale";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import {Parent, ParentTransform} from "../../engine/translation/parent";
import {Quaternions} from "../../engine/math/quaternions";
import {MAT4_TRANSLATION_X, MAT4_TRANSLATION_Y, MAT4_TRANSLATION_Z} from "../../engine/math/mat4Layout";
import {Vec3} from "../../engine/math/types/vec";
import type {EditorEntitySummary} from "../editorProtocol";
import {
    ask,
    byName,
    childrenOf,
    disposeEditorWorlds,
    editorWorld,
    failureOf,
    fieldsOf,
    framesPass,
} from "./editorServiceTestHarness";
import type {Harnessed} from "./editorServiceTestHarness";
import {linkChild, worldMatrixOf} from "./hierarchyEditing";

const QUARTER_TURN_RADIANS = Math.PI / 2;
const POSITION_DIGITS = 4;

class Heading extends Component {
    public speed = 1;
    public label = "heading";
    public direction = [0, 0, 1];
}

afterEach(disposeEditorWorlds);

function family(world: World): Entity[] {
    const em = world.entityManager;
    const parent = em.createEntity("parent", [new LocalPosition(), new LocalToWorld()]);
    const children = ["a", "b", "c"].map(name => em.createEntity(name, [new LocalPosition(), new LocalToWorld(), new Parent(parent)]));
    for (const child of children) linkChild(world, child, parent);
    return [parent, ...children];
}

function worldPosition(world: World, entity: Entity): number[] {
    const matrix = Vec.toArray(worldMatrixOf(world, entity));
    return [matrix[MAT4_TRANSLATION_X], matrix[MAT4_TRANSLATION_Y], matrix[MAT4_TRANSLATION_Z]].map(value => Number(value.toFixed(POSITION_DIGITS)) + 0);
}

function summaries(harnessed: Harnessed): Promise<readonly EditorEntitySummary[]> {
    return ask(harnessed, {op: "listEntities"}).then(result => result.entities);
}

describe("editor rename and multi-field edits", () => {
    test("renameEntity sets and clears the name", async () => {
        let entity = 0 as Entity;
        const harnessed = editorWorld(world => {
            entity = world.entityManager.createEntity("before", [new LocalPosition()]);
        });
        expect((await ask(harnessed, {op: "renameEntity", entity, name: "after"})).name).toBe("after");
        expect(harnessed.world.entityManager.nameOf(entity)).toBe("after");
        expect((await ask(harnessed, {op: "renameEntity", entity, name: null})).name).toBe(null);
        expect(await failureOf(ask(harnessed, {op: "renameEntity", entity: 12345 as Entity, name: "x"})))
            .toBe('Editor request "renameEntity" failed: No entity 12345 in this world');
    });

    test("setFields applies every edit in order, or none when one fails validation", async () => {
        const handles: Entity[] = [];
        const harnessed = editorWorld(world => {
            handles.push(world.entityManager.createEntity("first", [new LocalPosition()]));
            handles.push(world.entityManager.createEntity("second", [new LocalPosition()]));
        });
        const [first, second] = handles;
        const result = await ask(harnessed, {op: "setFields", edits: [
            {entity: first, typeName: "LocalPosition", key: "xyz", value: [1, 2, 3]},
            {entity: second, typeName: "LocalPosition", key: "xyz", value: [4, 5, 6]},
            {entity: first, typeName: "LocalPosition", key: "xyz", value: [7, 8, 9]},
        ]});
        expect(result.values).toEqual([[7, 8, 9], [4, 5, 6], [7, 8, 9]]);
        expect(fieldsOf(await ask(harnessed, {op: "getEntity", entity: first}), "LocalPosition")).toEqual({xyz: [7, 8, 9]});

        expect(await failureOf(ask(harnessed, {op: "setFields", edits: [
            {entity: first, typeName: "LocalPosition", key: "xyz", value: [0, 0, 0]},
            {entity: second, typeName: "LocalPosition", key: "xyz", value: [0, 0]},
        ]}))).toBe('Editor request "setFields" failed: edits[1]: Scene field LocalPosition.xyz: expected an array of 3 numbers, got [0,0]');
        expect(fieldsOf(await ask(harnessed, {op: "getEntity", entity: first}), "LocalPosition")).toEqual({xyz: [7, 8, 9]});
        expect(await failureOf(ask(harnessed, {op: "setFields", edits: [{entity: first, typeName: "Parent", key: "entity", value: second}]})))
            .toBe('Editor request "setFields" failed: edits[0]: setFields cannot edit Parent; use setParent');
    });

    test("unregistered components get an inferred schema: described, inspected, edited in place, added and removed", async () => {
        const handles: Entity[] = [];
        const harnessed = editorWorld(world => {
            handles.push(world.entityManager.createEntity("mover", [new LocalPosition(), new Heading()]));
            handles.push(world.entityManager.createEntity("idle", [new LocalPosition()]));
        });
        const [mover, idle] = handles;
        const {components} = await ask(harnessed, {op: "describeSchemas"});
        expect(components.find(component => component.typeName === "Heading")).toEqual({
            typeName: "Heading",
            persistence: "fields",
            fields: [{key: "speed", kind: "number"}, {key: "label", kind: "string", nullable: false}, {key: "direction", kind: "vec3"}],
            inferred: true,
            category: "Game",
        });
        const details = await ask(harnessed, {op: "getEntity", entity: mover});
        expect(details.components.find(component => component.typeName === "Heading"))
            .toEqual({typeName: "Heading", inspectable: true, inferred: true, fields: {speed: 1, label: "heading", direction: [0, 0, 1]}});

        const heading = harnessed.world.entityManager.getComponent<Heading>(mover, Heading)!;
        const direction = heading.direction;
        await ask(harnessed, {op: "setFields", edits: [
            {entity: mover, typeName: "Heading", key: "speed", value: 4},
            {entity: mover, typeName: "Heading", key: "direction", value: [1, 0, 0]},
        ]});
        expect(heading.speed).toBe(4);
        expect(heading.direction).toBe(direction);
        expect(heading.direction).toEqual([1, 0, 0]);

        const added = await ask(harnessed, {op: "addComponent", entity: idle, typeName: "Heading", values: {speed: 9}});
        expect(fieldsOf(added, "Heading")).toEqual({speed: 9, label: "heading", direction: [0, 0, 1]});
        const removed = await ask(harnessed, {op: "removeComponent", entity: mover, typeName: "Heading"});
        expect(removed.components.map(component => component.typeName)).toEqual(["LocalPosition"]);
        expect((await ask(harnessed, {op: "saveScene"})).report.skippedComponentTypes).toEqual([{typeName: "Heading", entityCount: 1}]);
    });
});

describe("editor hierarchy", () => {
    test("setParent keeps the world position under a scaled parent and back out to the root", async () => {
        const handles: Entity[] = [];
        const harnessed = editorWorld(world => {
            handles.push(world.entityManager.createEntity("parent", [new LocalPosition(10, 0, 0), new LocalScale(2, 2, 2), new LocalToWorld()]));
            handles.push(world.entityManager.createEntity("child", [new LocalPosition(14, 4, 0), new LocalToWorld()]));
        });
        const [parent, child] = handles;
        const parented = await ask(harnessed, {op: "setParent", entity: child, parent});
        expect([parented.parent, parented.siblingIndex]).toEqual([parent, 0]);
        expect(fieldsOf(parented, "LocalPosition")).toEqual({xyz: [2, 2, 0]});
        expect(fieldsOf(parented, "LocalScale")).toEqual({xyz: [0.5, 0.5, 0.5]});
        expect(childrenOf(harnessed.world, parent)).toEqual([child]);
        expect(harnessed.world.entityManager.hasComponent(child, ParentTransform)).toBe(true);
        expect(worldPosition(harnessed.world, child)).toEqual([14, 4, 0]);

        const unparented = await ask(harnessed, {op: "setParent", entity: child, parent: null, siblingIndex: 0});
        expect([unparented.parent, unparented.siblingIndex]).toEqual([null, 0]);
        expect(fieldsOf(unparented, "LocalPosition")).toEqual({xyz: [14, 4, 0]});
        expect(fieldsOf(unparented, "LocalScale")).toEqual({xyz: [1, 1, 1]});
        expect(childrenOf(harnessed.world, parent)).toEqual([]);
        expect(harnessed.world.entityManager.hasComponent(child, ParentTransform)).toBe(false);
        expect(byName(await summaries(harnessed), "parent")?.siblingIndex).toBe(1);
    });

    test("setParent keeps the world transform under a rotated parent once the transforms run", async () => {
        const handles: Entity[] = [];
        const harnessed = editorWorld(world => {
            const rotation = new LocalRotation();
            rotation.xyzw = Quaternions.eulerToQuat(Vec3.alloc(0, 0, QUARTER_TURN_RADIANS));
            handles.push(world.entityManager.createEntity("turned", [new LocalPosition(0, 0, 5), rotation, new LocalToWorld()]));
            handles.push(world.entityManager.createEntity("point", [new LocalPosition(1, 0, 5), new LocalToWorld()]));
        });
        const [turned, point] = handles;
        const parented = await ask(harnessed, {op: "setParent", entity: point, parent: turned});
        expect(fieldsOf(parented, "LocalRotation")).toBeDefined();
        expect(await framesPass(harnessed)).toBe(true);
        const localToWorld = harnessed.world.entityManager.getComponent<LocalToWorld>(point, LocalToWorld)!;
        expect(Vec.toArray(localToWorld.position).map(value => Number(value.toFixed(POSITION_DIGITS)) + 0)).toEqual([1, 0, 5]);
        const rotation = localToWorld.rotationInto(Vec4.alloc());
        expect(Math.abs(Vec.w(rotation))).toBeCloseTo(1, POSITION_DIGITS);
    });

    test("setParent reorders siblings, reorders roots and refuses cycles", async () => {
        let handles: Entity[] = [];
        const harnessed = editorWorld(world => {
            handles = family(world);
            world.entityManager.createEntity("loose", [new LocalPosition()]);
        });
        const [parent, a, b, c] = handles;
        await ask(harnessed, {op: "setParent", entity: c, parent, siblingIndex: 0});
        expect(childrenOf(harnessed.world, parent)).toEqual([c, a, b]);
        const listed = await summaries(harnessed);
        expect(["a", "b", "c"].map(name => byName(listed, name)!.siblingIndex)).toEqual([1, 2, 0]);

        const looseEntity = byName(listed, "loose")!.entity;
        await ask(harnessed, {op: "setParent", entity: looseEntity, parent: null, siblingIndex: 0});
        const roots = (await summaries(harnessed)).filter(summary => summary.parent === null);
        expect(roots.map(root => [root.name, root.siblingIndex])).toEqual([["parent", 1], ["loose", 0]]);

        expect(await failureOf(ask(harnessed, {op: "setParent", entity: parent, parent: a})))
            .toBe(`Editor request "setParent" failed: Entity ${a} is entity ${parent} or one of its descendants, so it cannot become its parent`);
        expect(await failureOf(ask(harnessed, {op: "setParent", entity: a, parent: 54321 as Entity})))
            .toBe('Editor request "setParent" failed: No entity 54321 in this world');
    });

    test("duplicateEntities copies the topmost selected subtrees right after each original, names kept", async () => {
        let handles: Entity[] = [];
        const harnessed = editorWorld(world => {
            handles = family(world);
            world.entityManager.getComponent<LocalPosition>(handles[2], LocalPosition)!.xyz = Vec3.alloc(3, 4, 5);
        });
        const [parent, a, b, c] = handles;
        const {roots} = await ask(harnessed, {op: "duplicateEntities", entities: [b, parent, a]});
        expect(roots.length).toBe(1);
        const copy = await ask(harnessed, {op: "getEntity", entity: roots[0]});
        expect([copy.name, copy.parent, copy.siblingIndex]).toEqual(["parent", null, 1]);
        expect(childrenOf(harnessed.world, roots[0]).map(child => harnessed.world.entityManager.nameOf(child))).toEqual(["a", "b", "c"]);
        const copiedB = childrenOf(harnessed.world, roots[0])[1];
        expect(fieldsOf(await ask(harnessed, {op: "getEntity", entity: copiedB}), "LocalPosition")).toEqual({xyz: [3, 4, 5]});

        const {roots: [copyOfB]} = await ask(harnessed, {op: "duplicateEntities", entities: [b]});
        expect(childrenOf(harnessed.world, parent)).toEqual([a, b, copyOfB, c]);
    });

    test("serializeEntities, destroyEntity and instantiateEntities restore a subtree in place: the page's undo of a delete", async () => {
        let handles: Entity[] = [];
        const harnessed = editorWorld(world => {
            handles = family(world);
            const grandchild = world.entityManager.createEntity("grandchild", [new LocalPosition(7, 7, 7), new LocalToWorld(), new Parent(handles[2])]);
            linkChild(world, grandchild, handles[2]);
        });
        const [parent, a, b, c] = handles;
        const before = await ask(harnessed, {op: "getEntity", entity: b});
        const {documentText} = await ask(harnessed, {op: "serializeEntities", entities: [b]});
        const {destroyed} = await ask(harnessed, {op: "destroyEntity", entity: b});
        expect(destroyed.length).toBe(2);
        expect(childrenOf(harnessed.world, parent)).toEqual([a, c]);

        const restored = await ask(harnessed, {op: "instantiateEntities", documentText, parent, siblingIndex: before.siblingIndex});
        expect(restored.roots.length).toBe(1);
        expect(restored.entities.length).toBe(2);
        expect(restored.report.droppedComponents).toEqual([]);
        expect(childrenOf(harnessed.world, parent)).toEqual([a, restored.roots[0], c]);
        const again = await ask(harnessed, {op: "getEntity", entity: restored.roots[0]});
        expect([again.name, again.parent, again.siblingIndex]).toEqual(["b", parent, 1]);
        const grandchild = childrenOf(harnessed.world, restored.roots[0])[0];
        expect(fieldsOf(await ask(harnessed, {op: "getEntity", entity: grandchild}), "LocalPosition")).toEqual({xyz: [7, 7, 7]});
        expect(await failureOf(ask(harnessed, {op: "serializeEntities", entities: [b]}))).toBe(`Editor request "serializeEntities" failed: No entity ${b} in this world`);
    });
});
