import {Vec, Vec2, Vec3} from "../../math/types/vec";
import {Vec3Array, VecArray} from "../../math/types/vecArray";
import {loadMaterialTextures, Material} from "./material";
import {MaterialLibrary, parseMtl} from "./mtlParser";
import {readMeshCache, writeMeshCache} from "./meshCache";
import {buildLodParts, LodBuildOptions} from "./meshLod";
import type {AssetLoadOptions, FileSource} from "../../platform";
import {dirname, joinPath, nodePlatform} from "../../platform";

export class Mesh {
    public readonly data: Vec3Array;
    public readonly vertCount: number;
    public readonly triangleCount: number;
    public readonly materials: readonly Material[];
    public readonly vertexMaterial: Uint16Array;

    private _bounds?: Float32Array;
    private _lods: Mesh[] = [this];

    /** Detail levels, finest first; level 0 is this mesh. A mesh without coarser levels has length 1. */
    public get lods(): readonly Mesh[] {
        return this._lods;
    }

    public attachLods(coarserLevels: readonly Mesh[]): void {
        this._lods = [this, ...coarserLevels];
    }

    /**
     * Mesh-local AABB as [xMin, yMin, zMin, xMax, yMax, zMax], computed from
     * the vertices on first access and cached (vertex data is immutable).
     */
    public get bounds(): Float32Array {
        if (this._bounds === undefined) {
            const bounds = new Float32Array(6);
            const raw = this.vertices.raw;
            const count = this.vertCount * 3;
            let xMin = Number.POSITIVE_INFINITY, yMin = Number.POSITIVE_INFINITY, zMin = Number.POSITIVE_INFINITY;
            let xMax = Number.NEGATIVE_INFINITY, yMax = Number.NEGATIVE_INFINITY, zMax = Number.NEGATIVE_INFINITY;
            for (let i = 0; i < count; i += 3) {
                const x = raw[i], y = raw[i + 1], z = raw[i + 2];
                if (x < xMin) xMin = x;
                if (x > xMax) xMax = x;
                if (y < yMin) yMin = y;
                if (y > yMax) yMax = y;
                if (z < zMin) zMin = z;
                if (z > zMax) zMax = z;
            }
            if (this.vertCount === 0) {
                bounds.fill(0);
            } else {
                bounds[0] = xMin;
                bounds[1] = yMin;
                bounds[2] = zMin;
                bounds[3] = xMax;
                bounds[4] = yMax;
                bounds[5] = zMax;
            }
            this._bounds = bounds;
        }
        return this._bounds;
    }

    private get verticesIndexStart(): number {
        return 0;
    }

    private get normalsIndexStart(): number {
        return this.verticesIndexStart + this.vertCount;
    }

    private get uvsIndexStart(): number {
        return this.normalsIndexStart + this.vertCount;
    }

    private get triangleIndexStart(): number {
        return this.uvsIndexStart + this.vertCount;
    }

    public get vertices(): Vec3Array {
        return this.data.subarray(this.verticesIndexStart, this.verticesIndexStart + this.vertCount)
    }

    public get normals(): Vec3Array {
        return this.data.subarray(this.normalsIndexStart, this.normalsIndexStart + this.vertCount)
    }

    public get uvs(): Vec3Array {
        return this.data.subarray(this.uvsIndexStart, this.uvsIndexStart + this.vertCount);
    }

    public get triangles(): Vec3Array {
        return this.data.subarray(this.triangleIndexStart, this.triangleIndexStart + this.triangleCount);
    }

    public materialOfTriangle(triangleIndex: number): Material {
        const firstCorner = this.triangles.raw[triangleIndex * 3] | 0;
        return this.materials[this.vertexMaterial[firstCorner]];
    }

