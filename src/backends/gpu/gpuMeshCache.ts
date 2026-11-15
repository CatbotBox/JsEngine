import type {Mesh} from "../../engine/rendering/3d/mesh";
import {asGpuBufferSource, GPU_BUFFER_USAGE} from "./gpuTypes";
import type {GpuBufferDevice} from "./gpuTypes";
import {packMeshForGpu} from "./gpuMeshPacking";
import type {GpuMaterialRange} from "./gpuMeshPacking";

const MIN_BUFFER_BYTES = 4;

export interface GpuMesh {
    readonly vertexBuffer: GPUBuffer;
    readonly indexBuffer: GPUBuffer;
    readonly ranges: readonly GpuMaterialRange[];
    lastUsedFrame: number;
}

function uploaded(device: GpuBufferDevice, label: string, data: Float32Array | Uint32Array, usage: number): GPUBuffer {
    const buffer = device.createBuffer({label, size: Math.max(MIN_BUFFER_BYTES, data.byteLength), usage: usage | GPU_BUFFER_USAGE.COPY_DST});
    if (data.length > 0) device.queue.writeBuffer(buffer, 0, asGpuBufferSource(data));
    return buffer;
}

export class GpuMeshCache {
    private readonly meshes = new Map<Mesh, GpuMesh>();

    public constructor(private readonly device: GpuBufferDevice) {
    }

    public get size(): number {
        return this.meshes.size;
    }

    public ensure(mesh: Mesh, frame: number): GpuMesh {
        let entry = this.meshes.get(mesh);
        if (entry === undefined) {
            const packed = packMeshForGpu(mesh);
            const label = mesh.sourcePath ?? "mesh";
            entry = {
                vertexBuffer: uploaded(this.device, `${label} vertices`, packed.vertices, GPU_BUFFER_USAGE.VERTEX),
                indexBuffer: uploaded(this.device, `${label} indices`, packed.indices, GPU_BUFFER_USAGE.INDEX),
                ranges: packed.ranges,
                lastUsedFrame: frame,
            };
            this.meshes.set(mesh, entry);
        }
        entry.lastUsedFrame = frame;
        return entry;
    }

    public evictUnused(frame: number, maxUnusedFrames: number): void {
        for (const [mesh, entry] of this.meshes) {
            if (frame - entry.lastUsedFrame <= maxUnusedFrames) continue;
            destroy(entry);
            this.meshes.delete(mesh);
        }
    }

    public dispose(): void {
        for (const entry of this.meshes.values()) destroy(entry);
        this.meshes.clear();
    }
}

function destroy(entry: GpuMesh): void {
    entry.vertexBuffer.destroy();
    entry.indexBuffer.destroy();
}
