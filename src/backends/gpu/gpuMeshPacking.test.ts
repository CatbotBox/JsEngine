import {describe, expect, test} from "../../engine/testing/harness";
import {Vec} from "../../engine/math/types/vec";
import {Mesh, MeshBuilder} from "../../engine/rendering/3d/mesh";
import {Material} from "../../engine/rendering/3d/material";
import {MESH_NORMAL_OFFSET, MESH_POSITION_OFFSET, MESH_UV_OFFSET, MESH_VERTEX_FLOATS, packMeshForGpu} from "./gpuMeshPacking";

const RED_MATERIAL = 0, BLUE_MATERIAL = 1;
const TRIANGLE_CORNERS = 3;
const STRIP_VERTICES = 6;
const U_PER_VERTEX = 1 / 8;
const STRIP_V = 0.25;
const FIFTH_VERTEX = 4;

function twoMaterialStrip(): Mesh {
    const builder = new MeshBuilder();
    for (let i = 0; i < STRIP_VERTICES; i++) {
        builder.vertices.push(Vec.alloc3(i, i * 2, i * 3));
        builder.normals.push(Vec.alloc3(0, 0, 1));
        builder.uvs.push(Vec.alloc2(i * U_PER_VERTEX, STRIP_V));
    }
    builder.triangles.push(Vec.alloc3(0, 1, 2), Vec.alloc3(3, 4, 5), Vec.alloc3(2, 1, 0), Vec.alloc3(5, 4, 3));
    builder.materials.push(new Material("red", 0xFF0000), new Material("blue", 0x0000FF));
    builder.vertexMaterial.push(RED_MATERIAL, RED_MATERIAL, RED_MATERIAL, BLUE_MATERIAL, BLUE_MATERIAL, BLUE_MATERIAL);
    return new Mesh(builder);
}

describe("packMeshForGpu", () => {
    test("interleaves position, normal and uv per vertex, flipping v so row 0 of a texture is its top", () => {
        const mesh = twoMaterialStrip();
        const {vertices} = packMeshForGpu(mesh);
        expect(vertices.length).toBe(mesh.vertCount * MESH_VERTEX_FLOATS);
        const fifth = FIFTH_VERTEX * MESH_VERTEX_FLOATS;
        expect(Array.from(vertices.subarray(fifth + MESH_POSITION_OFFSET, fifth + MESH_POSITION_OFFSET + 3))).toEqual([4, 8, 12]);
        expect(Array.from(vertices.subarray(fifth + MESH_NORMAL_OFFSET, fifth + MESH_NORMAL_OFFSET + 3))).toEqual([0, 0, 1]);
        expect(vertices[fifth + MESH_UV_OFFSET]).toBeCloseTo(FIFTH_VERTEX * U_PER_VERTEX);
        expect(vertices[fifth + MESH_UV_OFFSET + 1]).toBeCloseTo(1 - STRIP_V);
    });

    test("groups triangles by the material of their first corner into contiguous ranges, keeping every index once", () => {
        const mesh = twoMaterialStrip();
        const {indices, ranges} = packMeshForGpu(mesh);
        expect(indices.length).toBe(mesh.triangleCount * TRIANGLE_CORNERS);
        expect(ranges).toEqual([
            {material: RED_MATERIAL, firstIndex: 0, indexCount: 6},
            {material: BLUE_MATERIAL, firstIndex: 6, indexCount: 6},
        ]);
        expect(Array.from(indices)).toEqual([0, 1, 2, 2, 1, 0, 3, 4, 5, 5, 4, 3]);
    });

    test("a material without triangles gets no range; an empty mesh packs to nothing", () => {
        const builder = new MeshBuilder();
        builder.vertices.push(Vec.alloc3(0, 0, 0), Vec.alloc3(1, 0, 0), Vec.alloc3(0, 1, 0));
        builder.normals.push(Vec.alloc3(0, 0, 1), Vec.alloc3(0, 0, 1), Vec.alloc3(0, 0, 1));
        builder.uvs.push(Vec.alloc2(), Vec.alloc2(), Vec.alloc2());
        builder.triangles.push(Vec.alloc3(0, 1, 2));
        builder.materials.push(new Material("unused"), new Material("used"));
        builder.vertexMaterial.push(BLUE_MATERIAL, BLUE_MATERIAL, BLUE_MATERIAL);
        expect(packMeshForGpu(new Mesh(builder)).ranges).toEqual([{material: BLUE_MATERIAL, firstIndex: 0, indexCount: TRIANGLE_CORNERS}]);

        const empty = packMeshForGpu(new Mesh(new MeshBuilder()));
        expect([empty.vertices.length, empty.indices.length, empty.ranges.length]).toEqual([0, 0, 0]);
    });
});
