import type {Mesh} from "../../engine/rendering/3d/mesh";
import type {DeepReadonly} from "../../engine/util/tokenUtils";

export const MESH_POSITION_OFFSET = 0;
export const MESH_NORMAL_OFFSET = 3;
export const MESH_UV_OFFSET = 6;
export const MESH_VERTEX_FLOATS = 8;
const SOURCE_VEC_FLOATS = 3;
const TRIANGLE_CORNERS = 3;
const FIRST_MATERIAL = 0;

export interface GpuMaterialRange {
    readonly material: number;
    readonly firstIndex: number;
    readonly indexCount: number;
}

export interface PackedGpuMesh {
    readonly vertices: Float32Array;
    readonly indices: Uint32Array;
    readonly ranges: readonly GpuMaterialRange[];
}

export function packMeshForGpu(mesh: DeepReadonly<Mesh>): PackedGpuMesh {
    const vertCount = mesh.vertCount;
    const positions = mesh.vertices.raw, normals = mesh.normals.raw, uvs = mesh.uvs.raw;
    const vertices = new Float32Array(vertCount * MESH_VERTEX_FLOATS);
    for (let v = 0, s = 0, o = 0; v < vertCount; v++, s += SOURCE_VEC_FLOATS, o += MESH_VERTEX_FLOATS) {
        vertices[o + MESH_POSITION_OFFSET] = positions[s];
        vertices[o + MESH_POSITION_OFFSET + 1] = positions[s + 1];
        vertices[o + MESH_POSITION_OFFSET + 2] = positions[s + 2];
        vertices[o + MESH_NORMAL_OFFSET] = normals[s];
        vertices[o + MESH_NORMAL_OFFSET + 1] = normals[s + 1];
        vertices[o + MESH_NORMAL_OFFSET + 2] = normals[s + 2];
        vertices[o + MESH_UV_OFFSET] = uvs[s];
        vertices[o + MESH_UV_OFFSET + 1] = 1 - uvs[s + 1];
    }

    const triangleCount = mesh.triangleCount;
    const corners = mesh.triangles.raw;
    const materialCount = mesh.materials.length;
    const vertexMaterial = mesh.vertexMaterial;
    const materialOf = (triangle: number): number => {
        const material = vertexMaterial[corners[triangle * TRIANGLE_CORNERS] | 0];
        return material < materialCount ? material : FIRST_MATERIAL;
    };

    const trianglesPerMaterial = new Uint32Array(materialCount);
    for (let t = 0; t < triangleCount; t++) trianglesPerMaterial[materialOf(t)]++;

    const ranges: GpuMaterialRange[] = [];
    const nextIndex = new Uint32Array(materialCount);
    let firstIndex = 0;
    for (let material = 0; material < materialCount; material++) {
        const indexCount = trianglesPerMaterial[material] * TRIANGLE_CORNERS;
        nextIndex[material] = firstIndex;
        if (indexCount > 0) ranges.push({material, firstIndex, indexCount});
        firstIndex += indexCount;
    }

    const indices = new Uint32Array(triangleCount * TRIANGLE_CORNERS);
    for (let t = 0, k = 0; t < triangleCount; t++, k += TRIANGLE_CORNERS) {
        const material = materialOf(t);
        const o = nextIndex[material];
        indices[o] = corners[k];
        indices[o + 1] = corners[k + 1];
        indices[o + 2] = corners[k + 2];
        nextIndex[material] = o + TRIANGLE_CORNERS;
    }
    return {vertices, indices, ranges};
}
