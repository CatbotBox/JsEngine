import type {Mesh} from "./mesh";

// increment whenever a change is made to this file
export const MESH_CACHE_FORMAT_VERSION = 1;
export const MESH_CACHE_EXTENSION = ".meshcache";

const MAGIC = "JSENGINE_MESHCACHE";
const HEADER_LENGTH_OFFSET = MAGIC.length;
const HEADER_OFFSET = HEADER_LENGTH_OFFSET + 4;
const BYTES_PER_FLOAT = 4;
const BYTES_PER_MATERIAL_INDEX = 2;

export interface CachedMesh {
    readonly data: Float32Array;
    readonly vertCount: number;
    readonly triangleCount: number;
    readonly materialNames: readonly string[];
    readonly materialLibraryNames: readonly string[];
    readonly vertexMaterial: Uint16Array;
}

interface CacheHeader {
    formatVersion: number;
    objByteLength: number;
    objMtimeMs: number;
    vertCount: number;
    triangleCount: number;
    materialNames: string[];
    materialLibraryNames: string[];
}

export function meshCachePathFor(objPath: string): string {
    return objPath + MESH_CACHE_EXTENSION;
}

export function readMeshCache(objPath: string): CachedMesh | undefined {
    const fs = require("fs") as typeof import("fs");
    const cachePath = meshCachePathFor(objPath);
    if (!fs.existsSync(cachePath)) return undefined;
    try {
        const objStat = fs.statSync(objPath);
        const bytes = fs.readFileSync(cachePath);
        return decodeCache(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), objStat.size, objStat.mtimeMs);
    } catch {
        return undefined;
    }
}

export function writeMeshCache(objPath: string, mesh: Mesh, materialLibraryNames: readonly string[]): void {
    const fs = require("fs") as typeof import("fs");
    const cachePath = meshCachePathFor(objPath);
    try {
        const objStat = fs.statSync(objPath);
        fs.writeFileSync(cachePath, encodeCache(mesh, materialLibraryNames, objStat.size, objStat.mtimeMs));
    } catch (error) {
        console.warn(`Could not write mesh cache ${cachePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function encodeCache(mesh: Mesh, materialLibraryNames: readonly string[], objByteLength: number, objMtimeMs: number): Uint8Array {
    const header: CacheHeader = {
        formatVersion: MESH_CACHE_FORMAT_VERSION,
        objByteLength,
        objMtimeMs,
        vertCount: mesh.vertCount,
        triangleCount: mesh.triangleCount,
        materialNames: mesh.materials.map(material => material.name),
        materialLibraryNames: [...materialLibraryNames],
    };
    const headerBytes = new TextEncoder().encode(JSON.stringify(header));
    const dataOffset = alignToFloat(HEADER_OFFSET + headerBytes.length);
    const data = mesh.data.raw;
    const vertexMaterial = mesh.vertexMaterial;
    const out = new Uint8Array(dataOffset + data.byteLength + vertexMaterial.byteLength);
    const view = new DataView(out.buffer);
    for (let i = 0; i < MAGIC.length; i++) out[i] = MAGIC.charCodeAt(i);
    view.setUint32(HEADER_LENGTH_OFFSET, headerBytes.length, true);
    out.set(headerBytes, HEADER_OFFSET);
    out.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), dataOffset);
    out.set(new Uint8Array(vertexMaterial.buffer, vertexMaterial.byteOffset, vertexMaterial.byteLength), dataOffset + data.byteLength);
    return out;
}

function decodeCache(bytes: Uint8Array, objByteLength: number, objMtimeMs: number): CachedMesh | undefined {
    if (bytes.length < HEADER_OFFSET) return undefined;
    for (let i = 0; i < MAGIC.length; i++) {
        if (bytes[i] !== MAGIC.charCodeAt(i)) return undefined;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const headerLength = view.getUint32(HEADER_LENGTH_OFFSET, true);
    if (bytes.length < HEADER_OFFSET + headerLength) return undefined;
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(HEADER_OFFSET, HEADER_OFFSET + headerLength))) as CacheHeader;
    if (header.formatVersion !== MESH_CACHE_FORMAT_VERSION) return undefined;
    if (header.objByteLength !== objByteLength || header.objMtimeMs !== objMtimeMs) return undefined;

    const dataOffset = alignToFloat(HEADER_OFFSET + headerLength);
    const floatCount = (header.vertCount * 3 + header.triangleCount) * 3;
    const vertexMaterialOffset = dataOffset + floatCount * BYTES_PER_FLOAT;
    if (bytes.length !== vertexMaterialOffset + header.vertCount * BYTES_PER_MATERIAL_INDEX) return undefined;

    return {
        data: floatsAt(bytes, dataOffset, floatCount),
        vertCount: header.vertCount,
        triangleCount: header.triangleCount,
        materialNames: header.materialNames,
        materialLibraryNames: header.materialLibraryNames,
        vertexMaterial: materialIndicesAt(bytes, vertexMaterialOffset, header.vertCount),
    };
}

function floatsAt(bytes: Uint8Array, offset: number, count: number): Float32Array {
    const absoluteOffset = bytes.byteOffset + offset;
    if (absoluteOffset % BYTES_PER_FLOAT === 0) return new Float32Array(bytes.buffer, absoluteOffset, count);
    return new Float32Array(bytes.slice(offset, offset + count * BYTES_PER_FLOAT).buffer);
}

function materialIndicesAt(bytes: Uint8Array, offset: number, count: number): Uint16Array {
    const absoluteOffset = bytes.byteOffset + offset;
    if (absoluteOffset % BYTES_PER_MATERIAL_INDEX === 0) return new Uint16Array(bytes.buffer, absoluteOffset, count);
    return new Uint16Array(bytes.slice(offset, offset + count * BYTES_PER_MATERIAL_INDEX).buffer);
}

function alignToFloat(offset: number): number {
    return (offset + BYTES_PER_FLOAT - 1) & ~(BYTES_PER_FLOAT - 1);
}
