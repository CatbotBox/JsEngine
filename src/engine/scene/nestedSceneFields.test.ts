import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {Component, Resource, World} from "../core";
import type {Entity} from "../core";
import {NULL_ENTITY} from "../core/entity";
import {asFloat32Array} from "../math/types/vec";
import {LocalPosition} from "../translation/localPosition";
import {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {componentSchema, resourceSchema, structFields} from "./componentSchemaBuilder";
import {DATA_ASSET_FORMAT, DATA_ASSET_VERSION} from "./dataAssetDocument";
import {registerEngineComponentSchemas} from "./engineComponentSchemas";
import {PrefabAsset} from "./prefabAsset";
import {platformSceneAssetLoader, sceneAssetPaths} from "./sceneAssets";
import {parseSceneDocument, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "./sceneDocument";
import type {SceneDocument} from "./sceneDocument";
import {SceneManager} from "./sceneManager";
import {applySceneInPlace, deserializeInto, instantiateDocument, sceneEntitiesInCreationOrder, serializeEntities, serializeWorld} from "./sceneSerialization";

const FILLER_ENTITIES = 5;
const SQUAD_RANK = 3;
const SCENE_PATH = "scenes/level.scene.json";
const PREFAB_PATH = "prefabs/enemy.prefab.json";
const TUNING_PATH = "data/tuning.asset.json";
const NESTED_PREFAB_PATH = "prefabs/minion.prefab.json";
const SPAWN_POINT = 7;

class Leader {
    public target: Entity = NULL_ENTITY;
    public rank = 1;
}

class Squad extends Component {
    public static readonly schema = componentSchema(Squad, "Squad")
        .list("members", {kind: "entity", nullable: true})
        .struct("leader", structFields<Leader>().entity("target").integer("rank").build(), {typeName: "Leader", create: () => new Leader()})
        .build();

    public members: Entity[] = [];
    public leader = new Leader();
}

class Tuning extends Resource {
    public static readonly schema = resourceSchema(Tuning, "Tuning").prefab("minion").build();
    public minion: PrefabAsset | undefined = undefined;
}

class Spawner extends Component {
    public static readonly schema = componentSchema(Spawner, "Spawner")
        .list("waves", {kind: "struct", fields: structFields<{enemy: PrefabAsset | undefined}>().prefab("enemy").build()})
        .dataAsset("tuning", Tuning)
        .prefab("boss")
        .build();

    public waves: {enemy: PrefabAsset | undefined}[] = [];
    public tuning: Tuning | undefined = undefined;
    public boss: PrefabAsset | undefined = undefined;
}

function registry(): ComponentSchemaRegistry {
    const result = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(result);
    result.registerResourceClass(Tuning);
    result.registerComponentClasses([Squad, Spawner]);
    return result;
}

function squadOf(world: World, entity: Entity): Squad {
    return world.entityManager.getComponent<Squad>(entity, Squad)!;
}

function buildSquadWorld(world: World): {readonly first: Entity, readonly second: Entity, readonly squad: Entity} {
    const em = world.entityManager;
    const first = em.createEntity("first", [new LocalPosition()]);
    const second = em.createEntity("second", [new LocalPosition()]);
    const squad = new Squad();
    squad.members = [first, second, NULL_ENTITY];
    squad.leader.target = second;
    squad.leader.rank = SQUAD_RANK;
    return {first, second, squad: em.createEntity("squad", [squad])};
}

function worldWithFillers(): {readonly world: World, readonly fillers: readonly Entity[]} {
    const world = new World({platform: new MemoryPlatform()});
    const fillers: Entity[] = [];
    for (let i = 0; i < FILLER_ENTITIES; i++) fillers.push(world.entityManager.createEntity("filler", []));
    return {world, fillers};
}

function document(entities: SceneDocument["entities"]): SceneDocument {
    return {format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities};
}

function prefabText(components: SceneDocument["entities"][number]["components"]): string {
    return JSON.stringify(document([{id: 1, name: "prefab", enabled: true, components}]));
}

describe("entity references nested in lists and structs", () => {
    test("save as scene ids and load remapped to the new world's handles", () => {
        const schemas = registry();
        const source = new World({platform: new MemoryPlatform()});
        buildSquadWorld(source);
        const saved = serializeWorld(source, schemas);
        expect(saved.document.entities[2].components.Squad).toEqual({members: [1, 2, null], leader: {target: 2, rank: SQUAD_RANK}});

        const {world: target, fillers} = worldWithFillers();
        const loaded = deserializeInto(target, schemas, parseSceneDocument(JSON.stringify(saved.document)));
        for (const filler of fillers) target.entityManager.destroyEntity(filler);
        expect(loaded.entities.filter(entity => saved.entities.includes(entity))).toEqual([]);
        const [first, second, squadEntity] = loaded.entities;
        const squad = squadOf(target, squadEntity);
        expect(squad.members).toEqual([first, second, NULL_ENTITY]);
        expect(squad.leader).toBeInstanceOf(Leader);
        expect([squad.leader.target, squad.leader.rank]).toEqual([second, SQUAD_RANK]);
        expect(serializeWorld(target, schemas).document.entities).toEqual(saved.document.entities);
    });

    test("instantiating a subtree document remaps nested references to the created entities", () => {
        const schemas = registry();
        const world = new World({platform: new MemoryPlatform()});
        const built = buildSquadWorld(world);
        const saved = serializeEntities(world, schemas, [built.first, built.second, built.squad]);
        const created = instantiateDocument(world, schemas, saved.document);
        const squad = squadOf(world, created.entities[2]);
        expect(squad.members).toEqual([created.entities[0], created.entities[1], NULL_ENTITY]);
        expect(squad.leader.target).toBe(created.entities[1]);
    });

    test("an in-place restore remaps nested references to recreated entities", () => {
        const schemas = registry();
        const world = new World({platform: new MemoryPlatform()});
        const built = buildSquadWorld(world);
        const snapshot = serializeWorld(world, schemas);
        world.entityManager.destroyEntity(built.second);
        const restored = applySceneInPlace(world, schemas, snapshot);
        const recreated = restored.entities[1];
        expect(recreated).not.toBe(built.second);
        const squad = squadOf(world, built.squad);
        expect(squad.members).toEqual([built.first, recreated, NULL_ENTITY]);
        expect(squad.leader.target).toBe(recreated);
    });

    test("dangling nested references load as null and are reported with their element path", () => {
        const schemas = registry();
        const world = new World({platform: new MemoryPlatform()});
        const loaded = deserializeInto(world, schemas, document([
            {id: 1, name: "squad", enabled: true, components: {Squad: {members: [1, 9], leader: {target: 8, rank: 1}}}},
        ]));
        expect(squadOf(world, loaded.entities[0]).members).toEqual([loaded.entities[0], NULL_ENTITY]);
        expect(loaded.report.danglingEntityRefs).toEqual(["entities[0].components.Squad.members[1]", "entities[0].components.Squad.leader.target"]);
    });

    test("a bad nested value throws before the world is touched", () => {
        const schemas = registry();
        const world = new World({platform: new MemoryPlatform()});
        const bad = document([
            {id: 1, name: "ok", enabled: true, components: {LocalPosition: {xyz: [0, 0, 0]}}},
            {id: 2, name: "squad", enabled: true, components: {Squad: {members: ["one"]}}},
        ]);
        expect(() => deserializeInto(world, schemas, bad)).toThrow("Scene field entities[1].components.Squad.members[0]: expected an entity id");
        expect(sceneEntitiesInCreationOrder(world)).toEqual([]);
    });

    test("struct keys a schema lost throw when strict and are reported as schema changes otherwise", () => {
        const schemas = registry();
        const renamed = document([{id: 1, name: "squad", enabled: true, components: {Squad: {leader: {target: null, level: 2}}}}]);
        expect(() => deserializeInto(new World({platform: new MemoryPlatform()}), schemas, renamed))
            .toThrow(`Scene field entities[0].components.Squad.leader: Leader has no field "level"`);
        const loaded = deserializeInto(new World({platform: new MemoryPlatform()}), schemas, renamed, {schemaChanges: "report"});
        expect(loaded.report.changedSchemas).toEqual([
            {typeName: "Leader", addedKeys: ["rank"], removedKeys: ["level"]},
            {typeName: "Squad", addedKeys: ["members"], removedKeys: []},
        ]);
    });
});

describe("prefab and data asset references", () => {
    function files(): Record<string, string> {
        const tuning = {format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION, type: "Tuning", fields: {minion: {path: NESTED_PREFAB_PATH}}};
        return {
            [SCENE_PATH]: JSON.stringify(document([{id: 1, name: "spawner", enabled: true, components: {
                Spawner: {waves: [{enemy: {path: PREFAB_PATH}}, {enemy: null}], tuning: {path: TUNING_PATH}, boss: {path: PREFAB_PATH}},
            }}])),
            [PREFAB_PATH]: prefabText({LocalPosition: {xyz: [SPAWN_POINT, 0, 0]}}),
            [TUNING_PATH]: JSON.stringify(tuning),
            [NESTED_PREFAB_PATH]: prefabText({LocalPosition: {xyz: [0, SPAWN_POINT, 0]}}),
        };
    }

    test("asset paths are collected from lists and structs, with their asset type", () => {
        const scene = parseSceneDocument(files()[SCENE_PATH]);
        expect(sceneAssetPaths(scene, registry())).toEqual([
            {kind: "prefab", path: PREFAB_PATH},
            {kind: "Tuning", path: TUNING_PATH},
        ]);
    });

    test("loading a scene preloads referenced prefabs and data assets, then what they reference", async () => {
        const platform = new MemoryPlatform({files: files()});
        const world = new World({platform});
        const batches: string[][] = [];
        const scenes = new SceneManager(world, registry(), {preload: async paths => {
            batches.push([...paths]);
        }});
        const handle = await scenes.load(SCENE_PATH);
        expect(batches).toEqual([[SCENE_PATH], [PREFAB_PATH, TUNING_PATH], [NESTED_PREFAB_PATH]]);
        expect(handle.path).toBe(SCENE_PATH);
    });

    test("prefab fields load as cached PrefabAssets whose documents instantiate", async () => {
        const platform = new MemoryPlatform({files: files()});
        const world = new World({platform});
        const schemas = registry();
        const scenes = new SceneManager(world, schemas);
        await scenes.load(SCENE_PATH);
        const spawnerEntity = world.entityManager.getComponent<Spawner>(spawnerOf(world), Spawner)!;
        expect(spawnerEntity.boss).toBeInstanceOf(PrefabAsset);
        expect(spawnerEntity.waves[0].enemy).toBe(spawnerEntity.boss);
        expect(spawnerEntity.waves[1].enemy).toBeUndefined();
        expect(spawnerEntity.boss!.sourcePath).toBe(PREFAB_PATH);
        expect(spawnerEntity.tuning).toBeInstanceOf(Tuning);
        expect(spawnerEntity.tuning!.minion!.sourcePath).toBe(NESTED_PREFAB_PATH);
        const spawned = instantiateDocument(world, schemas, spawnerEntity.boss!.document);
        expect(Array.from(asFloat32Array(world.entityManager.getComponent<LocalPosition>(spawned.roots[0], LocalPosition)!.xyz))).toEqual([SPAWN_POINT, 0, 0]);
        expect(serializeWorld(world, schemas).document.entities[0].components.Spawner).toEqual(JSON.parse(files()[SCENE_PATH]).entities[0].components.Spawner);
    });

    test("the platform loader without a DataAssets refuses data asset references", () => {
        const loader = platformSceneAssetLoader(new MemoryPlatform({files: files()}));
        expect(loader.loadPrefab(PREFAB_PATH)).toBe(loader.loadPrefab(PREFAB_PATH));
        expect(() => loader.loadDataAsset(TUNING_PATH, Tuning)).toThrow(`Loading the data asset "${TUNING_PATH}" needs a DataAssets resource`);
    });
});

function spawnerOf(world: World): Entity {
    return sceneEntitiesInCreationOrder(world).find(entity => world.entityManager.getComponent<Spawner>(entity, Spawner) !== undefined) ?? NULL_ENTITY;
}
