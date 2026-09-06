import {describe, expect, test} from "../../testing/harness";
import {Vec} from "../../math/types/vec";
import {Mesh, MeshBuilder} from "./mesh";
import {Material} from "./material";
import {buildLodParts, selectLodLevel} from "./meshLod";
import {meshCachePathFor} from "./meshCache";

const fs = require("fs") as typeof import("fs");
const os = require("os") as typeof import("os");
const path = require("path") as typeof import("path");

/** n x n quads on the XZ plane over [0,1]², uv = (x, z), normals +Y; materials alternate by vertex column. */
function tessellatedPlane(n: number, materialCount = 1): Mesh {
    const builder = new MeshBuilder();
    for (let m = 0; m < materialCount; m++) builder.materials.push(new Material(`m${m}`));
    for (let row = 0; row <= n; row++) {
        for (let column = 0; column <= n; column++) {
            builder.vertices.push(Vec.alloc3(column / n, 0, row / n));
            builder.normals.push(Vec.alloc3(0, 1, 0));
            builder.uvs.push(Vec.alloc2(column / n, row / n));
            builder.vertexMaterial.push(column % materialCount);
        }
    }
    const stride = n + 1;
    for (let row = 0; row < n; row++) {
        for (let column = 0; column < n; column++) {
            const a = row * stride + column, b = a + 1, c = a + stride, d = c + 1;
            builder.triangles.push(Vec.of<3>([a, c, b]));
            builder.triangles.push(Vec.of<3>([b, c, d]));
        }
    }
    return new Mesh(builder);
}

function planeObj(n: number): string {
    const lines: string[] = [];
    for (let row = 0; row <= n; row++) {
        for (let column = 0; column <= n; column++) {
            lines.push(`v ${column / n} 0 ${row / n}`);
            lines.push(`vt ${column / n} ${row / n}`);
        }
    }
    lines.push("vn 0 1 0");
    const stride = n + 1;
    for (let row = 0; row < n; row++) {
        for (let column = 0; column < n; column++) {
            const a = row * stride + column + 1, b = a + 1, c = a + stride, d = c + 1;
            lines.push(`f ${a}/${a}/1 ${c}/${c}/1 ${d}/${d}/1 ${b}/${b}/1`);
        }
    }
    return lines.join("\n") + "\n";
}

function expectWellFormed(level: Mesh, source: Mesh): void {
    const corners = level.triangles.raw;
    for (let k = 0; k < corners.length; k += 3) {
        const a = corners[k], b = corners[k + 1], c = corners[k + 2];
        expect(a !== b && b !== c && a !== c).toBe(true);
        for (const corner of [a, b, c]) {
            expect(corner >= 0 && corner < level.vertCount && corner === Math.floor(corner)).toBe(true);
        }
    }
    const normals = level.normals.raw, uvs = level.uvs.raw;
    for (let v = 0; v < level.vertCount; v++) {
        expect(Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2])).toBeCloseTo(1, 5);
        expect(uvs[v * 3] >= 0 && uvs[v * 3] <= 1 && uvs[v * 3 + 1] >= 0 && uvs[v * 3 + 1] <= 1).toBe(true);
        expect(level.vertexMaterial[v] < level.materials.length).toBe(true);
    }
    const inner = level.bounds, outer = source.bounds;
    for (let axis = 0; axis < 3; axis++) {
        expect(inner[axis]).toBeGreaterThan(outer[axis] - 1e-5);
        expect(inner[axis + 3]).toBeLessThan(outer[axis + 3] + 1e-5);
    }
}

