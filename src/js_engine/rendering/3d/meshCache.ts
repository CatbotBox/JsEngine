import type {Mesh} from "./mesh";
import type {FileSource} from "../../platform";
import {nodePlatform} from "../../platform";

// increment whenever a change is made to this file
export const MESH_CACHE_FORMAT_VERSION = 3;
export const MESH_CACHE_EXTENSION = ".meshcache";

const MAGIC = "JSENGINE_MESHCACHE";
const HEADER_LENGTH_OFFSET = MAGIC.length;
const HEADER_OFFSET = HEADER_LENGTH_OFFSET + 4;
const BYTES_PER_FLOAT = 4;
const BYTES_PER_MATERIAL_INDEX = 2;

/** Geometry of one mesh or detail level: `data` in the Mesh layout, then one material index per vertex. */
export interface CachedGeometry {
    readonly data: Float32Array;
    readonly vertCount: number;
    readonly triangleCount: number;
    readonly vertexMaterial: Uint16Array;
}

export interface CachedMesh extends CachedGeometry {
    readonly materialNames: readonly string[];
    readonly materialLibraryNames: readonly string[];
    /** Coarser detail levels, finest first, sharing the mesh's materials. */
    readonly lods: readonly CachedGeometry[];
}

interface GeometryHeader {
    vertCount: number;
    triangleCount: number;
}

interface CacheHeader extends GeometryHeader {
    formatVersion: number;
    objByteLength: number;
    objMtimeMs: number;
    materialNames: string[];
    materialLibraryNames: string[];
    lods: GeometryHeader[];
}

export function meshCachePathFor(objPath: string): string {
    return objPath + MESH_CACHE_EXTENSION;
}

/** Undefined when there is no valid cache, or `files` cannot `stat` the obj to validate one. */
export function readMeshCache(objPath: string, files: FileSource = nodePlatform().files): CachedMesh | undefined {
    if (files.stat === undefined) return undefined;
    const cachePath = meshCachePathFor(objPath);
    if (!files.exists(cachePath)) return undefined;
    try {
        const objStat = files.stat(objPath);
        return decodeCache(files.readBytes(cachePath), objStat.size, objStat.mtimeMs);
    } catch {
        return undefined;
    }
}

/** Does nothing unless `files` can both `write` the cache and `stat` the obj it is keyed on. */
export function writeMeshCache(objPath: string, mesh: Mesh, materialLibraryNames: readonly string[], files: FileSource = nodePlatform().files): void {
    if (files.write === undefined || files.stat === undefined) return;
    const cachePath = meshCachePathFor(objPath);
    try {
        const objStat = files.stat(objPath);
        files.write(cachePath, encodeCache(mesh, materialLibraryNames, objStat.size, objStat.mtimeMs));
    } catch (error) {
        console.warn(`Could not write mesh cache ${cachePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function encodeCache(mesh: Mesh, materialLibraryNames: readonly string[], objByteLength: number, objMtimeMs: number): Uint8Array {
    const levels = mesh.lods.slice(1);
    const header: CacheHeader = {
        formatVersion: MESH_CACHE_FORMAT_VERSION,
        objByteLength,
        objMtimeMs,
        vertCount: mesh.vertCount,
        triangleCount: mesh.triangleCount,
        materialNames: mesh.materials.map(material => material.name),
        materialLibraryNames: [...materialLibraryNames],
        lods: levels.map(level => ({vertCount: level.vertCount, triangleCount: level.triangleCount})),
    };
    const headerBytes = new TextEncoder().encode(JSON.stringify(header));
    const geometries = [mesh, ...levels];
    let totalLength = HEADER_OFFSET + headerBytes.length;
    for (const geometry of geometries) totalLength = geometryEnd(alignToFloat(totalLength), geometry);

    const out = new Uint8Array(totalLength);
    const view = new DataView(out.buffer);
    for (let i = 0; i < MAGIC.length; i++) out[i] = MAGIC.charCodeAt(i);
    view.setUint32(HEADER_LENGTH_OFFSET, headerBytes.length, true);
    out.set(headerBytes, HEADER_OFFSET);
    let offset = HEADER_OFFSET + headerBytes.length;
    for (const geometry of geometries) {
        offset = alignToFloat(offset);
        const data = geometry.data.raw;
        const vertexMaterial = geometry.vertexMaterial;
        out.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), offset);
        out.set(new Uint8Array(vertexMaterial.buffer, vertexMaterial.byteOffset, vertexMaterial.byteLength), offset + data.byteLength);
        offset = geometryEnd(offset, geometry);
    }
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

    let offset = HEADER_OFFSET + headerLength;
    const geometries: CachedGeometry[] = [];
    for (const geometryHeader of [header as GeometryHeader, ...(header.lods ?? [])]) {
        offset = alignToFloat(offset);
        if (bytes.length < geometryEnd(offset, geometryHeader)) return undefined;
        geometries.push(geometryAt(bytes, offset, geometryHeader));
        offset = geometryEnd(offset, geometryHeader);
    }
    if (bytes.length !== offset) return undefined;

    return {
        ...geometries[0],
        materialNames: header.materialNames,
        materialLibraryNames: header.materialLibraryNames,
        lods: geometries.slice(1),
    };
}

function floatCountOf(geometry: GeometryHeader): number {
    return (geometry.vertCount * 3 + geometry.triangleCount) * 3;
}

function geometryEnd(offset: number, geometry: GeometryHeader): number {
    return offset + floatCountOf(geometry) * BYTES_PER_FLOAT + geometry.vertCount * BYTES_PER_MATERIAL_INDEX;
}

function geometryAt(bytes: Uint8Array, offset: number, geometry: GeometryHeader): CachedGeometry {
    const floatCount = floatCountOf(geometry);
    return {
        data: floatsAt(bytes, offset, floatCount),
        vertCount: geometry.vertCount,
        triangleCount: geometry.triangleCount,
        vertexMaterial: materialIndicesAt(bytes, offset + floatCount * BYTES_PER_FLOAT, geometry.vertCount),
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
