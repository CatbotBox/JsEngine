import {join} from "path";
import {describe, expect, test} from "../../engine/testing/harness";
import {DEV_DATA_ASSETS_EVENT, DEV_RELOAD_EVENT} from "../../hosts/web/devReload";
import {REPO_ROOT} from "../repoPaths";
import {classifyDevChanges, devPageEventOf, servedProjectFolders} from "./devChanges";

const DEMO_2D = join(REPO_ROOT, "demo", "2d");
const DEMO_3D = join(REPO_ROOT, "demo", "3d");
const PROJECTS: readonly string[] = [DEMO_2D, DEMO_3D];
const TUNING_2D = join(DEMO_2D, "assets", "config.asset.json");
const INPUT_2D = join(DEMO_2D, "assets", "input.asset.json");
const TUNING_3D = join(DEMO_3D, "assets", "config.asset.json");

describe("dev server change classification", () => {
    test("data assets of served projects apply in place, named by their site path", () => {
        expect(classifyDevChanges([TUNING_2D, TUNING_3D, INPUT_2D, TUNING_2D], PROJECTS)).toEqual({
            kind: "dataAssets",
            sitePaths: ["/2d/assets/config.asset.json", "/2d/assets/input.asset.json", "/3d/assets/config.asset.json"],
        });
    });

    test("the suffix is matched without regard to case", () => {
        expect(classifyDevChanges([join(DEMO_2D, "assets", "Boss.ASSET.JSON")], PROJECTS)).toEqual({kind: "dataAssets", sitePaths: ["/2d/assets/Boss.ASSET.JSON"]});
    });

    test("any code, scene, prefab or manifest change in the batch reloads the pages", () => {
        expect(classifyDevChanges([TUNING_2D, join(DEMO_2D, "game.ts")], PROJECTS)).toEqual({kind: "code"});
        expect(classifyDevChanges([join(DEMO_2D, "scenes", "main.scene.json")], PROJECTS)).toEqual({kind: "code"});
        expect(classifyDevChanges([join(DEMO_2D, "prefabs", "ship.prefab.json")], PROJECTS)).toEqual({kind: "code"});
        expect(classifyDevChanges([join(DEMO_2D, "jsengine.project.json")], PROJECTS)).toEqual({kind: "code"});
        expect(classifyDevChanges([join(REPO_ROOT, "src", "engine", "core", "world.ts")], PROJECTS)).toEqual({kind: "code"});
    });

    test("a data asset outside every served project reloads, and an empty batch reloads", () => {
        expect(classifyDevChanges([join(REPO_ROOT, "demo", "libraryOnly", "tuning.asset.json")], PROJECTS)).toEqual({kind: "code"});
        expect(classifyDevChanges([], PROJECTS)).toEqual({kind: "code"});
    });

    test("a code change sends reload; data assets send their site paths with the in-place event", () => {
        expect(devPageEventOf({kind: "code"})).toEqual({event: DEV_RELOAD_EVENT, data: {}, action: "reloading"});
        expect(devPageEventOf({kind: "dataAssets", sitePaths: ["/2d/assets/config.asset.json"]})).toEqual({
            event: DEV_DATA_ASSETS_EVENT,
            data: {paths: ["/2d/assets/config.asset.json"]},
            action: "applying /2d/assets/config.asset.json in place",
        });
    });

    test("one project is served alone; without one, every sample project is", () => {
        expect(servedProjectFolders(DEMO_2D)).toEqual([DEMO_2D]);
        expect(servedProjectFolders(undefined).includes(DEMO_2D)).toBe(true);
        expect(servedProjectFolders(undefined).includes(DEMO_3D)).toBe(true);
    });
});
