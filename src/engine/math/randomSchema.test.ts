import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {World} from "../core";
import {ComponentSchemaRegistry} from "../scene/componentSchemaRegistry";
import {DATA_ASSET_FORMAT, DATA_ASSET_VERSION} from "../scene/dataAssetDocument";
import {dataAssetsOf} from "../scene/dataAssets";
import {registerSchemaEntries} from "../scene/schemaEntries";
import {Random} from "./random";
import {RANDOM_RESOURCE_NAME, RANDOM_SCHEMA_ENTRY} from "./randomSchema";

const RANDOM_PATH = "assets/random.asset.json";
const SEED = 20261116;
const DRAWS = 3;

function draws(random: Random): number[] {
    return Array.from({length: DRAWS}, () => random.next());
}

describe("Random schema", () => {
    test("a data asset seeds the Random it loads", () => {
        const text = JSON.stringify({format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION, type: RANDOM_RESOURCE_NAME, fields: {seed: SEED}});
        const world = new World({platform: new MemoryPlatform({files: {[RANDOM_PATH]: text}})});
        const registry = new ComponentSchemaRegistry();
        registerSchemaEntries(registry, [RANDOM_SCHEMA_ENTRY]);
        const loaded = dataAssetsOf(world, registry).load(RANDOM_PATH, Random);
        expect(loaded.seed).toBe(SEED);
        expect(draws(loaded)).toEqual(draws(new Random(SEED)));
    });

    test("setting the seed restarts the sequence only when it changes", () => {
        const random = new Random(SEED);
        const first = random.next();
        random.seed = SEED;
        expect(random.next()).not.toBe(first);
        random.seed = SEED + 1;
        expect(random.next()).toBe(new Random(SEED + 1).next());
    });
});
