import {describe, expect, test} from "../../engine/testing/harness";
import type {ProjectEntry} from "../project/projectFileSystem";
import {
    baseNameOf,
    buildProjectTree,
    extensionOf,
    fileNameProblem,
    findFolder,
    isAncestorFolder,
    joinProjectPath,
    normalizeProjectPath,
    parentFolderOf,
    projectFileKind,
    renamedPath,
    stemOf,
    uniqueChildPath,
} from "./projectFiles";

function file(path: string): ProjectEntry {
    return {path, kind: "file", size: 1, mtimeMs: 0};
}

function folder(path: string): ProjectEntry {
    return {path, kind: "directory", size: 0, mtimeMs: 0};
}

describe("project file typing", () => {
    test("scenes, prefabs, data assets, meshes, images and code are told apart by extension, case-insensitively", () => {
        expect(projectFileKind("scenes/Main.scene.json")).toBe("scene");
        expect(projectFileKind("prefabs/Ship.PREFAB.JSON")).toBe("prefab");
        expect(projectFileKind("assets/swarm.tuning.Asset.Json")).toBe("dataAsset");
        expect(projectFileKind("models/cube.obj")).toBe("mesh");
        expect(projectFileKind("art/a.png")).toBe("image");
        expect(projectFileKind("art/b.JPEG")).toBe("image");
        expect(projectFileKind("art/c.ppm")).toBe("image");
        expect(projectFileKind("project.ts")).toBe("code");
        expect(projectFileKind("src/Hud.TSX")).toBe("code");
        expect(projectFileKind("src/legacy.js")).toBe("code");
        expect(projectFileKind("src/module.mjs")).toBe("code");
        expect(projectFileKind("jsengine.project.json")).toBe("other");
        expect(projectFileKind("models/cube.mtl")).toBe("other");
    });

    test("stems drop compound scene, prefab and data asset extensions", () => {
        expect(stemOf("scenes/Main.scene.json")).toBe("Main");
        expect(stemOf("prefabs/Ship.prefab.json")).toBe("Ship");
        expect(stemOf("assets/swarm.tuning.asset.json")).toBe("swarm.tuning");
        expect(stemOf("models/cube.obj")).toBe("cube");
        expect(stemOf("README")).toBe("README");
        expect(extensionOf(".hidden")).toBe("");
    });
});

describe("project paths", () => {
    test("paths are normalised to forward slashes without leading or trailing slashes", () => {
        expect(normalizeProjectPath("./a\\b//c/")).toBe("a/b/c");
        expect(parentFolderOf("a/b/c.png")).toBe("a/b");
        expect(parentFolderOf("c.png")).toBe("");
        expect(baseNameOf("a/b/c.png")).toBe("c.png");
        expect(joinProjectPath("", "x.png")).toBe("x.png");
        expect(joinProjectPath("a/", "x.png")).toBe("a/x.png");
        expect(renamedPath("a/old.png", " new.png ")).toBe("a/new.png");
    });

    test("a folder is an ancestor of itself and its contents only", () => {
        expect(isAncestorFolder("art", "art/a.png")).toBe(true);
        expect(isAncestorFolder("art", "art")).toBe(true);
        expect(isAncestorFolder("art", "artwork/a.png")).toBe(false);
        expect(isAncestorFolder("", "anything")).toBe(true);
    });

    test("names with path separators or reserved spellings are rejected", () => {
        expect(fileNameProblem("ship.png")).toBeUndefined();
        expect(fileNameProblem("  ")).toBeDefined();
        expect(fileNameProblem("a/b")).toBeDefined();
        expect(fileNameProblem("..")).toBeDefined();
        expect(fileNameProblem("what?")).toBeDefined();
    });

    test("a new file name avoids existing ones by numbering", () => {
        const existing = new Set(["prefabs/Ship.prefab.json", "prefabs/Ship 1.prefab.json"]);
        expect(uniqueChildPath(existing, "prefabs", "Ship", ".prefab.json")).toBe("prefabs/Ship 2.prefab.json");
        expect(uniqueChildPath(existing, "", "Ship", ".prefab.json")).toBe("Ship.prefab.json");
    });
});

describe("project tree", () => {
    const tree = buildProjectTree([
        file("scenes/main.scene.json"),
        folder("art"),
        file("art/sprites/b.png"),
        file("art/a.png"),
        file("jsengine.project.json"),
        folder("empty"),
    ]);

    test("folders come from directory entries and from file paths, sorted by name", () => {
        expect(tree.folders.map(child => child.name)).toEqual(["art", "empty", "scenes"]);
        expect(findFolder(tree, "art")!.folders.map(child => child.path)).toEqual(["art/sprites"]);
        expect(findFolder(tree, "art/sprites")!.files.map(entry => entry.path)).toEqual(["art/sprites/b.png"]);
        expect(findFolder(tree, "missing")).toBeUndefined();
        expect(findFolder(tree, "")).toBe(tree);
    });

    test("files sit in their own folder", () => {
        expect(tree.files.map(entry => entry.path)).toEqual(["jsengine.project.json"]);
        expect(findFolder(tree, "art")!.files.map(entry => entry.path)).toEqual(["art/a.png"]);
    });
});
