import type {ColumnSpan} from "../../engine/core";
import type {RenderMesh} from "../../engine/rendering/3d/renderMesh";
import type {Mesh} from "../../engine/rendering/3d/mesh";
import type {FaceCulling} from "../../engine/rendering/3d/faceCulling";
import {LIT_SURFACE_SHADER, NO_SURFACE_SHADER_PARAMS, sameSurfaceShader} from "./gpuSurfaceShader";
import type {GpuSurfaceShader} from "./gpuSurfaceShader";

export const BASE_LOD_LEVEL = 0;
export const CULLED = -1;
export const NO_ROW_LEVEL_OFFSET = 0;
const INITIAL_ROW_LEVEL_CAPACITY = 64;
const ROW_LEVEL_GROWTH_FACTOR = 2;

export type MeshSpan = ColumnSpan<"renderMesh" | "localToWorld" | "surfaceShader">;
export type BoundedMeshSpan = ColumnSpan<"renderMesh" | "localToWorld" | "bounds" | "surfaceShader">;

export interface MeshSpanSource<S> {
    consumeSpans(visit: (span: S) => unknown): void;
}

export type MeshRunVisitor = (
    mesh: Mesh, level: number, culling: FaceCulling, color: number, surfaceShader: string, params: ArrayLike<number>,
    matrices: Float32Array, startRow: number, endRow: number,
) => void;

export class GpuRowLevels {
    private _levels = new Int32Array(INITIAL_ROW_LEVEL_CAPACITY);
    private _cursor = 0;

    public get levels(): Int32Array {
        return this._levels;
    }

    public rewind(): void {
        this._cursor = 0;
    }

    public claim({start, end}: BoundedMeshSpan): number {
        const firstLevel = this._cursor;
        this._cursor = firstLevel + end - start;
        if (this._cursor > this._levels.length) {
            let capacity = this._levels.length;
            while (capacity < this._cursor) capacity *= ROW_LEVEL_GROWTH_FACTOR;
            const grown = new Int32Array(capacity);
            grown.set(this._levels);
            this._levels = grown;
        }
        return firstLevel;
    }
}

export function visitMeshRuns({start, end, stores, cols}: MeshSpan, levels: Int32Array | undefined, firstLevel: number, visit: MeshRunVisitor): void {
    const renderMeshes = stores.renderMesh!;
    const surfaceShaders = stores.surfaceShader;
    const matrices = cols.localToWorld!;
    const levelOffset = firstLevel - start;
    let row = start;
    while (row < end) {
        const level = levels === undefined ? BASE_LOD_LEVEL : levels[levelOffset + row];
        const first = renderMeshes.get(row) as RenderMesh;
        const mesh = first.mesh, culling = first.faceCulling, color = first.color;
        const surface = surfaceShaders?.get(row) as GpuSurfaceShader | undefined;
        let runEnd = row + 1;
        while (runEnd < end) {
            const next = renderMeshes.get(runEnd) as RenderMesh;
            if (next.mesh !== mesh || next.faceCulling !== culling || next.color !== color) break;
            if (levels !== undefined && levels[levelOffset + runEnd] !== level) break;
            if (surface !== undefined && !sameSurfaceShader(surface, surfaceShaders!.get(runEnd) as GpuSurfaceShader)) break;
            runEnd++;
        }
        if (mesh !== undefined && level !== CULLED) {
            const surfaceShader = surface === undefined ? LIT_SURFACE_SHADER : surface.name;
            const params = surface === undefined ? NO_SURFACE_SHADER_PARAMS : surface.params;
            visit(mesh.lods[level], level, culling, color, surfaceShader, params, matrices, row, runEnd);
        }
        row = runEnd;
    }
}
