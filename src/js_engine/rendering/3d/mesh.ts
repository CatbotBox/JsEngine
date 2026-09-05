import {Vec, Vec2, Vec3} from "../../math/types/vec";
import {Vec3Array, VecArray} from "../../math/types/vecArray";

export class Mesh {
    public readonly data: Vec3Array;
    public readonly vertCount: number;
    public readonly triangleCount: number;

    private _bounds?: Float32Array;

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

    public constructor(builder: MeshBuilder) {
        builder.verify();

        this.triangleCount = builder.triangles.length;
        this.vertCount = builder.vertices.length;
        const data = [...builder.vertices, ...builder.normals, ...builder.uvs.map(uv => Vec.alloc3(Vec.x(uv), Vec.y(uv), 0)), ...builder.triangles];
        this.data = new VecArray(data, 3);
    }

    public static fromFile(filePath: string): Mesh {
        const fs = require("fs");
        const data = fs.readFileSync(filePath).toString();
        const fileType = filePath.slice(filePath.lastIndexOf("."));
        if (fileType === '.obj') {
            return Mesh.parseObj(data);
        }
        throw Error(`Unable to parse file: ${filePath}. Reason ${fileType} not supported`);
    }

    public static parseObj(data: string): Mesh {
        return new ObjParser(data).toMesh();
    }
}

const UNASSIGNED_INDEX = -1;

class ObjParser {
    private readonly builder = new MeshBuilder();
    private readonly fileNormals: Vec3[] = [];
    private readonly fileNormalIndexOfVertex: number[] = [];
    private everyFaceCornerHasAConsistentFileNormal = true;

    public constructor(data: string) {
        for (const rawLine of data.split(/\r?\n/)) {
            this.parseLine(rawLine.trim());
        }
    }

    public toMesh(): Mesh {
        const builder = this.builder;
        builder.generateUvs();
        if (this.canUseFileNormals()) {
            this.applyFileNormals();
        } else {
            builder.generateNormals();
        }
        return new Mesh(builder);
    }

    private parseLine(line: string): void {
        if (line.length === 0 || line[0] === '#') return;
        if (line.startsWith("v ")) {
            this.parseVertex(line);
        } else if (line.startsWith("vn ")) {
            this.parseNormal(line);
        } else if (line.startsWith("f ")) {
            this.parseFace(line);
        }
    }

    private parseVertex(line: string): void {
        const components = parseNumberList(line, 2);
        if (components.length >= 3) {
            this.builder.vertices.push(Vec.alloc3(components[0], components[1], components[2]));
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

        const vertexIndices: number[] = new Array(corners.length);
        for (let i = 0; i < corners.length; i++) {
            const [vertexToken, , normalToken] = corners[i].split('/');
            const vertexIndex = parseObjIndex(vertexToken, this.builder.vertices.length);
            vertexIndices[i] = vertexIndex;
            this.recordFileNormalOfVertex(vertexIndex, parseObjIndex(normalToken, this.fileNormals.length));
        }

        for (let i = 2; i < vertexIndices.length; i++) {
            this.builder.triangles.push(Vec.of<3>([vertexIndices[0], vertexIndices[i - 1], vertexIndices[i]]));
        }
    }

    private recordFileNormalOfVertex(vertexIndex: number, normalIndex: number): void {
        if (!this.everyFaceCornerHasAConsistentFileNormal) return;
        if (normalIndex === UNASSIGNED_INDEX || normalIndex >= this.fileNormals.length || vertexIndex < 0) {
            this.everyFaceCornerHasAConsistentFileNormal = false;
            return;
        }
        const previous = this.fileNormalIndexOfVertex[vertexIndex];
        if (previous === undefined || previous === UNASSIGNED_INDEX) {
            this.fileNormalIndexOfVertex[vertexIndex] = normalIndex;
        } else if (previous !== normalIndex) {
            this.everyFaceCornerHasAConsistentFileNormal = false;
        }
    }

    private canUseFileNormals(): boolean {
        return this.everyFaceCornerHasAConsistentFileNormal && this.fileNormals.length > 0 && this.builder.triangles.length > 0;
    }

    private applyFileNormals(): void {
        const builder = this.builder;
        for (let i = 0; i < builder.vertices.length; i++) {
            const normalIndex = this.fileNormalIndexOfVertex[i];
            const normal = Vec.alloc3();
            if (normalIndex !== undefined && normalIndex !== UNASSIGNED_INDEX) {
                Vec.normalizeInto(normal, this.fileNormals[normalIndex]);
            }
            builder.normals[i] = normal;
        }
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

    public verify() {
        this.verifySize();
        this.verifyTriangles();
    }

    public generateNormals(): void {
        this.verifyTriangles();
        const vertices = this.vertices;
        const normals = this.normals;
        normals.length = vertices.length;
        for (let i = 0; i < vertices.length; i++) {
            normals[i] = Vec.alloc3();
        }

        const edgeAB = Vec.alloc3();
        const edgeAC = Vec.alloc3();
        const areaWeightedFaceNormal = Vec.alloc3();
        for (const triangle of this.triangles) {
            const ia = Vec.x(triangle) | 0, ib = Vec.y(triangle) | 0, ic = Vec.z(triangle) | 0;
            Vec.subInto(edgeAB, vertices[ib], vertices[ia]);
            Vec.subInto(edgeAC, vertices[ic], vertices[ia]);
            Vec.crossInto(areaWeightedFaceNormal, edgeAB, edgeAC);
            Vec.addInto(normals[ia], normals[ia], areaWeightedFaceNormal);
            Vec.addInto(normals[ib], normals[ib], areaWeightedFaceNormal);
            Vec.addInto(normals[ic], normals[ic], areaWeightedFaceNormal);
        }

        for (const normal of normals) {
            Vec.normalizeInto(normal, normal);
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
