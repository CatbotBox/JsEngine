import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {EntityCommandBufferSystem, World} from "../core";
import type {Entity} from "../core";
import {asFloat32Array} from "../math/types/vec";
import {LocalPosition} from "../translation/localPosition";
import {Parent} from "../translation/parent";
import {Sprite} from "../rendering/2d/sprite";
import {SpritePattern} from "../rendering/2d/spritePattern";
import {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {registerEngineComponentSchemas} from "./engineComponentSchemas";
import {PrefabAsset} from "./prefabAsset";
import {PrefabSpawner, prefabSpawnerOf} from "./prefabSpawner";
import {platformSceneAssetLoader} from "./sceneAssets";
import {FIRST_SCENE_ENTITY_ID, parseSceneDocument, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "./sceneDocument";
import type {SceneEntityRecord, SceneFieldValues} from "./sceneDocument";

const PREFAB_PATH = "prefabs/thing.prefab.json";
const ROOT_XYZ = [1, 2, 3];
const CHILD_XYZ = [4, 5, 6];
const ROOT_ROWS = ["#.", ".#"];
const TINT = "#ff8000";
const TINT_RGB = 0xFF8000;
const SPAWNED_X = 9;
const SECOND_ID = FIRST_SCENE_ENTITY_ID + 1;
const ENABLED = true;
const DISABLED = false;

interface Setup {
    readonly world: World;
    readonly spawner: PrefabSpawner;
}

function setup(): Setup {
    const world = new World({platform: new MemoryPlatform()});
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    return {world, spawner: prefabSpawnerOf(world, registry, platformSceneAssetLoader({files: world.platform.files, inflate: world.platform.inflate}))};
}

function record(id: number, name: string, components: {readonly [typeName: string]: SceneFieldValues}, enabled: boolean = ENABLED): SceneEntityRecord {
    return {id, name, enabled, components};
}

function prefabOf(...entities: readonly SceneEntityRecord[]): PrefabAsset {
    return new PrefabAsset(PREFAB_PATH, parseSceneDocument({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities}));
}

function patternedRoot(): SceneEntityRecord {
    return record(FIRST_SCENE_ENTITY_ID, "thing", {
        LocalPosition: {xyz: ROOT_XYZ},
        Sprite: {image: null, tint: TINT, opacity: 1},
        SpritePattern: {rows: ROOT_ROWS, palette: [{char: "#", rgb: TINT}]},
    });
}

function playback(world: World): void {
    world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer().playback(world.entityManager);
}

function bufferOf(world: World) {
    return world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
}

function positionOf(world: World, entity: Entity): number[] {
    return Array.from(asFloat32Array(world.entityManager.getComponent<LocalPosition>(entity, LocalPosition)!.xyz));
}

describe("PrefabSpawner", () => {
    test("spawns through a command buffer: nothing exists until playback, then the authored values arrive with the caller's changes", () => {
        const {world, spawner} = setup();
        const spawned = spawner.spawn(bufferOf(world), prefabOf(patternedRoot()));
        spawned.rootComponent(LocalPosition).x = SPAWNED_X;
        expect(world.entityManager.exists(spawned.root)).toBe(false);
        playback(world);
        expect(world.entityManager.nameOf(spawned.root)).toBe("thing");
        expect(positionOf(world, spawned.root)).toEqual([SPAWNED_X, ROOT_XYZ[1], ROOT_XYZ[2]]);
        expect(world.entityManager.getComponent<Sprite>(spawned.root, Sprite)!.tint).toBe(TINT_RGB);
        expect([...world.entityManager.getComponent<SpritePattern>(spawned.root, SpritePattern)!.rows]).toEqual(ROOT_ROWS);
    });

    test("spawns at once through the entity manager", () => {
        const {world, spawner} = setup();
        const spawned = spawner.spawn(world.entityManager, prefabOf(patternedRoot()));
        expect(positionOf(world, spawned.root)).toEqual(ROOT_XYZ);
    });

    test("every spawn gets its own mutable values", () => {
        const {world, spawner} = setup();
        const prefab = prefabOf(patternedRoot());
        const first = spawner.spawn(world.entityManager, prefab);
        const second = spawner.spawn(world.entityManager, prefab);
        const firstPattern = first.rootComponent(SpritePattern), secondPattern = second.rootComponent(SpritePattern);
        expect(firstPattern.rows).not.toBe(secondPattern.rows);
        expect(firstPattern.palette[0]).not.toBe(secondPattern.palette[0]);
        first.rootComponent(LocalPosition).x = SPAWNED_X;
        expect(positionOf(world, second.root)).toEqual(ROOT_XYZ);
    });

    test("compiles a prefab once and reads its root defaults without spawning", () => {
        const {spawner} = setup();
        const prefab = prefabOf(patternedRoot());
        const template = spawner.templateOf(prefab);
        expect(spawner.templateOf(prefab)).toBe(template);
        expect(Array.from(asFloat32Array(template.rootComponentDefaults(LocalPosition)!.xyz))).toEqual(ROOT_XYZ);
        expect(template.rootComponentDefaults(Parent)).toBeUndefined();
    });

    test("parents a spawned child to its spawned root and keeps authored disabled entities disabled", () => {
        const {world, spawner} = setup();
        const prefab = prefabOf(
            record(FIRST_SCENE_ENTITY_ID, "root", {LocalPosition: {xyz: ROOT_XYZ}}),
            record(SECOND_ID, "child", {LocalPosition: {xyz: CHILD_XYZ}, Parent: {entity: FIRST_SCENE_ENTITY_ID}}, DISABLED),
        );
        const spawned = spawner.spawn(bufferOf(world), prefab);
        playback(world);
        const [root, child] = spawned.entities;
        expect(spawned.root).toBe(root);
        expect(world.entityManager.getComponent<Parent>(child, Parent)!.entity).toBe(root);
        expect(world.entityManager.isEnabled(child)).toBe(false);
        expect(positionOf(world, child)).toEqual(CHILD_XYZ);
    });

    test("names the prefab and the missing component when the root lacks one", () => {
        const {world, spawner} = setup();
        const spawned = spawner.spawn(world.entityManager, prefabOf(patternedRoot()));
        expect(() => spawned.rootComponent(Parent)).toThrow(`Prefab "${PREFAB_PATH}" has no Parent on its root entity`);
    });

    test("refuses a prefab without exactly one root, an unregistered component and an unknown field", () => {
        const {spawner} = setup();
        const twoRoots = prefabOf(patternedRoot(), record(SECOND_ID, "other", {LocalPosition: {xyz: ROOT_XYZ}}));
        expect(() => spawner.templateOf(twoRoots)).toThrow(`Prefab "${PREFAB_PATH}" needs exactly one root entity; it has 2`);
        const unknownType = prefabOf(record(FIRST_SCENE_ENTITY_ID, "thing", {Missing: {}}));
        expect(() => spawner.templateOf(unknownType)).toThrow(`Prefab "${PREFAB_PATH}" entities[0].components.Missing: the component type "Missing" is not registered`);
        const unknownField = prefabOf(record(FIRST_SCENE_ENTITY_ID, "thing", {LocalPosition: {xyz: ROOT_XYZ, w: 1}}));
        expect(() => spawner.templateOf(unknownField)).toThrow(`Prefab "${PREFAB_PATH}" entities[0].components.LocalPosition: LocalPosition has no field "w"`);
    });

    test("skips another backend's types in a prefab and names the keep list for an unknown one", () => {
        const world = new World({platform: new MemoryPlatform()});
        const registry = new ComponentSchemaRegistry();
        registerEngineComponentSchemas(registry);
        registry.registerOtherBackendTypeNames(["SpriteCellPassSettings"]);
        const spawner = prefabSpawnerOf(world, registry, platformSceneAssetLoader({files: world.platform.files, inflate: world.platform.inflate}));
        const settings = prefabOf(record(FIRST_SCENE_ENTITY_ID, "settings", {LocalPosition: {xyz: ROOT_XYZ}, SpriteCellPassSettings: {}}));
        expect(spawner.templateOf(settings).sourcePath).toBe(PREFAB_PATH);
        const unknown = prefabOf(record(FIRST_SCENE_ENTITY_ID, "thing", {Missing: {}}));
        expect(() => spawner.templateOf(unknown)).toThrow(`add "Missing" to "keep" in jsengine.project.json`);
    });

    test("is created only with a registry and an asset loader", () => {
        const {world} = setup();
        expect(() => world.resources.getOrCreate(PrefabSpawner)).not.toThrow();
        expect(() => new World({platform: new MemoryPlatform()}).resources.getOrCreate(PrefabSpawner)).toThrow("PrefabSpawner needs a schema registry and an asset loader");
    });
});
