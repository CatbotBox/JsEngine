import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import {Component, FrameLoopSettings, Resource, UNCAPPED_RENDER_RATE} from "../../engine/core";
import type {Entity} from "../../engine/core";
import {NULL_ENTITY} from "../../engine/core/entity";
import {LocalPosition} from "../../engine/translation/localPosition";
import {componentSchema, DATA_ASSET_FORMAT, DATA_ASSET_VERSION, dataAssetsOf, parseSceneDocument, resourceSchema, UNIT_CUBE_MESH_PATH} from "../../engine/scene";
import {ask, disposeEditorWorlds, editorWorld, failureOf} from "./editorServiceTestHarness";
import type {Harnessed} from "./editorServiceTestHarness";

const TUNING_PATH = "data/swarm.tuning.asset.json";
const FILE_SPEED = 5;
const LIVE_SPEED = 8;
const START_SCORE = 3;

class Tuning extends Resource {
    public static readonly schema = resourceSchema(Tuning, "Tuning").number("speed").list("waves", {kind: "integer"}).build();
    public speed = 1;
    public waves: number[] = [];
}

class Score extends Resource {
    public static readonly schema = resourceSchema(Score, "Score").integer("points").entity("leader").build();
    public points = 0;
    public leader: Entity = NULL_ENTITY;
}

class Unplaced extends Resource {
    public static readonly schema = resourceSchema(Unplaced, "Unplaced").number("value").build();
    public value = 0;
}

class AudioSettings extends Component {
    public static readonly schema = componentSchema(AudioSettings, "AudioSettings").number("volume").category("Settings").build();
    public volume = 1;
}

const TUNING_TEXT = JSON.stringify({format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION, type: "Tuning", fields: {speed: FILE_SPEED, waves: [1, 2]}});

afterEach(disposeEditorWorlds);

function failed(op: string, reason: string): string {
    return `Editor request "${op}" failed: ${reason}`;
}

function settingsWorld(): Harnessed {
    const harnessed = editorWorld(world => {
        world.entityManager.createEntity("loop", [new FrameLoopSettings(), new AudioSettings()]);
        world.entityManager.createEntity("player", [new LocalPosition()]);
        const score = new Score();
        score.points = START_SCORE;
        world.resources.insert(score);
    }, {
        files: {[TUNING_PATH]: TUNING_TEXT},
        register: registry => {
            registry.registerResourceClasses([Tuning, Score, Unplaced]);
            registry.registerComponentClass(AudioSettings);
        },
    });
    harnessed.world.resources.insert(dataAssetsOf(harnessed.world, harnessed.registry).load(TUNING_PATH, Tuning));
    return harnessed;
}

