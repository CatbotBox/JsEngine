import {describe, expect, test} from "../../engine/testing/harness";
import type {ProjectEntry} from "../project/projectFileSystem";
import {projectItemsOf} from "./projectFiles";
import {isProjectSearchActive, projectSearchResults} from "./projectSearch";

function file(path: string): ProjectEntry {
    return {path, kind: "file", size: 1, mtimeMs: 0};
}

function folder(path: string): ProjectEntry {
    return {path, kind: "directory", size: 0, mtimeMs: 0};
}

const ITEMS = projectItemsOf([
    folder("art"),
    file("art/Player.png"),
    file("art/player.obj"),
    folder("art/players"),
    file("scenes/main.scene.json"),
    file("prefabs/player.prefab.json"),
    file("data/tuning.asset.json"),
    file("game.ts"),
]);

function paths(text: string): string[] {
    return projectSearchResults(ITEMS, text).map(item => item.path);
}

describe("project search", () => {
    test("matches file and folder names anywhere in the project, folders first, then by name", () => {
        expect(paths("player")).toEqual(["art/players", "art/player.obj", "art/Player.png", "prefabs/player.prefab.json"]);
    });

    test("t: filters by kind, by its key or its title", () => {
        expect(paths("t:image")).toEqual(["art/Player.png"]);
        expect(paths("player t:mesh")).toEqual(["art/player.obj"]);
        expect(paths("t:dataasset")).toEqual(["data/tuning.asset.json"]);
        expect(paths("t:folder")).toEqual(["art", "art/players"]);
        expect(paths("t:code")).toEqual(["game.ts"]);
    });

    test("a blank search is inactive, and a search that matches nothing finds nothing", () => {
        expect(isProjectSearchActive("   ")).toBe(false);
        expect(isProjectSearchActive("t:scene")).toBe(true);
        expect(paths("nothing-has-this-name")).toEqual([]);
    });

    test("the folders implied by file paths are not items of their own", () => {
        expect(ITEMS.some(item => item.path === "scenes")).toBe(false);
        expect(ITEMS.find(item => item.path === "art/players")?.kind).toBe("folder");
    });
});