describe("mesh detail levels", () => {
    test("a mesh below the triangle threshold gets no coarser levels", () => {
        const plane = tessellatedPlane(4);
        expect(buildLodParts(plane).length).toBe(0);
        expect(Mesh.buildLods(plane).length).toBe(0);
        expect(plane.lods.length).toBe(1);
        expect(plane.lods[0]).toBe(plane);
    });

    test("each level lands near a quarter of the previous one, stays well formed and inside the source bounds", () => {
        const plane = tessellatedPlane(64);
        const levels = Mesh.buildLods(plane, {minTriangles: 0, maxLevels: 3, minLevelTriangles: 0});
        expect(levels.length).toBe(3);
        let previous = plane;
        for (const level of levels) {
            const reduction = previous.triangleCount / level.triangleCount;
            expect(reduction).toBeGreaterThan(4 / 1.4);
            expect(reduction).toBeLessThan(4 * 1.4);
            expect(level.vertCount).toBeLessThan(previous.vertCount);
            expectWellFormed(level, plane);
            previous = level;
        }
        plane.attachLods(levels);
        expect(plane.lods.length).toBe(levels.length + 1);
        expect(plane.lods[0]).toBe(plane);
    });

    test("a mesh too small to reduce ends with no levels", () => {
        const plane = tessellatedPlane(1);
        expect(buildLodParts(plane, {minTriangles: 0, maxLevels: 3}).length).toBe(0);
    });

    test("the chain stops at the minimum level size", () => {
        const plane = tessellatedPlane(32);
        const levels = Mesh.buildLods(plane, {minTriangles: 0, maxLevels: 6, minLevelTriangles: 400});
        expect(levels.length).toBeGreaterThan(0);
        expect(levels[levels.length - 1].triangleCount).toBeLessThan(400);
        for (let i = 0; i < levels.length - 1; i++) expect(levels[i].triangleCount >= 400).toBe(true);
    });

    test("clusters never merge across materials", () => {
        const plane = tessellatedPlane(16, 2);
        const [level] = Mesh.buildLods(plane, {minTriangles: 0, maxLevels: 1});
        expect(level).toBeDefined();
        expect(level.materials.length).toBe(2);
        const used = new Set(Array.from(level.vertexMaterial));
        expect(used.size).toBe(2);
        const corners = level.triangles.raw;
        let mixedTriangles = 0;
        for (let k = 0; k < corners.length; k += 3) {
            const a = level.vertexMaterial[corners[k]], b = level.vertexMaterial[corners[k + 1]], c = level.vertexMaterial[corners[k + 2]];
            if (a !== b || b !== c) mixedTriangles++;
        }
        expect(mixedTriangles).toBeGreaterThan(0);
        expect(level.triangleCount).toBeLessThan(plane.triangleCount);
    });

    test("selectLodLevel takes the finest level within budget, the coarsest when none fits, and clamps the bias", () => {
        const lods = [{triangleCount: 2000}, {triangleCount: 500}, {triangleCount: 120}, {triangleCount: 30}];
        expect(selectLodLevel(lods, 100, 100, 2)).toBe(0);
        expect(selectLodLevel(lods, 20, 20, 2)).toBe(1);
        expect(selectLodLevel(lods, 10, 10, 2)).toBe(2);
        expect(selectLodLevel(lods, 1, 1, 2)).toBe(3);
        expect(selectLodLevel(lods, 20, 20, 2, 1)).toBe(2);
        expect(selectLodLevel(lods, 20, 20, 2, -5)).toBe(0);
        expect(selectLodLevel(lods, 20, 20, 2, 9)).toBe(3);
        expect(selectLodLevel([lods[0]], 1, 1, 2)).toBe(0);
    });

    test("levels round-trip through the mesh cache and share the mesh's materials", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jsengine-meshlod-"));
        const objPath = path.join(directory, "plane.obj");
        fs.writeFileSync(objPath, planeObj(16));
        const lod = {minTriangles: 0, maxLevels: 3, minLevelTriangles: 0};

        const parsed = Mesh.fromFile(objPath, {lod});
        expect(fs.existsSync(meshCachePathFor(objPath))).toBe(true);
        expect(parsed.lods.length).toBeGreaterThan(1);

        const fromCache = Mesh.fromFile(objPath, {lod});
        expect(fromCache.lods.length).toBe(parsed.lods.length);
        for (let i = 1; i < parsed.lods.length; i++) {
            expect(Array.from(fromCache.lods[i].data.raw)).toEqual(Array.from(parsed.lods[i].data.raw));
            expect(Array.from(fromCache.lods[i].vertexMaterial)).toEqual(Array.from(parsed.lods[i].vertexMaterial));
            expect(fromCache.lods[i].materials[0]).toBe(fromCache.materials[0]);
        }

        expect(Mesh.fromFile(objPath, {lod: false}).lods.length).toBe(1);
    });
});