describe("editor settings and resources", () => {
    test("listSettings names the entities holding Settings components and the resources the world holds", async () => {
        const harnessed = settingsWorld();
        const listed = await ask(harnessed, {op: "listSettings"});
        expect(listed.entities.map(entry => [entry.name, entry.enabled, entry.settingsComponentTypeNames])).toEqual([
            ["loop", true, ["AudioSettings", "FrameLoopSettings"]],
        ]);
        expect(listed.resources).toEqual([
            {typeName: "ActiveScene", dataAssetPath: null},
            {typeName: "Tuning", dataAssetPath: TUNING_PATH},
            {typeName: "Score", dataAssetPath: null},
        ]);
    });

    test("describeAssetTypes lists every asset type with its suffixes and marks data asset types", async () => {
        const harnessed = settingsWorld();
        const {assetTypes} = await ask(harnessed, {op: "describeAssetTypes"});
        expect(assetTypes.find(type => type.name === "mesh")).toEqual({name: "mesh", fileSuffixes: [".obj"], builtInPaths: [UNIT_CUBE_MESH_PATH], dataAsset: false});
        expect(assetTypes.find(type => type.name === "prefab")).toEqual({name: "prefab", fileSuffixes: [".prefab.json"], builtInPaths: [], dataAsset: false});
        expect(assetTypes.find(type => type.name === "Tuning")).toEqual({name: "Tuning", fileSuffixes: [".asset.json"], builtInPaths: [], dataAsset: true});
    });

    test("getResource encodes the fields and names a missing or unregistered resource", async () => {
        const harnessed = settingsWorld();
        expect(await ask(harnessed, {op: "getResource", typeName: "Tuning"})).toEqual({typeName: "Tuning", dataAssetPath: TUNING_PATH, fields: {speed: FILE_SPEED, waves: [1, 2]}});
        expect((await ask(harnessed, {op: "getResource", typeName: "Score"})).fields).toEqual({points: START_SCORE, leader: null});
        expect(await failureOf(ask(harnessed, {op: "getResource", typeName: "Unplaced"}))).toBe(failed("getResource", "The world holds no Unplaced resource"));
        expect(await failureOf(ask(harnessed, {op: "getResource", typeName: "Ghost"}))).toBe(failed("getResource", `No resource type named "Ghost" is registered`));
    });

    test("setResourceField is refused while editing and works during play; stopping restores the values from before play", async () => {
        const harnessed = settingsWorld();
        const tuning = harnessed.world.resources.get(Tuning);
        expect(await failureOf(ask(harnessed, {op: "setResourceField", typeName: "Tuning", key: "speed", value: LIVE_SPEED}))).toBe(failed("setResourceField", "Tuning is read-only while editing: resources are live game state, so edit them while the game plays or is paused"));
        expect(tuning.speed).toBe(FILE_SPEED);

        await ask(harnessed, {op: "setMode", mode: "play"});
        expect(await ask(harnessed, {op: "setResourceField", typeName: "Tuning", key: "speed", value: LIVE_SPEED})).toEqual({value: LIVE_SPEED});
        expect(await ask(harnessed, {op: "setResourceField", typeName: "Tuning", key: "waves", value: [4, 5, 6]})).toEqual({value: [4, 5, 6]});
        expect([tuning.speed, tuning.waves]).toEqual([LIVE_SPEED, [4, 5, 6]]);
        expect(await failureOf(ask(harnessed, {op: "setResourceField", typeName: "Tuning", key: "waves", value: [1.5]}))).toBe(failed("setResourceField", "Scene field Tuning.waves[0]: expected a whole number, got 1.5"));
        expect(await failureOf(ask(harnessed, {op: "setResourceField", typeName: "Tuning", key: "sped", value: 1}))).toBe(failed("setResourceField", `Tuning has no field "sped"`));

        await ask(harnessed, {op: "setMode", mode: "paused"});
        await ask(harnessed, {op: "setResourceField", typeName: "Score", key: "points", value: 9});
        expect(harnessed.world.resources.get(Score).points).toBe(9);

        await ask(harnessed, {op: "setMode", mode: "edit"});
        expect(harnessed.world.resources.get(Tuning)).toBe(tuning);
        expect([tuning.speed, tuning.waves]).toEqual([FILE_SPEED, [1, 2]]);
        expect(harnessed.world.resources.get(Score).points).toBe(START_SCORE);
    });

    test("saveScene leaves out resources loaded from a data asset and keeps the others", async () => {
        const harnessed = settingsWorld();
        const saved = parseSceneDocument((await ask(harnessed, {op: "saveScene"})).sceneText);
        expect(Object.keys(saved.resources ?? {})).toEqual(["Score"]);
        expect(saved.resources?.Score).toEqual({points: START_SCORE, leader: null});
    });

    test("FrameLoopSettings describes its rates as uncapped numbers and accepts Infinity", async () => {
        const harnessed = settingsWorld();
        const described = await ask(harnessed, {op: "describeSchemas"});
        const loop = described.components.find(component => component.typeName === "FrameLoopSettings")!;
        expect(loop.category).toBe("Settings");
        expect(loop.fields.filter(field => field.kind === "number" && field.uncapped === true).map(field => field.key)).toEqual(["renderRate", "cpuRenderRateLimit"]);
        const entity = (await ask(harnessed, {op: "listSettings"})).entities[0].entity;
        const {value} = await ask(harnessed, {op: "setField", entity, typeName: "FrameLoopSettings", key: "renderRate", value: "Infinity"});
        expect(value).toBe("Infinity");
        expect(harnessed.world.entityManager.getComponent<FrameLoopSettings>(entity, FrameLoopSettings)?.renderRate).toBe(UNCAPPED_RENDER_RATE);
    });
});
