import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import type {MemoryFileSource} from "../testing/memoryPlatform";
import {EntityCommandBufferSystem, World} from "../core";
import type {Entity} from "../core";
import {asFloat32Array} from "../math/types/vec";
import {LocalPosition} from "../translation/localPosition";
import {Parent} from "../translation/parent";
import {Sprite} from "../rendering/2d/sprite";
import {SPRITE_PATTERN_FILE_FORMAT, SPRITE_PATTERN_FILE_VERSION} from "../rendering/2d/spritePatternFile";
import {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {registerEngineComponentSchemas} from "./engineComponentSchemas";
import {PrefabAsset} from "./prefabAsset";
import {PrefabSpawner, prefabSpawnerOf} from "./prefabSpawner";
import {platformSceneAssetLoader} from "./sceneAssets";
import type {SceneAssetLoader} from "./sceneAssets";
import {FIRST_SCENE_ENTITY_ID, parseSceneDocument, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "./sceneDocument";
import type {SceneEntityRecord, SceneFieldValues} from "./sceneDocument";

const PREFAB_PATH = "prefabs/thing.prefab.json";
const PATTERN_PATH = "sprites/thing.pattern.json";
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

function patternFileText(rows: readonly string[]): string {
    return JSON.stringify({format: SPRITE_PATTERN_FILE_FORMAT, version: SPRITE_PATTERN_FILE_VERSION, rows, palette: [{char: "#", rgb: TINT}]});
}

function patternedRoot(): SceneEntityRecord {
    return record(FIRST_SCENE_ENTITY_ID, "thing", {
        LocalPosition: {xyz: ROOT_XYZ},
        Sprite: {image: {rows: ROOT_ROWS, palette: [{char: "#", rgb: TINT}]}, tint: TINT, opacity: 1},
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
        expect(world.entityManager.getComponent<Sprite>(spawned.root, Sprite)!.image?.pattern?.rows).toEqual(ROOT_ROWS);
    });

    test("spawns at once through the entity manager", () => {
        const {world, spawner} = setup();
        const spawned = spawner.spawn(world.entityManager, prefabOf(patternedRoot()));
        expect(positionOf(world, spawned.root)).toEqual(ROOT_XYZ);
    });

    test("every spawn gets its own mutable values and shares the one pattern image its prefab decoded", () => {
        const {world, spawner} = setup();
        const prefab = prefabOf(patternedRoot());
        const first = spawner.spawn(world.entityManager, prefab);
        const second = spawner.spawn(world.entityManager, prefab);
        const firstSprite = first.rootComponent(Sprite), secondSprite = second.rootComponent(Sprite);
        expect(firstSprite).not.toBe(secondSprite);
        expect(firstSprite.image).toBeDefined();
        expect(secondSprite.image).toBe(firstSprite.image);
        expect(spawner.templateOf(prefab).rootComponentDefaults(Sprite)?.image).toBe(firstSprite.image);
        first.rootComponent(LocalPosition).x = SPAWNED_X;
        expect(positionOf(world, second.root)).toEqual(ROOT_XYZ);
    });

    test("spawns of a prefab whose sprite names a pattern file share the image loaded once from that file", () => {
        const platform = new MemoryPlatform({files: {[PATTERN_PATH]: patternFileText(ROOT_ROWS)}});
        const world = new World({platform});
        const registry = new ComponentSchemaRegistry();
        registerEngineComponentSchemas(registry);
        const spawner = prefabSpawnerOf(world, registry, platformSceneAssetLoader({files: platform.files, inflate: platform.inflate}));
        const filed = (name: string): SceneEntityRecord => record(FIRST_SCENE_ENTITY_ID, name, {LocalPosition: {xyz: ROOT_XYZ}, Sprite: {image: {path: PATTERN_PATH}, tint: TINT, opacity: 1}});
        const first = spawner.spawn(world.entityManager, prefabOf(filed("first"))).rootComponent(Sprite).image;
        const second = spawner.spawn(world.entityManager, prefabOf(filed("second"))).rootComponent(Sprite).image;
        expect([first?.sourcePath, first?.pattern?.rows]).toEqual([PATTERN_PATH, ROOT_ROWS]);
        expect(second).toBe(first);
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

interface FileSetup extends Setup {
    readonly files: MemoryFileSource;
    readonly loader: SceneAssetLoader;
}

function prefabFileText(...entities: readonly SceneEntityRecord[]): string {
    return JSON.stringify({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities});
}

function rootAt(xyz: readonly number[]): SceneEntityRecord {
    return record(FIRST_SCENE_ENTITY_ID, "thing", {LocalPosition: {xyz: [...xyz]}});
}

function fileSetup(): FileSetup {
    const platform = new MemoryPlatform({files: {[PREFAB_PATH]: prefabFileText(rootAt(ROOT_XYZ))}});
    const world = new World({platform});
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    const loader = platformSceneAssetLoader({files: platform.files, inflate: platform.inflate});
    return {world, spawner: prefabSpawnerOf(world, registry, loader), files: platform.files as MemoryFileSource, loader};
}

describe("prefab reloads", () => {
    test("reloadPrefab rewrites the loaded PrefabAsset in place under any spelling of its path, so holders spawn the file's new content", () => {
        const {world, spawner, files, loader} = fileSetup();
        const prefab = loader.loadPrefab(PREFAB_PATH);
        const before = spawner.templateOf(prefab);
        expect(positionOf(world, spawner.spawn(world.entityManager, prefab).root)).toEqual(ROOT_XYZ);

        files.set(PREFAB_PATH, prefabFileText(rootAt(CHILD_XYZ)));
        expect(loader.reloadPrefab(`./${PREFAB_PATH}`)).toBe(true);
        expect(loader.loadPrefab(PREFAB_PATH)).toBe(prefab);
        expect(spawner.templateOf(prefab)).not.toBe(before);
        expect(positionOf(world, spawner.spawn(world.entityManager, prefab).root)).toEqual(CHILD_XYZ);
        expect(spawner.templateOf(prefab)).toBe(spawner.templateOf(prefab));
    });

    test("reloadPrefab leaves a path no prefab was loaded from unloaded, and keeps the loaded document when the file no longer parses", () => {
        const {files, loader} = fileSetup();
        expect(loader.isPrefabLoaded(PREFAB_PATH)).toBe(false);
        expect(loader.reloadPrefab(PREFAB_PATH)).toBe(false);
        expect(loader.isPrefabLoaded(PREFAB_PATH)).toBe(false);

        const prefab = loader.loadPrefab(PREFAB_PATH);
        const document = prefab.document;
        expect(loader.isPrefabLoaded(`./${PREFAB_PATH}`)).toBe(true);
        files.set(PREFAB_PATH, JSON.stringify({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION}));
        expect(() => loader.reloadPrefab(PREFAB_PATH)).toThrow(`Scene document "${PREFAB_PATH}": entities must be an array`);
        expect(prefab.document).toBe(document);
    });
});
