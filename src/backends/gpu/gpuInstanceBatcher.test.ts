import {describe, expect, test} from "../../engine/testing/harness";
import {Mesh, MeshBuilder} from "../../engine/rendering/3d/mesh";
import {FaceCulling} from "../../engine/rendering/3d/faceCulling";
import {MAT4_FLOATS} from "../../engine/math/mat4Layout";
import {GpuInstanceBatcher, INSTANCE_FLOATS, INSTANCE_MATRIX_OFFSET, INSTANCE_PARAMS_OFFSET, INSTANCE_TINT_OFFSET} from "./gpuInstanceBatcher";
import {LIT_SURFACE_SHADER, SURFACE_SHADER_PARAMS} from "./gpuSurfaceShader";

const WHITE = 0xFFFFFF;
const ORANGE = 0xFF8000;
const ORANGE_GREEN = 0x80;
const CHANNEL_MAX = 0xFF;
const GROWN_CAPACITY = 512;
const ROWS = 5;
const MANY_INSTANCES = 300;
const SMALL_CAPACITY_GROWS_PAST = 64;
const TINT_FLOATS = 4;
const LIT = LIT_SURFACE_SHADER;
const TOON = "toon";
const TOON_PARAMS = [3, 0.5, 0.25, 1, 0, 0, 0, 2];
const OTHER_TOON_PARAMS = [4, 0.5, 0.25, 1, 0, 0, 0, 2];
const NO_PARAMS = new Array(SURFACE_SHADER_PARAMS).fill(0);

function matrixColumn(rows: number): Float32Array {
    const column = new Float32Array(rows * MAT4_FLOATS);
    for (let i = 0; i < column.length; i++) column[i] = i;
    return column;
}

function matrixAt(batcher: GpuInstanceBatcher, instance: number): number[] {
    const start = instance * INSTANCE_FLOATS + INSTANCE_MATRIX_OFFSET;
    return Array.from(batcher.instanceData.subarray(start, start + MAT4_FLOATS));
}

function tintAt(batcher: GpuInstanceBatcher, instance: number): number[] {
    const start = instance * INSTANCE_FLOATS + INSTANCE_TINT_OFFSET;
    return Array.from(batcher.instanceData.subarray(start, start + TINT_FLOATS));
}

function paramsAt(batcher: GpuInstanceBatcher, instance: number): number[] {
    const start = instance * INSTANCE_FLOATS + INSTANCE_PARAMS_OFFSET;
    return Array.from(batcher.instanceData.subarray(start, start + SURFACE_SHADER_PARAMS));
}

function rowOf(column: Float32Array, row: number): number[] {
    return Array.from(column.subarray(row * MAT4_FLOATS, (row + 1) * MAT4_FLOATS));
}

