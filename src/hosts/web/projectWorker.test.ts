import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {Resource, World} from "../../engine/core";
import {ComponentSchemaRegistry} from "../../engine/scene/componentSchemaRegistry";
import {resourceSchema} from "../../engine/scene/componentSchemaBuilder";
import {DATA_ASSET_FORMAT, DATA_ASSET_VERSION} from "../../engine/scene/dataAssetDocument";
import {dataAssetsOf} from "../../engine/scene/dataAssets";
import {PreloadedFileSource} from "./preloadedFileSource";
import type {FetchedFile} from "./preloadedFileSource";
import {reloadProjectDataAssets} from "./projectWorker";
import type {DataAssetReloadLog} from "./projectWorker";

const TUNING_PATH = "assets/tuning.asset.json";
const OTHER_PATH = "assets/other.asset.json";
const UNFETCHED_PATH = "assets/unfetched.asset.json";
const PROJECT_DIRECTORY = ".";
const SAVED_SPEED = 5;
const EDITED_SPEED = 9;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

class Tuning extends Resource {
    public static readonly schema = resourceSchema(Tuning, "Tuning").number("speed").build();
    public speed = 1;
}

function tuningText(fields: Record<string, unknown>): string {
    return JSON.stringify({format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION, type: "Tuning", fields});
}

function fetched(status: number, text = ""): FetchedFile {
    const bytes = new TextEncoder().encode(text);
    return {ok: status === HTTP_OK, status, arrayBuffer: async () => bytes.slice().buffer};
}

interface Setup {
    readonly served: Record<string, string>;
    readonly requested: string[];
    readonly files: PreloadedFileSource;
    readonly world: World;
    readonly tuning: Tuning;
}

async function setup(): Promise<Setup> {
    const served: Record<string, string> = {[TUNING_PATH]: tuningText({speed: SAVED_SPEED}), [OTHER_PATH]: tuningText({speed: SAVED_SPEED})};
    const requested: string[] = [];
    const files = new PreloadedFileSource({
        fetch: async url => {
            requested.push(url);
            const body = served[url];
            return body === undefined ? fetched(HTTP_NOT_FOUND) : fetched(HTTP_OK, body);
        },
    });
    await files.preload([TUNING_PATH, OTHER_PATH]);
    requested.length = 0;
    const world = new World({platform: new MemoryPlatform({fileSource: files})});
    const registry = new ComponentSchemaRegistry();
    registry.registerResourceClasses([Tuning]);
    const tuning = dataAssetsOf(world, registry).load(TUNING_PATH, Tuning);
    world.resources.insert(tuning);
    return {served, requested, files, world, tuning};
}

interface Logged extends DataAssetReloadLog {
    readonly infos: string[];
    readonly errors: string[];
}

function recordingLog(): Logged {
    const infos: string[] = [];
    const errors: string[] = [];
    return {infos, errors, info: text => infos.push(text), error: text => errors.push(text)};
}

describe("reloadProjectDataAssets (the game worker's in-place data asset apply)", () => {
    test("refetches the changed file and writes its values into the loaded resource, which holders keep", async () => {
        const {served, requested, files, world, tuning} = await setup();
        served[TUNING_PATH] = tuningText({speed: EDITED_SPEED});
        const logged = recordingLog();
        await reloadProjectDataAssets(world, files, PROJECT_DIRECTORY, [TUNING_PATH], logged);
        expect(tuning.speed).toBe(EDITED_SPEED);
        expect(world.resources.get(Tuning)).toBe(tuning);
        expect(requested).toEqual([TUNING_PATH]);
        expect([logged.infos, logged.errors]).toEqual([[`Reloaded the data asset ${TUNING_PATH}`], []]);
    });

    test("a fetched but unloaded asset is refetched without a reload; a never fetched one is left for its first load", async () => {
        const {served, requested, files, world} = await setup();
        served[OTHER_PATH] = tuningText({speed: EDITED_SPEED});
        served[UNFETCHED_PATH] = tuningText({speed: EDITED_SPEED});
        const logged = recordingLog();
        await reloadProjectDataAssets(world, files, PROJECT_DIRECTORY, [OTHER_PATH, UNFETCHED_PATH], logged);
        expect(requested).toEqual([OTHER_PATH]);
        expect(files.readText(OTHER_PATH)).toBe(served[OTHER_PATH]);
        expect(files.exists(UNFETCHED_PATH)).toBe(false);
        expect([logged.infos, logged.errors]).toEqual([[], []]);
    });

    test("an invalid edit is logged and the resource keeps its previous values", async () => {
        const {served, files, world, tuning} = await setup();
        served[TUNING_PATH] = tuningText({speed: EDITED_SPEED, unknownField: 1});
        const unknownField = recordingLog();
        await reloadProjectDataAssets(world, files, PROJECT_DIRECTORY, [TUNING_PATH], unknownField);
        served[TUNING_PATH] = "{not json";
        const broken = recordingLog();
        await reloadProjectDataAssets(world, files, PROJECT_DIRECTORY, [TUNING_PATH], broken);
        expect(tuning.speed).toBe(SAVED_SPEED);
        expect(unknownField.infos).toEqual([]);
        expect(unknownField.errors.length).toBe(1);
        expect(unknownField.errors[0].startsWith(`Could not reload the data asset ${TUNING_PATH}; the game keeps its previous values: `)).toBe(true);
        expect(unknownField.errors[0].includes("unknownField")).toBe(true);
        expect(broken.errors.length).toBe(1);
    });

    test("a deleted asset is logged as missing and keeps its values", async () => {
        const {served, files, world, tuning} = await setup();
        delete served[TUNING_PATH];
        const logged = recordingLog();
        await reloadProjectDataAssets(world, files, PROJECT_DIRECTORY, [TUNING_PATH], logged);
        expect(tuning.speed).toBe(SAVED_SPEED);
        expect(logged.errors.length).toBe(1);
        expect(logged.errors[0].includes("does not exist")).toBe(true);
    });

    test("a failed refetch is logged and nothing is reloaded", async () => {
        const world = new World({platform: new MemoryPlatform()});
        const logged = recordingLog();
        await reloadProjectDataAssets(world, {exists: () => true, refetch: async () => Promise.reject(new Error("offline"))}, PROJECT_DIRECTORY, [TUNING_PATH], logged);
        expect(logged.infos).toEqual([]);
        expect(logged.errors).toEqual([`Could not refetch the data assets ${TUNING_PATH}; the game keeps their previous values: offline`]);
    });
});
