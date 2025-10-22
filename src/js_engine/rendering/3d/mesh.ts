import {Vec3} from "../../math/types/vec";
import {Vec3Array, VecArray} from "../../math/types/vecArray";

export class Mesh {
    public readonly data: Vec3Array;
    public readonly vertCount: number;
    public readonly triangleCount: number;

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
        const data = [...builder.vertices, ...builder.normals, ...builder.uvs, ...builder.triangles];
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

    private static parseObj(data: string): Mesh {
        const lines = data.split(/\r?\n/);
        const meshBuilder = new MeshBuilder();
        lines.forEach(line => {
            if (line.startsWith("v")) {
                const vertexData = line
                    .slice(2)
                    .split(' ')
                    .map(v => Number.parseFloat(v));
                meshBuilder.vertices.push(vertexData as Vec3)
            } else if (line.startsWith("f")) {
                const faceData = line.slice(2).split(' ')
                    .map((str) => str.split('/')
                        // return array instead of 1st index because we might need the other data in the future
                        .map(v => Number.parseInt(v)))
                    .map(data => {
                        //obj files start with 1 instead of 0;
                        data[0] -= 1;
                        return data;
                    });
                meshBuilder.triangles.push([faceData[0][0], faceData[1][0], faceData[2][0]])
                for (let i = 3; i < faceData.length; i++) {
                    const point0 = faceData[0][0];
                    const point1 = faceData[i - 1][0];
                    const point2 = faceData[i][0];
                    meshBuilder.triangles.push([point0, point1, point2]);
                }
            }
        })

        meshBuilder.generateUvs();
        meshBuilder.generateNormals();
        return new Mesh(meshBuilder);
    }
}

export class MeshBuilder {
    public vertices: Vec3[] = []
    public normals: Vec3[] = []
    public uvs: Vec3[] = []
    public triangles: Vec3[] = []

    public verify() {
        this.verifySize();
        this.verifyTriangles();
    }

    public generateNormals(): void {
        // for now just set to 0
        for (let i = 0; i < this.vertices.length; i++) {
            this.normals[i] = [0, 0, 0]
        }
    }

    public generateUvs(): void {
        // for now just set to 0
        for (let i = 0; i < this.vertices.length; i++) {
            this.uvs[i] = [0, 0, 0]
        }
    }

    private verifySize() {
        if (this.vertices.length < 0) {
            throw new Error("Vertices must be greater than 0");
        }

        if (this.vertices.length != this.uvs.length) {
            throw new Error("All vertices must have a matching UV coordinate");
        }

        if (this.vertices.length != this.normals.length) {
            throw new Error("All vertices must have a matching normal");

        }
    }

    private verifyTriangles() {
        this.triangles.forEach((tri) => {
            for (let i = 0; i < 3; i++) {
                if (tri[i] > this.vertices.length || tri[i] < 0)
                    throw new Error("Invalid Triangle");
            }
        })
    }
}