    public constructor(source: MeshBuilder | MeshParts) {
        if (source instanceof MeshBuilder) {
            source.verify();
            this.triangleCount = source.triangles.length;
            this.vertCount = source.vertices.length;
            const data = [...source.vertices, ...source.normals, ...source.uvs.map(uv => Vec.alloc3(Vec.x(uv), Vec.y(uv), 0)), ...source.triangles];
            this.data = new VecArray(data, 3);
            this.materials = source.materials.length > 0 ? [...source.materials] : [Material.default()];
            this.vertexMaterial = new Uint16Array(this.vertCount);
            this.vertexMaterial.set(source.vertexMaterial.slice(0, this.vertCount));
        } else {
            this.triangleCount = source.triangleCount;
            this.vertCount = source.vertCount;
            this.data = new VecArray(this.vertCount * 3 + this.triangleCount, 3);
            this.data.raw.set(source.data);
            this.materials = source.materials.length > 0 ? [...source.materials] : [Material.default()];
            this.vertexMaterial = new Uint16Array(source.vertexMaterial);
        }
    }

    public static fromFile(filePath: string, options: MeshLoadOptions = {}): Mesh {
        const fileType = filePath.slice(filePath.lastIndexOf("."));
        if (fileType !== '.obj') {
            throw Error(`Unable to parse file: ${filePath}. Reason ${fileType} not supported`);
        }
        const files = options.files ?? nodePlatform().files;
        const directory = dirname(filePath);
        const useCache = options.cache ?? true;
        const lodOptions = options.lod === false ? undefined : options.lod === true || options.lod === undefined ? {} : options.lod;
        const cached = useCache ? readMeshCache(filePath, files) : undefined;
        let mesh: Mesh;
        if (cached !== undefined) {
            const library = loadMaterialLibraries(directory, cached.materialLibraryNames, files);
            const materials = cached.materialNames.map(name => library.get(name) ?? new Material(name));
            mesh = new Mesh({data: cached.data, vertCount: cached.vertCount, triangleCount: cached.triangleCount, materials, vertexMaterial: cached.vertexMaterial});
            if (lodOptions !== undefined) mesh.attachLods(cached.lods.map(level => new Mesh({...level, materials})));
        } else {
            const parser = new ObjParser(files.readText(filePath));
            parser.applyMaterialLibrary(loadMaterialLibraries(directory, parser.materialLibraryNames, files));
            mesh = parser.toMesh();
            if (lodOptions !== undefined) mesh.attachLods(Mesh.buildLods(mesh, lodOptions));
            if (useCache) writeMeshCache(filePath, mesh, parser.materialLibraryNames, files);
        }
        loadMaterialTextures(mesh.materials, new Map(), {files, inflate: options.inflate});
        return mesh;
    }

    /** Coarser levels of `mesh` by vertex clustering (see meshLod.ts); empty below the triangle threshold. */
    public static buildLods(mesh: Mesh, options: Partial<LodBuildOptions> = {}): Mesh[] {
        return buildLodParts(mesh, options).map(parts => new Mesh(parts));
    }

    public static parseObj(data: string, materialLibrary?: MaterialLibrary): Mesh {
        const parser = new ObjParser(data);
        if (materialLibrary !== undefined) parser.applyMaterialLibrary(materialLibrary);
        return parser.toMesh();
    }
}

export interface MeshParts {
    readonly data: Float32Array;
    readonly vertCount: number;
    readonly triangleCount: number;
    readonly materials: readonly Material[];
    readonly vertexMaterial: Uint16Array;
}

export interface MeshLoadOptions extends AssetLoadOptions {
    /** Read and write `<file>.obj.meshcache`; only possible where `files` can `stat` (and `write`, to create one). */
    cache?: boolean;
    /**
     * Build (or load from the cache) coarser detail levels; on by default with
     * DEFAULT_LOD_BUILD_OPTIONS, an object overrides them, false skips them. The
     * cache stores whatever levels the writing load built, so a file first loaded
     * with `lod: false` has none until its cache is regenerated.
     */
    lod?: boolean | Partial<LodBuildOptions>;
}

function loadMaterialLibraries(directory: string, libraryNames: readonly string[], files: FileSource): MaterialLibrary {
    const merged: MaterialLibrary = new Map();
    for (const libraryName of libraryNames) {
        const libraryPath = joinPath(directory, libraryName);
        if (!files.exists(libraryPath)) continue;
        for (const [name, material] of parseMtl(files.readText(libraryPath), directory)) merged.set(name, material);
    }
    return merged;
}

const UNASSIGNED_INDEX = -1;

class ObjParser {
    public readonly materialLibraryNames: string[] = [];

