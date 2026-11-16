import {describe, expect, test} from "../../engine/testing/harness";
import {DATA_ASSET_FORMAT, DATA_ASSET_VERSION} from "../../engine/scene";
import type {ProjectEntry} from "../project/projectFileSystem";
import {dataAssetTypeOf, filesWithSuffixes, matchesFileSuffix} from "./assetChoices";

const IMAGE_SUFFIXES = [".png", ".jpg"];
const DATA_ASSET_SUFFIXES = [".asset.json"];

const NO_SIZE = 0;
const NO_TIME_MS = 0;

function entry(path: string, kind: ProjectEntry["kind"]): ProjectEntry {
    return {path, kind, size: NO_SIZE, mtimeMs: NO_TIME_MS};
}

function file(path: string): ProjectEntry {
    return entry(path, "file");
}

describe("asset choices", () => {
    test("a path matches a suffix whatever its case", () => {
        expect(matchesFileSuffix("sprites/Ship.PNG", IMAGE_SUFFIXES)).toBe(true);
        expect(matchesFileSuffix("sprites/ship.png.txt", IMAGE_SUFFIXES)).toBe(false);
        expect(matchesFileSuffix("data/swarm.tuning.asset.json", DATA_ASSET_SUFFIXES)).toBe(true);
        expect(matchesFileSuffix("scenes/main.scene.json", DATA_ASSET_SUFFIXES)).toBe(false);
    });

    test("only files with a matching suffix are offered, normalized and sorted by name", () => {
        const entries: ProjectEntry[] = [
            file("./sprites/b10.png"),
            file("sprites/b2.png"),
            entry("sprites/folder.png", "directory"),
            file("sprites/notes.txt"),
            file("a.jpg"),
        ];
        expect(filesWithSuffixes(entries, IMAGE_SUFFIXES)).toEqual(["a.jpg", "sprites/b2.png", "sprites/b10.png"]);
    });

    test("a data asset's type comes from its document; anything else has none", () => {
        expect(dataAssetTypeOf(JSON.stringify({format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION, type: "SwarmTuning", fields: {}}))).toBe("SwarmTuning");
        expect(dataAssetTypeOf(JSON.stringify({format: "jsengine-scene", type: "SwarmTuning"}))).toBeUndefined();
        expect(dataAssetTypeOf(JSON.stringify({format: DATA_ASSET_FORMAT, type: 3}))).toBeUndefined();
        expect(dataAssetTypeOf("{not json")).toBeUndefined();
    });
});
