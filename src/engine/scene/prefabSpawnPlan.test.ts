import {describe, expect, test} from "../testing/harness";
import {MemoryFileSource, MemoryPlatform} from "../testing/memoryPlatform";
import {Component, EntityCommandBufferSystem, Resource, World} from "../core";
import type {Entity} from "../core";
import {NULL_ENTITY} from "../core/entity";
import {asFloat32Array, Vec3} from "../math/types/vec";
import {LocalPosition} from "../translation/localPosition";
import {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {componentSchema, resourceSchema, structFields} from "./componentSchemaBuilder";
import {DATA_ASSET_FORMAT, DATA_ASSET_VERSION} from "./dataAssetDocument";
import {dataAssetsOf} from "./dataAssets";
import {registerEngineComponentSchemas} from "./engineComponentSchemas";
import type {FieldTypeDefinition} from "./fieldSchema";
import {PrefabAsset} from "./prefabAsset";
import {PrefabInstance} from "./prefabInstance";
import {prefabSpawnerOf} from "./prefabSpawner";
import type {PrefabSpawner} from "./prefabSpawner";
import {platformSceneAssetLoader} from "./sceneAssets";
import {FIRST_SCENE_ENTITY_ID, parseSceneDocument, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "./sceneDocument";
import type {SceneEntityRecord, SceneFieldValues} from "./sceneDocument";

const PREFAB_PATH = "prefabs/mover.prefab.json";
const INNER_PATH = "prefabs/inner.prefab.json";
const OTHER_PATH = "prefabs/other.prefab.json";
const TABLE_PATH = "data/table.asset.json";
const SECOND_ID = FIRST_SCENE_ENTITY_ID + 1;
const THIRD_ID = FIRST_SCENE_ENTITY_ID + 2;
const MISSING_ID = 99;
const HEADING = [1, 2, 3];
const TARGET = [4, 5, 6];
const SPEED = 7;
const NOTES = ["first", "second"];
const STEPS = [1, 2, 3];
const MARKER_LABEL = "authored";
const DEFAULT_MARKER_WEIGHT = 1;
const TINT = "#336699";
const TINT_RGB = 0x336699;
const TAG_LABEL = "tagged";
const INNER_XYZ = [8, 8, 8];
const OTHER_XYZ = [9, 9, 9];
const NESTED_OVERRIDES = ["LocalPosition.xyz"];
const EDITED = 42;
const ENABLED = true;

class Marker {
    public label = "unset";
    public weight = DEFAULT_MARKER_WEIGHT;
}

function markerFields() {
    return structFields<Marker>().string("label").number("weight").build();
}

class Mover extends Component {
    public static readonly schema = componentSchema(Mover, "Mover")
        .vec3("heading")
        .vec3("target")
        .number("speed")
        .textLines("notes")
        .list("steps", {kind: "number"})
        .struct("marker", markerFields(), {typeName: "Marker", create: () => new Marker()})
        .nullableStruct("spare", markerFields(), {typeName: "Marker", create: () => new Marker()})
        .rgb("tint")
        .build();

    public readonly heading = Vec3.alloc();
    public readonly constructedHeading: Vec3;
    public notes: string[] = [];
    public steps: number[] = [];
    public marker = new Marker();
    public spare: Marker | undefined = new Marker();
    public tint = 0;
    public speedWrites = 0;
    private _target = Vec3.alloc();
    private _speed = 0;

    public constructor() {
        super();
        this.constructedHeading = this.heading;
    }

    public get target(): Vec3 {
        return this._target;
    }

    public set target(value: Vec3) {
        this._target = value;
    }

    public get speed(): number {
        return this._speed;
    }

    public set speed(value: number) {
        this._speed = value;
        this.speedWrites++;
    }
}

class Tag {
    public constructor(public label: string = "") {
    }
}

const TAG_TYPE: FieldTypeDefinition<Tag> = {
    name: "Tag",
    encode: tag => tag.label,
    decode: json => new Tag(json as string),
    defaultValue: () => new Tag(),
};

class Labelled extends Component {
    public tag = new Tag();
}

class Link extends Component {
    public static readonly schema = componentSchema(Link, "Link").entity("target").list("chain", {kind: "entity", nullable: true}).build();
    public target: Entity = NULL_ENTITY;
    public chain: Entity[] = [];
}

class Tether extends Component {
    public static readonly schema = componentSchema(Tether, "Tether").entity("to", {nullable: false}).build();
    public to: Entity = NULL_ENTITY;
}

class Emitter extends Component {
    public static readonly schema = componentSchema(Emitter, "Emitter").prefab("spawns").build();
    public spawns: PrefabAsset | undefined = undefined;
}

class SpawnTable extends Resource {
    public static readonly schema = resourceSchema(SpawnTable, "SpawnTable").prefab("prefab").build();
    public prefab: PrefabAsset | undefined = undefined;
}

interface Setup {
    readonly world: World;
    readonly files: MemoryFileSource;
    readonly registry: ComponentSchemaRegistry;
    readonly spawner: PrefabSpawner;
}

function schemaRegistry(): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    registry.registerComponentClasses([Mover, Link, Tether, Emitter]);
    registry.registerFieldType(TAG_TYPE);
    registry.registerGeneratedComponent(Labelled, "Labelled", [{key: "tag", kind: "custom", typeName: TAG_TYPE.name}]);
    registry.registerResourceClass(SpawnTable);
    return registry;
}

function setup(files: MemoryFileSource = new MemoryFileSource()): Setup {
    const world = new World({platform: new MemoryPlatform({fileSource: files})});
    const registry = schemaRegistry();
    const spawner = prefabSpawnerOf(world, registry, platformSceneAssetLoader({files: world.platform.files, inflate: world.platform.inflate}));
    return {world, files, registry, spawner};
}

function record(id: number, name: string, components: {readonly [typeName: string]: SceneFieldValues}): SceneEntityRecord {
    return {id, name, enabled: ENABLED, components};
}

function prefabText(...entities: readonly SceneEntityRecord[]): string {
    return JSON.stringify({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities});
}

function prefabOf(...entities: readonly SceneEntityRecord[]): PrefabAsset {
    return new PrefabAsset(PREFAB_PATH, parseSceneDocument(prefabText(...entities)));
}

function positioned(xyz: readonly number[]): SceneEntityRecord {
    return record(FIRST_SCENE_ENTITY_ID, "positioned", {LocalPosition: {xyz: [...xyz]}});
}

function moverPrefab(): PrefabAsset {
    return prefabOf(record(FIRST_SCENE_ENTITY_ID, "mover", {
        Mover: {heading: HEADING, target: TARGET, speed: SPEED, notes: NOTES, steps: STEPS, marker: {label: MARKER_LABEL}, spare: null, tint: TINT},
        Labelled: {tag: TAG_LABEL},
    }));
}

function numbersOf(vector: Vec3): number[] {
    return Array.from(asFloat32Array(vector));
}

function positionOf(world: World, entity: Entity): number[] {
    return Array.from(asFloat32Array(world.entityManager.getComponent<LocalPosition>(entity, LocalPosition)!.xyz));
}

function playback(world: World): void {
    world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer().playback(world.entityManager);
}

function bufferOf(world: World) {
    return world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
}

describe("prefab spawn plan", () => {
    test("copies an own vector field into the array its constructor made, and hands a vector accessor a fresh vector per spawn", () => {
        const {world, spawner} = setup();
        const prefab = moverPrefab();
        const first = spawner.spawn(world.entityManager, prefab).rootComponent(Mover);
        const second = spawner.spawn(world.entityManager, prefab).rootComponent(Mover);
        expect(first.heading).toBe(first.constructedHeading);
        expect(numbersOf(first.heading)).toEqual(HEADING);
        expect(numbersOf(first.target)).toEqual(TARGET);
        expect(first.target).not.toBe(second.target);
        asFloat32Array(first.target)[0] = EDITED;
        expect(numbersOf(second.target)).toEqual(TARGET);
    });

    test("assigns through a field's setter once per spawn, as an assignment would", () => {
        const {world, spawner} = setup();
        const mover = spawner.spawn(world.entityManager, moverPrefab()).rootComponent(Mover);
        expect(mover.speed).toBe(SPEED);
        expect(mover.speedWrites).toBe(1);
    });

    test("gives every spawn its own text lines, lists, structs and custom values, keeping a struct's own defaults for members the prefab leaves out", () => {
        const {world, spawner} = setup();
        const prefab = moverPrefab();
        const firstSpawn = spawner.spawn(world.entityManager, prefab), secondSpawn = spawner.spawn(world.entityManager, prefab);
        const first = firstSpawn.rootComponent(Mover), second = secondSpawn.rootComponent(Mover);
        expect([first.notes, first.steps, first.tint]).toEqual([NOTES, STEPS, TINT_RGB]);
        expect(first.marker).toBeInstanceOf(Marker);
        expect([first.marker.label, first.marker.weight]).toEqual([MARKER_LABEL, DEFAULT_MARKER_WEIGHT]);
        expect(first.spare).toBeUndefined();
        expect(first.notes).not.toBe(second.notes);
        expect(first.steps).not.toBe(second.steps);
        expect(first.marker).not.toBe(second.marker);
        const firstTag = firstSpawn.rootComponent(Labelled).tag, secondTag = secondSpawn.rootComponent(Labelled).tag;
        expect(firstTag.label).toBe(TAG_LABEL);
        expect(firstTag).not.toBe(secondTag);
    });

    test("never leaks a spawn's edits into later spawns or the root defaults", () => {
        const {world, spawner} = setup();
        const prefab = moverPrefab();
        const edited = spawner.spawn(world.entityManager, prefab).rootComponent(Mover);
        asFloat32Array(edited.heading)[0] = EDITED;
        edited.notes.push("extra");
        edited.steps.push(EDITED);
        edited.marker.label = "edited";
        const fresh = spawner.spawn(world.entityManager, prefab).rootComponent(Mover);
        expect([numbersOf(fresh.heading), fresh.notes, fresh.steps, fresh.marker.label]).toEqual([HEADING, NOTES, STEPS, MARKER_LABEL]);
        const defaults = spawner.templateOf(prefab).rootComponentDefaults(Mover)!;
        expect([numbersOf(defaults.heading), defaults.notes, defaults.steps, defaults.marker.label]).toEqual([HEADING, NOTES, STEPS, MARKER_LABEL]);
    });

    test("points references, also inside lists, at each spawn's own entities, nulls a dangling one and leaves out a required one that resolves to nothing", () => {
        const {world, spawner} = setup();
        const prefab = prefabOf(
            record(FIRST_SCENE_ENTITY_ID, "root", {Link: {target: SECOND_ID, chain: [FIRST_SCENE_ENTITY_ID, SECOND_ID, MISSING_ID, null]}}),
            record(SECOND_ID, "dangling", {Parent: {entity: FIRST_SCENE_ENTITY_ID}, Tether: {to: MISSING_ID}}),
            record(THIRD_ID, "tethered", {Parent: {entity: FIRST_SCENE_ENTITY_ID}, Tether: {to: FIRST_SCENE_ENTITY_ID}}),
        );
        const first = spawner.spawn(bufferOf(world), prefab);
        const second = spawner.spawn(bufferOf(world), prefab);
        const firstLink = first.rootComponent(Link);
        playback(world);
        for (const spawned of [first, second]) {
            const [root, dangling, tethered] = spawned.entities;
            const link = world.entityManager.getComponent<Link>(root, Link)!;
            expect(link.target).toBe(dangling);
            expect(link.chain).toEqual([root, dangling, NULL_ENTITY, NULL_ENTITY]);
            expect(world.entityManager.getComponent<Tether>(dangling, Tether)).toBeUndefined();
            expect(world.entityManager.getComponent<Tether>(tethered, Tether)!.to).toBe(root);
        }
        expect(firstLink.target).toBe(first.entities[1]);
        expect(first.entities.some(entity => second.entities.includes(entity))).toBe(false);
    });

    test("spawns a nested prefab instance with its own PrefabInstance data, and shares the loaded asset a prefab field names", () => {
        const files = new MemoryFileSource({[INNER_PATH]: prefabText(positioned(INNER_XYZ))});
        const {world, spawner} = setup(files);
        const prefab = prefabOf(
            record(FIRST_SCENE_ENTITY_ID, "outer", {Emitter: {spawns: {path: INNER_PATH}}}),
            record(SECOND_ID, "nested", {
                Parent: {entity: FIRST_SCENE_ENTITY_ID},
                LocalPosition: {xyz: OTHER_XYZ},
                PrefabInstance: {sourcePath: INNER_PATH, overrides: NESTED_OVERRIDES},
            }),
        );
        const first = spawner.spawn(world.entityManager, prefab), second = spawner.spawn(world.entityManager, prefab);
        const firstInstance = world.entityManager.getComponent<PrefabInstance>(first.entities[1], PrefabInstance)!;
        const secondInstance = world.entityManager.getComponent<PrefabInstance>(second.entities[1], PrefabInstance)!;
        expect([firstInstance.sourcePath, firstInstance.overrides]).toEqual([INNER_PATH, NESTED_OVERRIDES]);
        expect(firstInstance.overrides).not.toBe(secondInstance.overrides);
        expect(positionOf(world, first.entities[1])).toEqual(OTHER_XYZ);
        const inner = first.rootComponent(Emitter).spawns!;
        expect(second.rootComponent(Emitter).spawns).toBe(inner);
        expect(inner.sourcePath).toBe(INNER_PATH);
        expect(positionOf(world, spawner.spawn(world.entityManager, inner).root)).toEqual(INNER_XYZ);
    });

    test("compiles a reloaded prefab (a new asset for the same path) afresh, while the earlier asset keeps spawning what it was compiled from", () => {
        const {world, spawner} = setup();
        const before = prefabOf(positioned(INNER_XYZ));
        const beforePlan = spawner.templateOf(before);
        expect(positionOf(world, spawner.spawn(world.entityManager, before).root)).toEqual(INNER_XYZ);
        const reloaded = prefabOf(positioned(OTHER_XYZ));
        expect(spawner.templateOf(reloaded)).not.toBe(beforePlan);
        expect(spawner.templateOf(before)).toBe(beforePlan);
        expect(positionOf(world, spawner.spawn(world.entityManager, reloaded).root)).toEqual(OTHER_XYZ);
        expect(positionOf(world, spawner.spawn(world.entityManager, before).root)).toEqual(INNER_XYZ);
        expect(numbersOf(spawner.templateOf(reloaded).rootComponentDefaults(LocalPosition)!.xyz)).toEqual(OTHER_XYZ);
    });

    test("spawns the prefab a reloaded data asset now names", () => {
        const tableText = (path: string) => JSON.stringify({format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION, type: "SpawnTable", fields: {prefab: {path}}});
        const files = new MemoryFileSource({
            [INNER_PATH]: prefabText(positioned(INNER_XYZ)),
            [OTHER_PATH]: prefabText(positioned(OTHER_XYZ)),
            [TABLE_PATH]: tableText(INNER_PATH),
        });
        const world = new World({platform: new MemoryPlatform({fileSource: files})});
        const registry = schemaRegistry();
        const dataAssets = dataAssetsOf(world, registry);
        const spawner = prefabSpawnerOf(world, registry, dataAssets.assets);
        const table = dataAssets.load(TABLE_PATH, SpawnTable);
        expect(positionOf(world, spawner.spawn(world.entityManager, table.prefab!).root)).toEqual(INNER_XYZ);
        files.set(TABLE_PATH, tableText(OTHER_PATH));
        dataAssets.reload(TABLE_PATH);
        expect(table.prefab!.sourcePath).toBe(OTHER_PATH);
        expect(positionOf(world, spawner.spawn(world.entityManager, table.prefab!).root)).toEqual(OTHER_XYZ);
    });
});