    private readonly builder = new MeshBuilder();
    private readonly filePositions: Vec3[] = [];
    private readonly fileUvs: Vec2[] = [];
    private readonly fileNormals: Vec3[] = [];
    private readonly cornerIndexByKey = new Map<string, number>();
    private readonly cornerHasFileNormal: boolean[] = [];
    private readonly materialIndexByName = new Map<string, number>();
    private currentMaterialIndex = UNASSIGNED_INDEX;

    public constructor(data: string) {
        for (const rawLine of data.split(/\r?\n/)) {
            this.parseLine(rawLine.trim());
        }
    }

    public applyMaterialLibrary(library: MaterialLibrary): void {
        const materials = this.builder.materials;
        for (let i = 0; i < materials.length; i++) {
            const resolved = library.get(materials[i].name);
            if (resolved !== undefined) materials[i] = resolved;
        }
    }

    public toMesh(): Mesh {
        const builder = this.builder;
        builder.generateNormals(this.cornerHasFileNormal);
        return new Mesh(builder);
    }

    private parseLine(line: string): void {
        if (line.length === 0 || line[0] === '#') return;
        if (line.startsWith("v ")) {
            this.parseVertex(line);
        } else if (line.startsWith("vt ")) {
            this.parseUv(line);
        } else if (line.startsWith("vn ")) {
            this.parseNormal(line);
        } else if (line.startsWith("f ")) {
            this.parseFace(line);
        } else if (line.startsWith("usemtl ")) {
            this.currentMaterialIndex = this.materialIndexFor(line.substring(7).trim());
        } else if (line.startsWith("mtllib ")) {
            this.materialLibraryNames.push(line.substring(7).trim());
        }
    }

    private parseVertex(line: string): void {
        const components = parseNumberList(line, 2);
        if (components.length >= 3) {
            this.filePositions.push(Vec.alloc3(components[0], components[1], components[2]));
        }
    }

    private parseUv(line: string): void {
        const components = parseNumberList(line, 3);
        if (components.length >= 2) {
            this.fileUvs.push(Vec.alloc2(components[0], components[1]));
        }
    }

    private parseNormal(line: string): void {
        const components = parseNumberList(line, 3);
        if (components.length >= 3) {
            this.fileNormals.push(Vec.alloc3(components[0], components[1], components[2]));
        }
    }

    private parseFace(line: string): void {
        const corners = line.substring(2).trim().split(/\s+/);
        if (corners.length < 3) return;
        if (this.currentMaterialIndex === UNASSIGNED_INDEX) {
            this.currentMaterialIndex = this.materialIndexFor(Material.DEFAULT_NAME);
        }

        const cornerIndices: number[] = new Array(corners.length);
        for (let i = 0; i < corners.length; i++) {
            const [positionToken, uvToken, normalToken] = corners[i].split('/');
            const positionIndex = parseObjIndex(positionToken, this.filePositions.length);
            const uvIndex = parseObjIndex(uvToken, this.fileUvs.length);
            const normalIndex = parseObjIndex(normalToken, this.fileNormals.length);
            cornerIndices[i] = this.cornerIndexFor(positionIndex, uvIndex, normalIndex);
        }

        for (let i = 2; i < cornerIndices.length; i++) {
            this.builder.triangles.push(Vec.of<3>([cornerIndices[0], cornerIndices[i - 1], cornerIndices[i]]));
        }
    }

    private cornerIndexFor(positionIndex: number, uvIndex: number, normalIndex: number): number {
        const key = `${positionIndex}/${uvIndex}/${normalIndex}/${this.currentMaterialIndex}`;
        const existing = this.cornerIndexByKey.get(key);
        if (existing !== undefined) return existing;

        const builder = this.builder;
        const index = builder.vertices.length;
        const position = this.filePositions[positionIndex];
        if (position === undefined) throw new Error(`Invalid face: vertex index ${positionIndex + 1} is not defined`);
        builder.vertices.push(position);
        const uv = this.fileUvs[uvIndex];
        builder.uvs.push(uv === undefined ? Vec.alloc2() : uv);
        const normal = this.fileNormals[normalIndex];
        builder.normals.push(normal === undefined ? Vec.alloc3() : Vec.normalizeInto(Vec.alloc3(), normal));
        this.cornerHasFileNormal.push(normal !== undefined);
        builder.vertexMaterial.push(this.currentMaterialIndex);
        this.cornerIndexByKey.set(key, index);
        return index;
    }

