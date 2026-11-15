import type {Mesh} from "../../engine/rendering/3d/mesh";
import {FaceCulling} from "../../engine/rendering/3d/faceCulling";
import {CHANNEL_MASK, CHANNEL_MAX, GREEN_SHIFT, RED_SHIFT} from "../../engine/rendering/packedRgb";
import {MAT4_FLOATS} from "../../engine/math/mat4Layout";

export const INSTANCE_MATRIX_OFFSET = 0;
export const INSTANCE_TINT_OFFSET = INSTANCE_MATRIX_OFFSET + MAT4_FLOATS;
export const INSTANCE_FLOATS = INSTANCE_TINT_OFFSET + 4;
const INITIAL_INSTANCE_CAPACITY = 64;
const GROWTH_FACTOR = 2;
const OPAQUE_TINT_ALPHA = 1;
const FACE_CULLING_MODES = 3;

export interface GpuInstanceBatch {
    readonly mesh: Mesh;
    readonly culling: FaceCulling;
    readonly instanceCount: number;
    readonly firstInstance: number;
}

class Batch implements GpuInstanceBatch {
    public instanceCount = 0;
    public firstInstance = 0;
    public filled = 0;

    public constructor(public readonly mesh: Mesh, public readonly culling: FaceCulling) {
    }
}

export class GpuInstanceBatcher {
    private readonly batchesByMesh = new Map<Mesh, (Batch | undefined)[]>();
    private readonly _batches: Batch[] = [];
    private _data = new Float32Array(INITIAL_INSTANCE_CAPACITY * INSTANCE_FLOATS);
    private _instanceCount = 0;
    private lastMesh: Mesh | undefined;
    private lastCulling: FaceCulling = FaceCulling.BackFaces;
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
        this.forgetLastBatch();
    }

    public count(mesh: Mesh, culling: FaceCulling, instances: number = 1): void {
        let batch = this.batchFor(mesh, culling);
        if (batch === undefined) {
            batch = new Batch(mesh, culling);
            this.batchesByMesh.get(mesh)![culling] = batch;
            this._batches.push(batch);
            this.rememberLastBatch(batch);
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
        this.forgetLastBatch();
        if (firstInstance <= this.capacity) return;
        let capacity = this.capacity;
        while (capacity < firstInstance) capacity *= GROWTH_FACTOR;
        this._data = new Float32Array(capacity * INSTANCE_FLOATS);
    }

    public add(mesh: Mesh, culling: FaceCulling, matrices: Float32Array, row: number, color: number): void {
        this.addRows(mesh, culling, matrices, row, row + 1, color);
    }

    public addRows(mesh: Mesh, culling: FaceCulling, matrices: Float32Array, startRow: number, endRow: number, color: number): void {
        const batch = this.batchFor(mesh, culling);
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
        }
        batch.filled += rows;
    }

    private batchFor(mesh: Mesh, culling: FaceCulling): Batch | undefined {
        if (mesh === this.lastMesh && culling === this.lastCulling) return this.lastBatch;
        let byCulling = this.batchesByMesh.get(mesh);
        if (byCulling === undefined) {
            byCulling = new Array<Batch | undefined>(FACE_CULLING_MODES);
            this.batchesByMesh.set(mesh, byCulling);
        }
        const batch = byCulling[culling];
        if (batch !== undefined) this.rememberLastBatch(batch);
        return batch;
    }

    private rememberLastBatch(batch: Batch): void {
        this.lastMesh = batch.mesh;
        this.lastCulling = batch.culling;
        this.lastBatch = batch;
    }

    private forgetLastBatch(): void {
        this.lastMesh = undefined;
        this.lastBatch = undefined;
    }
}
