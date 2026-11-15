import type {Mesh} from "../../engine/rendering/3d/mesh";
import type {FaceCulling} from "../../engine/rendering/3d/faceCulling";
import {CHANNEL_MASK, CHANNEL_MAX, GREEN_SHIFT, RED_SHIFT} from "../../engine/rendering/packedRgb";
import {MAT4_FLOATS} from "../../engine/math/mat4Layout";
import {VEC4_FLOATS} from "./gpuLightPacking";
import {NO_SURFACE_SHADER_PARAMS, SURFACE_SHADER_PARAMS} from "./gpuSurfaceShader";

export const INSTANCE_MATRIX_OFFSET = 0;
export const INSTANCE_TINT_OFFSET = INSTANCE_MATRIX_OFFSET + MAT4_FLOATS;
export const INSTANCE_PARAMS_OFFSET = INSTANCE_TINT_OFFSET + VEC4_FLOATS;
export const INSTANCE_FLOATS = INSTANCE_PARAMS_OFFSET + SURFACE_SHADER_PARAMS;
const INITIAL_INSTANCE_CAPACITY = 64;
const GROWTH_FACTOR = 2;
const OPAQUE_TINT_ALPHA = 1;

export interface GpuInstanceBatch {
    readonly mesh: Mesh;
    readonly culling: FaceCulling;
    readonly surfaceShader: string;
    readonly instanceCount: number;
    readonly firstInstance: number;
}

class Batch implements GpuInstanceBatch {
    public instanceCount = 0;
    public firstInstance = 0;
    public filled = 0;

    public constructor(public readonly mesh: Mesh, public readonly culling: FaceCulling, public readonly surfaceShader: string) {
    }
}

export class GpuInstanceBatcher {
    private readonly batchesByMesh = new Map<Mesh, Batch[]>();
    private readonly _batches: Batch[] = [];
    private _data = new Float32Array(INITIAL_INSTANCE_CAPACITY * INSTANCE_FLOATS);
    private _instanceCount = 0;
    private lastBatch: Batch | undefined;

    public get batches(): readonly GpuInstanceBatch[] {
        return this._batches;
    }

    public get instanceCount(): number {
        return this._instanceCount;
    }

    public get capacity(): number {
        return this._data.length / INSTANCE_FLOATS;
    }

    public get instanceData(): Float32Array {
        return this._data;
    }

    public begin(): void {
        this.batchesByMesh.clear();
        this._batches.length = 0;
        this._instanceCount = 0;
        this.lastBatch = undefined;
    }

    public count(mesh: Mesh, culling: FaceCulling, surfaceShader: string, instances: number = 1): void {
        let batch = this.batchFor(mesh, culling, surfaceShader);
        if (batch === undefined) {
            batch = new Batch(mesh, culling, surfaceShader);
            this.batchesByMesh.get(mesh)!.push(batch);
            this._batches.push(batch);
            this.lastBatch = batch;
        }
        batch.instanceCount += instances;
    }

    public layout(): void {
        let firstInstance = 0;
        for (const batch of this._batches) {
            batch.firstInstance = firstInstance;
            batch.filled = 0;
            firstInstance += batch.instanceCount;
        }
        this._instanceCount = firstInstance;
        this.lastBatch = undefined;
        if (firstInstance <= this.capacity) return;
        let capacity = this.capacity;
        while (capacity < firstInstance) capacity *= GROWTH_FACTOR;
        this._data = new Float32Array(capacity * INSTANCE_FLOATS);
    }

    public add(mesh: Mesh, culling: FaceCulling, surfaceShader: string, matrices: Float32Array, row: number, color: number,
        params: ArrayLike<number> = NO_SURFACE_SHADER_PARAMS): void {
        this.addRows(mesh, culling, surfaceShader, matrices, row, row + 1, color, params);
    }

    public addRows(mesh: Mesh, culling: FaceCulling, surfaceShader: string, matrices: Float32Array, startRow: number, endRow: number, color: number,
        params: ArrayLike<number> = NO_SURFACE_SHADER_PARAMS): void {
        const batch = this.batchFor(mesh, culling, surfaceShader);
        if (batch === undefined) return;
        const rows = Math.min(endRow - startRow, batch.instanceCount - batch.filled);
        const data = this._data;
        const red = ((color >> RED_SHIFT) & CHANNEL_MASK) / CHANNEL_MAX;
        const green = ((color >> GREEN_SHIFT) & CHANNEL_MASK) / CHANNEL_MAX;
        const blue = (color & CHANNEL_MASK) / CHANNEL_MAX;
        let o = (batch.firstInstance + batch.filled) * INSTANCE_FLOATS;
        for (let row = 0, m = startRow * MAT4_FLOATS; row < rows; row++, m += MAT4_FLOATS, o += INSTANCE_FLOATS) {
            for (let k = 0; k < MAT4_FLOATS; k++) data[o + INSTANCE_MATRIX_OFFSET + k] = matrices[m + k];
            data[o + INSTANCE_TINT_OFFSET] = red;
            data[o + INSTANCE_TINT_OFFSET + 1] = green;
            data[o + INSTANCE_TINT_OFFSET + 2] = blue;
            data[o + INSTANCE_TINT_OFFSET + 3] = OPAQUE_TINT_ALPHA;
            for (let k = 0; k < SURFACE_SHADER_PARAMS; k++) data[o + INSTANCE_PARAMS_OFFSET + k] = params[k];
        }
        batch.filled += rows;
    }

    private batchFor(mesh: Mesh, culling: FaceCulling, surfaceShader: string): Batch | undefined {
        const last = this.lastBatch;
        if (last !== undefined && last.mesh === mesh && last.culling === culling && last.surfaceShader === surfaceShader) return last;
        let meshBatches = this.batchesByMesh.get(mesh);
        if (meshBatches === undefined) {
            meshBatches = [];
            this.batchesByMesh.set(mesh, meshBatches);
        }
        for (const batch of meshBatches) {
            if (batch.culling === culling && batch.surfaceShader === surfaceShader) {
                this.lastBatch = batch;
                return batch;
            }
        }
        return undefined;
    }
}
