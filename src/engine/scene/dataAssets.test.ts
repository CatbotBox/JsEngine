import {describe, expect, test} from "../testing/harness";
import {MemoryFileSource, MemoryPlatform} from "../testing/memoryPlatform";
import {Component, Resource, World} from "../core";
import type {Entity} from "../core";
import {NULL_ENTITY} from "../core/entity";
import {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {componentSchema, resourceSchema, structFields} from "./componentSchemaBuilder";
import {DATA_ASSET_FORMAT, DATA_ASSET_VERSION, dataAssetPathOf, parseDataAssetDocument} from "./dataAssetDocument";
import {DataAssets, dataAssetsOf, encodeDataAssetFields, serializeDataAsset} from "./dataAssets";
import type {DataAssetReloaded, DataAssetSchemaChanges} from "./dataAssets";
import {describeSchemaChange} from "./schemaChanges";
import {registerEngineComponentSchemas} from "./engineComponentSchemas";
import {SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "./sceneDocument";
import type {SceneFieldValues} from "./sceneDocument";
import {SceneManager} from "./sceneManager";
import {serializeWorld} from "./sceneSerialization";

const TUNING_PATH = "data/swarm.tuning.asset.json";
const STATE_PATH = "data/state.asset.json";
const MISSING_PATH = "data/missing.asset.json";
const DEFAULT_SPEED = 2;
const SAVED_SPEED = 5;
const RELOADED_SPEED = 9;
const DEFAULT_WAVES: readonly number[] = [1];

class Range {
    public min = 0;
    public max = 1;
}

class Tuning extends Resource {
    public static readonly schema = resourceSchema(Tuning, "Tuning")
        .number("speed")
        .nullableNumber("limit", {uncapped: true})
        .list("waves", {kind: "integer"})
        .struct("spread", structFields<Range>().number("min").number("max").build(), {typeName: "Range", create: () => new Range()})
        .build();

    public speed = DEFAULT_SPEED;
    public limit: number | undefined = undefined;
    public waves: number[] = [...DEFAULT_WAVES];
    public spread = new Range();
}

class Score extends Resource {
    public static readonly schema = resourceSchema(Score, "Score").integer("points").build();
    public points = 0;
}

class Focus extends Resource {
    public static readonly schema = resourceSchema(Focus, "Focus").entity("target").build();
    public target: Entity = NULL_ENTITY;
}

class Unregistered extends Resource {
}

class Spawner extends Component {
    public static readonly schema = componentSchema(Spawner, "Spawner").dataAsset("tuning", Tuning).build();
    public tuning: Tuning | undefined = undefined;
}

function registry(): ComponentSchemaRegistry {
    const result = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(result);
    result.registerResourceClasses([Tuning, Score, Focus]);
    result.registerComponentClass(Spawner);
    return result;
}

function assetText(type: string, fields: SceneFieldValues, version: number = DATA_ASSET_VERSION): string {
    return JSON.stringify({format: DATA_ASSET_FORMAT, version, type, fields});
}

interface Setup {
    readonly files: MemoryFileSource;
    readonly world: World;
    readonly schemas: ComponentSchemaRegistry;
    readonly assets: DataAssets;
}

function setup(): Setup {
    const files = new MemoryFileSource({
        [TUNING_PATH]: assetText("Tuning", {speed: SAVED_SPEED, limit: "Infinity", spread: {max: 4}}),
        [STATE_PATH]: assetText("Score", {points: 3}),
    });
    const world = new World({platform: new MemoryPlatform({fileSource: files})});
    const schemas = registry();
    return {files, world, schemas, assets: dataAssetsOf(world, schemas)};
}

describe("DataAssets", () => {
    test("loads a file into a created resource, keeping defaults for keys the file leaves out, and caches it by path", () => {
        const {assets} = setup();
        const tuning = assets.load(TUNING_PATH, Tuning);
        expect(tuning).toBeInstanceOf(Tuning);
        expect([tuning.speed, tuning.limit, tuning.waves]).toEqual([SAVED_SPEED, Number.POSITIVE_INFINITY, DEFAULT_WAVES]);
        expect(tuning.spread).toBeInstanceOf(Range);
        expect([tuning.spread.min, tuning.spread.max]).toEqual([0, 4]);
        expect(assets.load(`./${TUNING_PATH}`, Tuning)).toBe(tuning);
        expect(assets.load(TUNING_PATH)).toBe(tuning);
        expect(dataAssetPathOf(tuning)).toBe(TUNING_PATH);
    });

    test("a type mismatch, a missing file, an unregistered type and unknown fields each throw naming the path", () => {
        const {files, assets} = setup();
        expect(() => assets.load(STATE_PATH, Tuning)).toThrow(`Data asset "${STATE_PATH}": expected a Tuning, but the file holds a Score`);
        assets.load(TUNING_PATH, Tuning);
        expect(() => assets.load(TUNING_PATH, Score)).toThrow(`Data asset "${TUNING_PATH}": expected a Score, but the file holds a Tuning`);
        expect(() => assets.load(MISSING_PATH, Tuning)).toThrow(`Data asset "${MISSING_PATH}" does not exist`);
        files.set("data/ghost.asset.json", assetText("Ghost", {}));
        expect(() => assets.load("data/ghost.asset.json")).toThrow(`Data asset "data/ghost.asset.json": the resource type "Ghost" is not registered`);
        files.set("data/typo.asset.json", assetText("Score", {pionts: 3}));
        expect(() => assets.load("data/typo.asset.json")).toThrow(`Data asset "data/typo.asset.json": Score has no field "pionts"`);
        files.set("data/bad.asset.json", assetText("Score", {points: 1.5}));
        expect(() => assets.load("data/bad.asset.json")).toThrow(`Scene field data/bad.asset.json Score.points: expected a whole number, got 1.5`);
    });

    test("in report mode, keys the schema lost are dropped, keys it gained keep their defaults, and both are listed per path", () => {
        const files = new MemoryFileSource({
            [TUNING_PATH]: assetText("Tuning", {speed: SAVED_SPEED, retired: 1, waves: [2], spread: {min: 1, max: 2, width: 3}}),
        });
        const world = new World({platform: new MemoryPlatform({fileSource: files})});
        const assets = dataAssetsOf(world, registry(), world.platform, {schemaChanges: "report"});
        const reported: DataAssetSchemaChanges[] = [];
        assets.onSchemaChanged.add(report => reported.push(report));
        const tuning = assets.load(TUNING_PATH, Tuning);
        expect([tuning.speed, tuning.limit, tuning.waves, tuning.spread.min, tuning.spread.max]).toEqual([SAVED_SPEED, undefined, [2], 1, 2]);
        expect("retired" in tuning).toBe(false);
        const changes = [
            {typeName: "Range", addedKeys: [], removedKeys: ["width"]},
            {typeName: "Tuning", addedKeys: ["limit"], removedKeys: ["retired"]},
        ];
        expect(assets.schemaChangesOf(TUNING_PATH)).toEqual(changes);
        expect(assets.schemaChangeReports()).toEqual([{path: TUNING_PATH, changes}]);
        expect(reported).toEqual([{path: TUNING_PATH, changes}]);
        expect(describeSchemaChange(changes[1])).toBe("Tuning changed: new fields limit start at their defaults; removed fields retired were dropped");
        files.set(TUNING_PATH, assetText("Tuning", {speed: RELOADED_SPEED, limit: null, waves: [], spread: {min: 0, max: 1}}));
        assets.reload(TUNING_PATH);
        expect(tuning.speed).toBe(RELOADED_SPEED);
        expect(assets.schemaChangesOf(TUNING_PATH)).toEqual([]);
        expect(assets.schemaChangeReports()).toEqual([]);
    });

    test("strict mode, the default, refuses keys the schema does not have, nested ones included", () => {
        const {files, assets} = setup();
        expect(assets.schemaChanges).toBe("strict");
        files.set("data/nested.asset.json", assetText("Tuning", {spread: {min: 0, width: 3}}));
        expect(() => assets.load("data/nested.asset.json")).toThrow(`has no field "width"`);
        files.set("data/sparse.asset.json", assetText("Tuning", {speed: SAVED_SPEED}));
        assets.load("data/sparse.asset.json");
        expect(assets.schemaChangesOf("data/sparse.asset.json")).toEqual([]);
    });

    test("a scene manager hands its schema change policy to the DataAssets it creates", () => {
        const world = new World({platform: new MemoryPlatform()});
        new SceneManager(world, registry(), {schemaChanges: "report"});
        expect(world.resources.get(DataAssets).schemaChanges).toBe("report");
    });

    test("isLoaded and encodeDataAssetFields", () => {
        const {assets, schemas} = setup();
        expect(assets.isLoaded(TUNING_PATH)).toBe(false);
        assets.load(TUNING_PATH, Tuning);
        expect(assets.isLoaded(`./${TUNING_PATH}`)).toBe(true);
        expect(encodeDataAssetFields(schemas, new Tuning())).toEqual({speed: DEFAULT_SPEED, limit: null, waves: [...DEFAULT_WAVES], spread: {min: 0, max: 1}});
        expect(() => encodeDataAssetFields(schemas, new Focus())).toThrow("Focus has entity fields");
    });

    test("resources with entity fields cannot be data assets", () => {
        const {files, assets, schemas} = setup();
        files.set("data/focus.asset.json", assetText("Focus", {target: null}));
        expect(() => assets.load("data/focus.asset.json")).toThrow(`Data asset "data/focus.asset.json": Focus has entity fields, which a data asset cannot hold`);
        expect(() => serializeDataAsset(schemas, new Focus())).toThrow("Focus has entity fields");
        expect(() => serializeDataAsset(schemas, new Unregistered())).toThrow("Unregistered has no registered resource schema");
    });

    test("reload writes the file's values into the cached instance and announces it", () => {
        const {files, assets} = setup();
        const tuning = assets.load(TUNING_PATH, Tuning);
        const reloads: DataAssetReloaded[] = [];
        assets.onReloaded.add(reload => reloads.push(reload));
        files.set(TUNING_PATH, assetText("Tuning", {speed: RELOADED_SPEED, waves: [2, 3]}));
        expect(assets.reload(TUNING_PATH)).toBe(tuning);
        expect([tuning.speed, tuning.limit, tuning.waves, tuning.spread.max]).toEqual([RELOADED_SPEED, undefined, [2, 3], 1]);
        expect(reloads).toEqual([{path: TUNING_PATH, asset: tuning}]);
        expect(assets.reload(MISSING_PATH)).toBeUndefined();
    });

    test("a reload that fails to decode leaves the instance as it was", () => {
        const {files, assets} = setup();
        const tuning = assets.load(TUNING_PATH, Tuning);
        files.set(TUNING_PATH, assetText("Tuning", {speed: RELOADED_SPEED, waves: ["x"]}));
        expect(() => assets.reload(TUNING_PATH)).toThrow("waves[0]: expected a whole number");
        expect(tuning.speed).toBe(SAVED_SPEED);
        files.set(TUNING_PATH, assetText("Score", {}));
        expect(() => assets.reload(TUNING_PATH)).toThrow(`Data asset "${TUNING_PATH}": expected a Tuning, but the file now holds a Score`);
    });

    test("serialize writes the document the loader reads back", () => {
        const {files, assets} = setup();
        const tuning = assets.load(TUNING_PATH, Tuning);
        tuning.waves = [4, 5];
        const text = assets.serialize(tuning);
        expect(text.endsWith("}\n")).toBe(true);
        expect(text.split("\n")[1]).toBe(`  "format": "${DATA_ASSET_FORMAT}",`);
        expect(parseDataAssetDocument(text)).toEqual({
            format: DATA_ASSET_FORMAT,
            version: DATA_ASSET_VERSION,
            type: "Tuning",
            fields: {speed: SAVED_SPEED, limit: "Infinity", waves: [4, 5], spread: {min: 0, max: 4}},
        });
        files.set("data/copy.asset.json", text);
        expect(assets.load("data/copy.asset.json", Tuning).waves).toEqual([4, 5]);
    });

    test("documents with the wrong shape or a newer version are refused", () => {
        expect(() => parseDataAssetDocument("{", TUNING_PATH)).toThrow(`Data asset "${TUNING_PATH}" is not valid JSON`);
        expect(() => parseDataAssetDocument({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION})).toThrow(`Data asset: format must be "${DATA_ASSET_FORMAT}"`);
        expect(() => parseDataAssetDocument(assetText("Tuning", {}, DATA_ASSET_VERSION + 1), TUNING_PATH))
            .toThrow(`Data asset "${TUNING_PATH}": version ${DATA_ASSET_VERSION + 1} is newer than the supported version ${DATA_ASSET_VERSION}`);
        expect(() => parseDataAssetDocument({format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION, type: ""})).toThrow("type must be a resource type name");
        expect(parseDataAssetDocument({format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION, type: "Score"}).fields).toEqual({});
    });

    test("a component's data asset field shares the loaded instance and saves its path", async () => {
        const {world, schemas, assets} = setup();
        const scenes = new SceneManager(world, schemas);
        const tuning = assets.load(TUNING_PATH, Tuning);
        const loaded = scenes.loadDocument({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: [
            {id: 1, name: "spawner", enabled: true, components: {Spawner: {tuning: {path: TUNING_PATH}}}},
        ]});
        const spawner = world.entityManager.getComponent<Spawner>(loaded.entities[0], Spawner)!;
        expect(spawner.tuning).toBe(tuning);
        expect(serializeWorld(world, schemas).document.entities[0].components.Spawner).toEqual({tuning: {path: TUNING_PATH}});
        spawner.tuning = new Tuning();
        expect(serializeWorld(world, schemas).report.unsavedAssets).toEqual(["entities[0].components.Spawner.tuning"]);
    });

    test("dataAssetsOf keeps one DataAssets per world, and it cannot be created without its arguments", () => {
        const {world, schemas, assets} = setup();
        expect(dataAssetsOf(world, schemas)).toBe(assets);
        expect(() => world.resources.getOrCreate(DataAssets)).not.toThrow();
        expect(() => new World({platform: new MemoryPlatform()}).resources.getOrCreate(DataAssets)).toThrow("DataAssets needs a schema registry");
    });

    test("reading a required resource nobody loaded names the type and the manifest", () => {
        const {world} = setup();
        expect(() => world.resources.get(Score)).toThrow(`The required resource Score was not loaded: list it under "resources" in jsengine.project.json`);
    });
});