    private materialIndexFor(name: string): number {
        const existing = this.materialIndexByName.get(name);
        if (existing !== undefined) return existing;
        const index = this.builder.materials.length;
        this.builder.materials.push(new Material(name));
        this.materialIndexByName.set(name, index);
        return index;
    }
}

function parseNumberList(line: string, prefixLength: number): number[] {
    return line.substring(prefixLength).trim().split(/\s+/).map(Number.parseFloat);
}

function parseObjIndex(token: string | undefined, definedCount: number): number {
    if (token === undefined || token.length === 0) return UNASSIGNED_INDEX;
    const oneBased = Number.parseInt(token, 10);
    if (Number.isNaN(oneBased)) return UNASSIGNED_INDEX;
    return oneBased > 0 ? oneBased - 1 : definedCount + oneBased;
}

export class MeshBuilder {
    public vertices: Vec3[] = []
    public normals: Vec3[] = []
    public uvs: Vec2[] = []
    public triangles: Vec3[] = []
    public materials: Material[] = []
    public vertexMaterial: number[] = []

    public verify() {
        this.verifySize();
        this.verifyTriangles();
    }

    public generateNormals(keepExisting?: readonly boolean[]): void {
        this.verifyTriangles();
        const vertices = this.vertices;
        const normals = this.normals;
        const generated: Vec3[] = new Array(vertices.length);
        for (let i = 0; i < vertices.length; i++) {
            generated[i] = Vec.alloc3();
        }

        const edgeAB = Vec.alloc3();
        const edgeAC = Vec.alloc3();
        const areaWeightedFaceNormal = Vec.alloc3();
        for (const triangle of this.triangles) {
            const ia = Vec.x(triangle) | 0, ib = Vec.y(triangle) | 0, ic = Vec.z(triangle) | 0;
            Vec.subInto(edgeAB, vertices[ib], vertices[ia]);
            Vec.subInto(edgeAC, vertices[ic], vertices[ia]);
            Vec.crossInto(areaWeightedFaceNormal, edgeAB, edgeAC);
            Vec.addInto(generated[ia], generated[ia], areaWeightedFaceNormal);
            Vec.addInto(generated[ib], generated[ib], areaWeightedFaceNormal);
            Vec.addInto(generated[ic], generated[ic], areaWeightedFaceNormal);
        }

        normals.length = vertices.length;
        for (let i = 0; i < vertices.length; i++) {
            if (keepExisting !== undefined && keepExisting[i] === true && normals[i] !== undefined) continue;
            normals[i] = Vec.normalizeInto(generated[i], generated[i]);
        }
    }

    public generateUvs(): void {
        this.uvs.length = this.vertices.length;
        for (let i = 0; i < this.vertices.length; i++) {
            this.uvs[i] = Vec.alloc2()
        }
    }

    private verifySize() {
        if (this.vertices.length != this.uvs.length) {
            throw new Error("All vertices must have a matching UV coordinate");
        }

        if (this.vertices.length != this.normals.length) {
            throw new Error("All vertices must have a matching normal");
        }

        if (this.vertexMaterial.length !== 0 && this.vertexMaterial.length !== this.vertices.length) {
            throw new Error("All vertices must have a material index when any does");
        }

        const materialCount = Math.max(1, this.materials.length);
        for (const materialIndex of this.vertexMaterial) {
            if (materialIndex < 0 || materialIndex >= materialCount || materialIndex !== Math.floor(materialIndex))
                throw new Error(`Invalid material index ${materialIndex}: expected [0, ${materialCount})`);
        }
    }

    private verifyTriangles() {
        const vertexCount = this.vertices.length;
        for (const triangle of this.triangles) {
            for (let i = 0; i < 3; i++) {
                const index = Vec.get(triangle, i);
                if (index >= vertexCount || index < 0 || index !== Math.floor(index))
                    throw new Error(`Invalid triangle: vertex index ${index} out of range [0, ${vertexCount})`);
            }
        }
    }
}
