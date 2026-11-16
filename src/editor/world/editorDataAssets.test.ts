import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import type {MemoryFileSource} from "../../engine/testing/memoryPlatform";
import {Resource} from "../../engine/core";
import type {Entity} from "../../engine/core";
import {NULL_ENTITY} from "../../engine/core/entity";
import {DATA_ASSET_FORMAT, DATA_ASSET_VERSION, DataAssets, dataAssetsOf, resourceSchema} from "../../engine/scene";
import type {SceneFieldValues} from "../../engine/scene";
import {isEditorEventMessage} from "../editorProtocol";
import type {EditorEvent} from "../editorProtocol";
import {attachEditorWorldService} from "./editorWorldService";
import {ask, disposeEditorWorlds, editorWorld, failureOf, waitUntil} from "./editorServiceTestHarness";
import type {Harnessed} from "./editorServiceTestHarness";

const TUNING_PATH = "data/tuning.asset.json";
const OTHER_TUNING_PATH = "data/other.asset.json";
const UNLOADED_PATH = "data/unloaded.asset.json";
const FILE_SPEED = 5;
const EDITED_SPEED = 9;
const PLAY_EDITED_SPEED = 12;
const LIVE_SPEED = 20;

class Tuning extends Resource {
    public static readonly schema = resourceSchema(Tuning, "Tuning").number("speed").list("waves", {kind: "integer"}).build();
    public speed = 1;
    public waves: number[] = [3];
}

class Focus extends Resource {
    public static readonly schema = resourceSchema(Focus, "Focus").entity("target").build();
    public target: Entity = NULL_ENTITY;
}

afterEach(disposeEditorWorlds);

function assetText(fields: SceneFieldValues, type = "Tuning"): string {
    return JSON.stringify({format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION, type, fields});
}

interface DataAssetWorld {
    readonly harnessed: Harnessed;
    readonly files: MemoryFileSource;
    readonly tuning: Tuning;
    readonly refetched: string[][];
}

function dataAssetWorld(): DataAssetWorld {
    const refetched: string[][] = [];
    const harnessed = editorWorld(undefined, {
        files: {
            [TUNING_PATH]: assetText({speed: FILE_SPEED, waves: [1, 2]}),
            [OTHER_TUNING_PATH]: assetText({speed: FILE_SPEED, waves: []}),
            [UNLOADED_PATH]: assetText({speed: FILE_SPEED, waves: []}),
        },
        register: registry => registry.registerResourceClasses([Tuning, Focus]),
        refetchFiles: async paths => {
            refetched.push([...paths]);
        },
    });
    const tuning = harnessed.world.resources.insert(dataAssetsOf(harnessed.world, harnessed.registry).load(TUNING_PATH, Tuning));
    return {harnessed, files: harnessed.world.platform.files as MemoryFileSource, tuning, refetched};
}

function consoleTexts(events: readonly EditorEvent[]): string[] {
    return events.flatMap(event => event.kind === "console" ? [`${event.level}: ${event.text}`] : []);
}