describe("GpuInstanceBatcher", () => {
    test("an instance is its matrix, its tint, then the surface shader params", () => {
        expect([INSTANCE_MATRIX_OFFSET, INSTANCE_TINT_OFFSET, INSTANCE_PARAMS_OFFSET, INSTANCE_FLOATS])
            .toEqual([0, MAT4_FLOATS, MAT4_FLOATS + TINT_FLOATS, MAT4_FLOATS + TINT_FLOATS + SURFACE_SHADER_PARAMS]);
    });

    test("groups instances by mesh and face culling into contiguous runs, in first-seen order", () => {
        const cube = new Mesh(new MeshBuilder()), cat = new Mesh(new MeshBuilder());
        const column = matrixColumn(ROWS);
        const batcher = new GpuInstanceBatcher();
        const rows: [Mesh, FaceCulling][] = [[cube, FaceCulling.BackFaces], [cat, FaceCulling.BackFaces], [cube, FaceCulling.BackFaces], [cube, FaceCulling.None], [cat, FaceCulling.BackFaces]];
        batcher.begin();
        for (const [mesh, culling] of rows) batcher.count(mesh, culling, LIT);
        batcher.layout();
        rows.forEach(([mesh, culling], row) => batcher.add(mesh, culling, LIT, column, row, WHITE));

        expect(batcher.batches.map(batch => [batch.mesh === cube ? "cube" : "cat", batch.culling, batch.firstInstance, batch.instanceCount])).toEqual([
            ["cube", FaceCulling.BackFaces, 0, 2],
            ["cat", FaceCulling.BackFaces, 2, 2],
            ["cube", FaceCulling.None, 4, 1],
        ]);
        expect(batcher.instanceCount).toBe(ROWS);
        expect([matrixAt(batcher, 0), matrixAt(batcher, 1), matrixAt(batcher, 2), matrixAt(batcher, 3), matrixAt(batcher, 4)])
            .toEqual([rowOf(column, 0), rowOf(column, 2), rowOf(column, 1), rowOf(column, 4), rowOf(column, 3)]);
    });

    test("groups by surface shader too, and packs each row's params after its tint, zeros without params", () => {
        const mesh = new Mesh(new MeshBuilder());
        const column = matrixColumn(ROWS);
        const batcher = new GpuInstanceBatcher();
        const rows: [string, number[] | undefined][] = [[LIT, undefined], [TOON, TOON_PARAMS], [LIT, undefined], [TOON, OTHER_TOON_PARAMS], ["unregistered", undefined]];
        batcher.begin();
        for (const [shader] of rows) batcher.count(mesh, FaceCulling.BackFaces, shader);
        batcher.layout();
        rows.forEach(([shader, params], row) => batcher.add(mesh, FaceCulling.BackFaces, shader, column, row, ORANGE, params));

        expect(batcher.batches.map(batch => [batch.surfaceShader, batch.firstInstance, batch.instanceCount])).toEqual([[LIT, 0, 2], [TOON, 2, 2], ["unregistered", 4, 1]]);
        expect([paramsAt(batcher, 0), paramsAt(batcher, 1), paramsAt(batcher, 2), paramsAt(batcher, 3), paramsAt(batcher, 4)])
            .toEqual([NO_PARAMS, NO_PARAMS, TOON_PARAMS, OTHER_TOON_PARAMS, NO_PARAMS]);
        expect([matrixAt(batcher, 2), tintAt(batcher, 2)]).toEqual([rowOf(column, 1), Array.from(new Float32Array([1, ORANGE_GREEN / CHANNEL_MAX, 0, 1]))]);
    });

    test("a run of rows copies the matrices straight from the SoA column with one tint and one set of params, the same as row by row", () => {
        const mesh = new Mesh(new MeshBuilder());
        const column = matrixColumn(ROWS);
        const rowByRow = new GpuInstanceBatcher(), wholeSpan = new GpuInstanceBatcher();
        for (const batcher of [rowByRow, wholeSpan]) {
            batcher.begin();
            batcher.count(mesh, FaceCulling.BackFaces, TOON, ROWS);
            batcher.layout();
        }
        for (let row = 0; row < ROWS; row++) rowByRow.add(mesh, FaceCulling.BackFaces, TOON, column, row, ORANGE, TOON_PARAMS);
        wholeSpan.addRows(mesh, FaceCulling.BackFaces, TOON, column, 0, ROWS, ORANGE, TOON_PARAMS);
        expect(Array.from(wholeSpan.instanceData.subarray(0, ROWS * INSTANCE_FLOATS))).toEqual(Array.from(rowByRow.instanceData.subarray(0, ROWS * INSTANCE_FLOATS)));
        expect(tintAt(wholeSpan, ROWS - 1)).toEqual(Array.from(new Float32Array([1, ORANGE_GREEN / CHANNEL_MAX, 0, 1])));
        expect(paramsAt(wholeSpan, ROWS - 1)).toEqual(TOON_PARAMS);
        expect(matrixAt(wholeSpan, ROWS - 1)).toEqual(rowOf(column, ROWS - 1));
    });

    test("rows that were not counted are dropped instead of spilling into the next batch", () => {
        const counted = new Mesh(new MeshBuilder()), uncounted = new Mesh(new MeshBuilder());
        const column = matrixColumn(ROWS);
        const batcher = new GpuInstanceBatcher();
        batcher.begin();
        batcher.count(counted, FaceCulling.BackFaces, LIT, 1);
        batcher.layout();
        batcher.addRows(counted, FaceCulling.BackFaces, LIT, column, 0, ROWS, WHITE);
        batcher.add(uncounted, FaceCulling.BackFaces, LIT, column, 1, WHITE);
        batcher.add(counted, FaceCulling.BackFaces, TOON, column, 1, WHITE);
        expect(batcher.instanceCount).toBe(1);
        expect(matrixAt(batcher, 0)).toEqual(rowOf(column, 0));
        expect(matrixAt(batcher, 1)).toEqual(new Array(MAT4_FLOATS).fill(0));
    });

    test("grows to a power of two that fits every instance and starts over each frame", () => {
        const mesh = new Mesh(new MeshBuilder());
        const column = matrixColumn(MANY_INSTANCES);
        const batcher = new GpuInstanceBatcher();
        expect(batcher.capacity).toBe(SMALL_CAPACITY_GROWS_PAST);
        batcher.begin();
        batcher.count(mesh, FaceCulling.BackFaces, LIT, MANY_INSTANCES);
        batcher.layout();
        batcher.addRows(mesh, FaceCulling.BackFaces, LIT, column, 0, MANY_INSTANCES, WHITE);
        expect(batcher.capacity).toBe(GROWN_CAPACITY);
        expect(matrixAt(batcher, MANY_INSTANCES - 1)).toEqual(rowOf(column, MANY_INSTANCES - 1));

        batcher.begin();
        batcher.layout();
        expect([batcher.batches.length, batcher.instanceCount]).toEqual([0, 0]);
    });
});
