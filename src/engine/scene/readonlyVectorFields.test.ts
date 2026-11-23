import {describe, expect, test} from "../testing/harness";
import {Component, Resource, World} from "../core";
import {asFloat32Array, Vec, Vec2, Vec3, Vec4} from "../math/types/vec";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {componentSchema, resourceSchema} from "./componentSchemaBuilder";
import {applySceneInPlace, deserializeInto, serializeWorld} from "./sceneSerialization";

class Anchor extends Component {
    public static readonly schema = componentSchema(Anchor, "Anchor").vec3("position").vec2("flat").rotation("turn").build();
    public readonly position = Vec3.alloc();
    public readonly flat = Vec2.alloc();
    public readonly turn = Vec4.alloc(0, 0, 0, 1);
}

class Spawn extends Resource {
    public static readonly schema = resourceSchema(Spawn, "Spawn").vec3("point").build();
    public readonly point = Vec3.alloc();
}

interface Arrays {
    readonly position: Vec3;
    readonly flat: Vec2;
    readonly turn: Vec4;
}

function registry(): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registry.register(Anchor.schema);
    registry.registerResource(Spawn.schema);
    return registry;
}

function arraysOf(anchor: Anchor): Arrays {
    return {position: anchor.position, flat: anchor.flat, turn: anchor.turn};
}

function expectSameArrays(anchor: Anchor, before: Arrays): void {
    expect(anchor.position === before.position).toBe(true);
    expect(anchor.flat === before.flat).toBe(true);
    expect(anchor.turn === before.turn).toBe(true);
}

describe("read-only vector fields", () => {
    test("in-place restore and resource loads write into the arrays code already holds", () => {
        const schemas = registry();
        const world = new World({platform: new MemoryPlatform()});
        const anchored = world.entityManager.createEntity("anchored", [new Anchor()]);
        const anchor = world.entityManager.getComponent<Anchor>(anchored, Anchor)!;
        Vec.set3(anchor.position, 1, 2, 3);
        const spawn = world.resources.insert(new Spawn());
        Vec.set3(spawn.point, 4, 5, 6);
        const snapshot = serializeWorld(world, schemas);
        const held = arraysOf(anchor);
        const heldPoint = spawn.point;

        Vec.set3(anchor.position, 9, 9, 9);
        asFloat32Array(anchor.flat)[0] = 7;
        asFloat32Array(anchor.turn)[3] = 0;
        Vec.set3(spawn.point, 0, 0, 0);
        applySceneInPlace(world, schemas, {document: snapshot.document, entities: [anchored]});

        expectSameArrays(anchor, held);
        expect([Vec.toArray(anchor.position), Vec.toArray(anchor.flat), Vec.toArray(anchor.turn)]).toEqual([[1, 2, 3], [0, 0], [0, 0, 0, 1]]);
        expect(spawn.point === heldPoint).toBe(true);
        expect(Vec.toArray(spawn.point)).toEqual([4, 5, 6]);

        Vec.set3(spawn.point, 0, 0, 0);
        deserializeInto(world, schemas, snapshot.document);
        expect(spawn.point === heldPoint).toBe(true);
        expect(Vec.toArray(spawn.point)).toEqual([4, 5, 6]);
    });

    test("a loaded component keeps the arrays its constructor allocated", () => {
        const schemas = registry();
        const source = new World({platform: new MemoryPlatform()});
        const saved = source.entityManager.createEntity("saved", [new Anchor()]);
        Vec.set3(source.entityManager.getComponent<Anchor>(saved, Anchor)!.position, 1, 2, 3);
        const document = serializeWorld(source, schemas).document;

        const created: Arrays[] = [];
        const tracking = new ComponentSchemaRegistry();
        tracking.register({...Anchor.schema, create: () => {
            const anchor = new Anchor();
            created.push(arraysOf(anchor));
            return anchor;
        }});
        const target = new World({platform: new MemoryPlatform()});
        const loaded = deserializeInto(target, tracking, document).entities[0];
        const anchor = target.entityManager.getComponent<Anchor>(loaded, Anchor)!;

        const allocated = created.find(arrays => arrays.position === anchor.position);
        expect(allocated).toBeDefined();
        expectSameArrays(anchor, allocated!);
        expect(Vec.toArray(anchor.position)).toEqual([1, 2, 3]);
    });
});