describe("editor data assets", () => {
    test("reloadDataAsset refetches the file and writes its values into the loaded instance while editing", async () => {
        const {harnessed, files, tuning, refetched} = dataAssetWorld();
        files.set(TUNING_PATH, assetText({speed: EDITED_SPEED, waves: [7]}));
        expect(await ask(harnessed, {op: "reloadDataAsset", path: `./${TUNING_PATH}`})).toEqual({reloaded: true});
        expect(refetched).toEqual([[`./${TUNING_PATH}`]]);
        expect(harnessed.world.resources.get(Tuning)).toBe(tuning);
        expect([tuning.speed, tuning.waves]).toEqual([EDITED_SPEED, [7]]);
    });

    test("a path no data asset was loaded from is ignored without fetching it", async () => {
        const {harnessed, refetched} = dataAssetWorld();
        expect(await ask(harnessed, {op: "reloadDataAsset", path: UNLOADED_PATH})).toEqual({reloaded: false});
        expect(await ask(harnessed, {op: "reloadDataAsset", path: "scenes/main.scene.json"})).toEqual({reloaded: false});
        expect(refetched).toEqual([]);
    });

    test("a reload during play applies live, and stopping keeps the file's values instead of the ones from before play", async () => {
        const {harnessed, files, tuning} = dataAssetWorld();
        const other = dataAssetsOf(harnessed.world, harnessed.registry).load(OTHER_TUNING_PATH, Tuning);
        await ask(harnessed, {op: "setMode", mode: "play"});
        await ask(harnessed, {op: "setResourceField", typeName: "Tuning", key: "waves", value: [9, 9]});
        files.set(TUNING_PATH, assetText({speed: PLAY_EDITED_SPEED, waves: [4]}));
        files.set(OTHER_TUNING_PATH, assetText({speed: PLAY_EDITED_SPEED, waves: [4]}));
        await ask(harnessed, {op: "reloadDataAsset", path: TUNING_PATH});
        await ask(harnessed, {op: "reloadDataAsset", path: OTHER_TUNING_PATH});
        expect([tuning.speed, tuning.waves, other.speed]).toEqual([PLAY_EDITED_SPEED, [4], PLAY_EDITED_SPEED]);
        await ask(harnessed, {op: "setResourceField", typeName: "Tuning", key: "speed", value: LIVE_SPEED});
        await ask(harnessed, {op: "setMode", mode: "edit"});
        expect(harnessed.world.resources.get(Tuning)).toBe(tuning);
        expect([tuning.speed, tuning.waves]).toEqual([PLAY_EDITED_SPEED, [4]]);
    });

    test("a reload whose file no longer decodes fails, naming the problem, and leaves the instance alone", async () => {
        const {harnessed, files, tuning} = dataAssetWorld();
        files.set(TUNING_PATH, assetText({speed: "fast"}));
        expect((await failureOf(ask(harnessed, {op: "reloadDataAsset", path: TUNING_PATH}))).includes("Tuning.speed")).toBe(true);
        expect(tuning.speed).toBe(FILE_SPEED);
    });

    test("defaultResourceFields encodes a freshly created resource and refuses ones a data asset cannot hold", async () => {
        const {harnessed} = dataAssetWorld();
        expect(await ask(harnessed, {op: "defaultResourceFields", typeName: "Tuning"})).toEqual({fields: {speed: 1, waves: [3]}});
        expect((await failureOf(ask(harnessed, {op: "defaultResourceFields", typeName: "Focus"}))).includes("Focus has entity fields, which a data asset cannot hold")).toBe(true);
        expect((await failureOf(ask(harnessed, {op: "defaultResourceFields", typeName: "Ghost"}))).includes(`No resource type named "Ghost" is registered`)).toBe(true);
    });

    test("the editor loads data assets in report mode and warns about schema changes in the Console, including ones from before it attached", async () => {
        const {harnessed, files} = dataAssetWorld();
        const dataAssets = harnessed.world.resources.get(DataAssets);
        expect(dataAssets.schemaChanges).toBe("report");
        files.set(UNLOADED_PATH, assetText({speed: FILE_SPEED, retired: true}));
        const loaded = dataAssets.load(UNLOADED_PATH, Tuning);
        expect(loaded.waves).toEqual([3]);
        const warning = `warn: Data asset ${UNLOADED_PATH}: Tuning changed: new fields waves start at their defaults; removed fields retired were dropped`;
        expect(await waitUntil(() => consoleTexts(harnessed.events).includes(warning))).toBe(true);

        harnessed.service.detach();
        const posted: unknown[] = [];
        const second = attachEditorWorldService({postMessage: message => posted.push(message), addEventListener: () => undefined}, harnessed.world, harnessed.registry, {});
        try {
            const events = posted.flatMap(message => isEditorEventMessage(message) ? [message.event] : []);
            expect(consoleTexts(events)).toEqual([warning]);
        } finally {
            second.detach();
        }
    });
});
