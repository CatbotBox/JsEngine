import {describe, expect, test} from "../testing/harness";
import {Mesh} from "../rendering/3d/mesh";
import {MESH_CACHE_FORMAT_VERSION, meshCachePathFor} from "./meshCache";
import {MemoryFileSource} from "../testing/memoryPlatform";
import type * as Crypto from "crypto";

const crypto = require("crypto") as typeof Crypto;

const PINNED_MESH_CACHE = {
    version: 3,
    fingerprint: "8afb990ed2b6815d3efb3d78bc87b68370ec786e",
};

const FIXTURE_DIRECTORY = "/fixture";
const OBJ_PATH = `${FIXTURE_DIRECTORY}/model.obj`;
const MTL_PATH = `${FIXTURE_DIRECTORY}/model.mtl`;
const FIXED_MTIME_MS = 1;
const GRID_CELLS_PER_SIDE = 16;
const GRID_CELL_SIZE = 0.25;
const GRID_NORMAL_INDEX = 3;
const GRID_Z = 2;
const LOD_OPTIONS = {minTriangles: 100, minLevelTriangles: 10};

const HANDWRITTEN_OBJ = `mtllib model.mtl
# comment lines are skipped
v 0 0 0
v 1 0 0
v 0 1 0
v 0 0 1
v 1 1 0.5
vt 0 0
vt 1 0
vt 0 1
vt 0.5 0.5
vn 0 0 -1
vn 1 1 1
usemtl red
f 1/1/1 3/3/1 2/2/1
f 1/1 2/2 4/4
usemtl blue
f -5/1/2 -3/3/2 -2/4/2
f 2/2 5/4 3/3 4/1
`;

const MTL = "newmtl red\nKd 1 0 0\nnewmtl blue\nKd 0 0 1\nnewmtl grid\nKd 0.5 0.5 0.5\n";

function flatGridObj(firstVertexIndex: number): string {
    const lines = ["usemtl grid", "vn 0 0 1"];
    const vertsPerSide = GRID_CELLS_PER_SIDE + 1;
    for (let y = 0; y < vertsPerSide; y++) {
        for (let x = 0; x < vertsPerSide; x++) lines.push(`v ${x * GRID_CELL_SIZE} ${y * GRID_CELL_SIZE} ${GRID_Z}`);
    }

    const vertexAt = (x: number, y: number) => firstVertexIndex + y * vertsPerSide + x;
    for (let y = 0; y < GRID_CELLS_PER_SIDE; y++) {
        for (let x = 0; x < GRID_CELLS_PER_SIDE; x++) {
            const a = vertexAt(x, y), b = vertexAt(x + 1, y), c = vertexAt(x + 1, y + 1), d = vertexAt(x, y + 1);
            lines.push(`f ${a}//${GRID_NORMAL_INDEX} ${b}//${GRID_NORMAL_INDEX} ${c}//${GRID_NORMAL_INDEX}`, `f ${a}//${GRID_NORMAL_INDEX} ${c}//${GRID_NORMAL_INDEX} ${d}//${GRID_NORMAL_INDEX}`);
        }
    }
    return lines.join("\n") + "\n";
}

const HANDWRITTEN_VERTEX_COUNT = 5;
const FIXTURE_OBJ = HANDWRITTEN_OBJ + flatGridObj(HANDWRITTEN_VERTEX_COUNT + 1);

function meshCacheBytesForFixture(): {bytes: Uint8Array; lodLevels: number} {
    const files = new MemoryFileSource();
    files.set(OBJ_PATH, FIXTURE_OBJ, FIXED_MTIME_MS);
    files.set(MTL_PATH, MTL, FIXED_MTIME_MS);
    const mesh = Mesh.fromFile(OBJ_PATH, {files, lod: LOD_OPTIONS});
    return {bytes: files.readBytes(meshCachePathFor(OBJ_PATH)), lodLevels: mesh.lods.length - 1};
}

describe("mesh cache format version", () => {
    test("the fixture exercises generated normals, materials and LOD levels", () => {
        expect(meshCacheBytesForFixture().lodLevels).toBeGreaterThan(0);
    });

    test("MESH_CACHE_FORMAT_VERSION is bumped whenever the cached output changes", () => {
        const fingerprint = crypto.createHash("sha1").update(meshCacheBytesForFixture().bytes).digest("hex");
        const current = {version: MESH_CACHE_FORMAT_VERSION, fingerprint};
        if (current.version === PINNED_MESH_CACHE.version && current.fingerprint !== PINNED_MESH_CACHE.fingerprint) {
            throw new Error(
                `The mesh cache bytes changed (fingerprint ${current.fingerprint}, pinned ${PINNED_MESH_CACHE.fingerprint}) ` +
                `but MESH_CACHE_FORMAT_VERSION is still ${current.version}. ObjParser/MeshBuilder/LOD output or the cache ` +
                `layout changed, so stale .meshcache files would load the old geometry: bump MESH_CACHE_FORMAT_VERSION in ` +
                `meshCache.ts, rerun this test and pin the {version, fingerprint} it reports in PINNED_MESH_CACHE.`);
        }
        if (current.version !== PINNED_MESH_CACHE.version || current.fingerprint !== PINNED_MESH_CACHE.fingerprint) {
            throw new Error(
                `MESH_CACHE_FORMAT_VERSION is ${current.version} but PINNED_MESH_CACHE is ${JSON.stringify(PINNED_MESH_CACHE)}. ` +
                `If the version bump is intended, set PINNED_MESH_CACHE in meshCacheVersion.test.ts to ${JSON.stringify(current)}.`);
        }
        expect(current).toEqual(PINNED_MESH_CACHE);
    });
});
