import {describe, expect, test} from "../../testing/harness";
import {Mesh} from "./mesh";
import {meshCachePathFor, readMeshCache} from "./meshCache";
import {packRgb} from "./material";

const fs = require("fs") as typeof import("fs");
const os = require("os") as typeof import("os");
const path = require("path") as typeof import("path");

const OBJ = `mtllib model.mtl
v 0 0 0
v 1 0 0
v 0 1 0
v 1 1 0
vt 0 0
vt 1 0
vt 0 1
vt 1 1
vn 0 0 1
usemtl red
f 1/1/1 2/2/1 3/3/1
usemtl blue
f 2/2/1 4/4/1 3/3/1
usemtl unlisted
f 1/1/1 3/3/1 4/4/1
`;
const MTL = "newmtl red\nKd 1 0 0\nnewmtl blue\nKd 0 0 1\n";

interface ModelFiles {
    objPath: string;
    mtlPath: string;
    cachePath: string;
}

function freshModel(): ModelFiles {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jsengine-meshcache-"));
    const objPath = path.join(directory, "model.obj");
    const mtlPath = path.join(directory, "model.mtl");
    fs.writeFileSync(objPath, OBJ);
    fs.writeFileSync(mtlPath, MTL);
    return {objPath, mtlPath, cachePath: meshCachePathFor(objPath)};
}

function describeMesh(mesh: Mesh) {
    return {
        data: Array.from(mesh.data.raw),
        vertexMaterial: Array.from(mesh.vertexMaterial),
        materials: mesh.materials.map(material => [material.name, material.diffuseColor]),
        secondTriangleMaterial: mesh.materialOfTriangle(1).name,
    };
}

describe("mesh cache", () => {
    test("the first load writes the cache and the second load reproduces the mesh from it", () => {
        const model = freshModel();
        const parsed = Mesh.fromFile(model.objPath);
        expect(fs.existsSync(model.cachePath)).toBe(true);
        const cachedWriteTime = fs.statSync(model.cachePath).mtimeMs;

        const fromCache = Mesh.fromFile(model.objPath);
        expect(fs.statSync(model.cachePath).mtimeMs).toBe(cachedWriteTime);
        expect(describeMesh(fromCache)).toEqual(describeMesh(parsed));
        expect(fromCache.vertCount).toBe(9);
        expect(fromCache.triangleCount).toBe(3);
        expect(fromCache.materials[2].name).toBe("unlisted");
        expect(fromCache.materials[2].diffuseColor).toBe(0xFFFFFF);
    });

    test("readMeshCache rejects stale, truncated and corrupt files", () => {
        const model = freshModel();
        Mesh.fromFile(model.objPath);
        const valid = readMeshCache(model.objPath)!;
        expect(valid.vertCount).toBe(9);
        expect(valid.triangleCount).toBe(3);
        expect(valid.materialNames).toEqual(["red", "blue", "unlisted"]);
        expect(valid.materialLibraryNames).toEqual(["model.mtl"]);

        const future = new Date(Date.now() + 5000);
        fs.utimesSync(model.objPath, future, future);
        expect(readMeshCache(model.objPath)).toBeUndefined();

        Mesh.fromFile(model.objPath);
        expect(readMeshCache(model.objPath)).toBeDefined();
        fs.appendFileSync(model.objPath, "\n");
        expect(readMeshCache(model.objPath)).toBeUndefined();

        Mesh.fromFile(model.objPath);
        fs.truncateSync(model.cachePath, fs.statSync(model.cachePath).size - 10);
        expect(readMeshCache(model.objPath)).toBeUndefined();

        Mesh.fromFile(model.objPath);
        const bytes = fs.readFileSync(model.cachePath);
        bytes[0] = 0;
        fs.writeFileSync(model.cachePath, bytes);
        expect(readMeshCache(model.objPath)).toBeUndefined();
    });

    test("materials come from the live .mtl on a cache hit", () => {
        const model = freshModel();
        Mesh.fromFile(model.objPath);
        fs.writeFileSync(model.mtlPath, "newmtl red\nKd 0 1 0\nnewmtl blue\nKd 0 0 1\n");
        const reloaded = Mesh.fromFile(model.objPath);
        expect(reloaded.materials[0].diffuseColor).toBe(packRgb(0, 1, 0));
        expect(readMeshCache(model.objPath)).toBeDefined();
    });

    test("cache: false loads without touching the disk cache", () => {
        const model = freshModel();
        const mesh = Mesh.fromFile(model.objPath, {cache: false});
        expect(mesh.triangleCount).toBe(3);
        expect(fs.existsSync(model.cachePath)).toBe(false);
    });
});
