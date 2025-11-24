import {Vec2, Vec3} from "../../math/types/vec";
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
        const data = [...builder.vertices, ...builder.normals, ...builder.uvs.map(value => [...value, 0] as Vec3), ...builder.triangles];
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

        lines.forEach(rawLine => {
            const line = rawLine.trim();

            // Skip empty lines and comments
            if (!line || line.startsWith('#')) {
                return;
            }

            // Positions: lines starting with "v " only (NOT vt / vn)
            if (line.startsWith("v ")) {
                const vertexData = line
                    .substring(2)          // drop "v "
                    .trim()
                    .split(/\s+/)          // handle multiple spaces
                    .map(v => Number.parseFloat(v));

                // Expecting at least x, y, z
                if (vertexData.length >= 3) {
                    meshBuilder.vertices.push(vertexData as Vec3);
                }

                // Texture coords: "vt " (parsed & ignored here unless you wire them into MeshBuilder)
            } else if (line.startsWith("vt ")) {
                return;
                // todo :more vt than v in CORRECT obj file
                // const uvData = line
                //     .substring(3)
                //     .trim()
                //     .split(/\s+/)
                //     .map(v => Number.parseFloat(v));
                // meshBuilder.uvs.push([uvData[0], uvData[1]] as Vec2);
                // return;

                // Normals: "vn " (same idea as vt)
            } else if (line.startsWith("vn ")) {
                const normalData = line
                    .substring(3)          // drop "vn "
                    .trim()
                    .split(/\s+/)          // handle multiple spaces/tabs
                    .map(v => Number.parseFloat(v));

                // Expect nx, ny, nz
                if (normalData.length >= 3) {
                    meshBuilder.normals.push(normalData as Vec3);
                }

                return;
                // Faces: "f "
            } else if (line.startsWith("f ")) {
                const faceData = line
                    .substring(2)          // drop "f "
                    .trim()
                    .split(/\s+/)          // each token is like v, v/vt, v//vn, v/vt/vn
                    .map(str => str.split('/')
                        .map(v => v.length ? Number.parseInt(v, 10) : NaN)
                    )
                    .map(data => {
                        // OBJ indices are 1-based, convert to 0-based.
                        // We only care about the position index (data[0]) here.
                        if (!Number.isNaN(data[0])) {
                            // Positive index: 1..N -> 0..N-1
                            if (data[0] > 0) {
                                data[0] -= 1;
                            } else {
                                // Negative index: -1 = last defined vertex, etc.
                                data[0] = meshBuilder.vertices.length + data[0];
                            }
                        }
                        return data;
                    });

                if (faceData.length < 3) {
                    return; // not enough vertices to form a face
                }

                // Triangulate polygon as fan: (0,1,2), (0,2,3), ...
                // Using only position indices (data[0])
                meshBuilder.triangles.push([
                    faceData[0][0],
                    faceData[1][0],
                    faceData[2][0],
                ]);

                for (let i = 3; i < faceData.length; i++) {
                    const p0 = faceData[0][0];
                    const p1 = faceData[i - 1][0];
                    const p2 = faceData[i][0];
                    meshBuilder.triangles.push([p0, p1, p2]);
                }
            }
        });

        // Still using your procedural generators
        meshBuilder.generateUvs();
        meshBuilder.generateNormals();

        return new Mesh(meshBuilder);
    }
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
        // for now just set to 0
        for (let i = 0; i < this.vertices.length; i++) {
            this.normals[i] = [0, 0, 0]
        }
    }

    public generateUvs(): void {
        // for now just set to 0
        for (let i = 0; i < this.vertices.length; i++) {
            this.uvs[i] = [0, 0]
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