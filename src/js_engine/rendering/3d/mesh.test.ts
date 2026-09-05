import {describe, expect, test} from "../../testing/harness";
import {Vec} from "../../math/types/vec";
import {Mesh, MeshBuilder} from "./mesh";

const CUBE_OBJ = `
v -1 -1 -1
v  1 -1 -1
v  1  1 -1
v -1  1 -1
v -1 -1  1
v  1 -1  1
v  1  1  1
v -1  1  1
f 5 6 7 8
f 2 1 4 3
f 1 5 8 4
f 6 2 3 7
f 4 8 7 3
f 1 2 6 5
`;

const CCW_XY_TRIANGLE_OBJ = `
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
`;

function normalAt(mesh: Mesh, index: number): [number, number, number] {
    const raw = mesh.normals.raw;
    return [raw[index * 3], raw[index * 3 + 1], raw[index * 3 + 2]];
}

function expectUnitLength([x, y, z]: [number, number, number]): void {
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
}

function expectOutwardNormals(mesh: Mesh): void {
    const vertices = mesh.vertices.raw;
    for (let i = 0; i < mesh.vertCount; i++) {
        const normal = normalAt(mesh, i);
        expectUnitLength(normal);
        const vx = vertices[i * 3], vy = vertices[i * 3 + 1], vz = vertices[i * 3 + 2];
        expect(Math.sign(normal[0])).toBe(Math.sign(vx));
        expect(Math.sign(normal[1])).toBe(Math.sign(vy));
        expect(Math.sign(normal[2])).toBe(Math.sign(vz));
    }
}

describe("MeshBuilder.generateNormals", () => {
    test("a counter-clockwise triangle in the XY plane faces +Z", () => {
        const mesh = Mesh.parseObj(CCW_XY_TRIANGLE_OBJ);
        expect(mesh.triangleCount).toBe(1);
        for (let i = 0; i < 3; i++) {
            expect(normalAt(mesh, i)).toEqual([0, 0, 1]);
        }
    });

    test("quads fan-triangulate and every cube corner points outward", () => {
        const mesh = Mesh.parseObj(CUBE_OBJ);
        expect(mesh.vertCount).toBe(8);
        expect(mesh.triangleCount).toBe(12);
        expectOutwardNormals(mesh);
    });

    test("a vertex no triangle references keeps a zero normal", () => {
        const builder = new MeshBuilder();
        builder.vertices.push(Vec.alloc3(0, 0, 0), Vec.alloc3(1, 0, 0), Vec.alloc3(0, 1, 0), Vec.alloc3(5, 5, 5));
        builder.triangles.push(Vec.alloc3(0, 1, 2));
        builder.generateUvs();
        builder.generateNormals();
        expect(Vec.toArray(builder.normals[3])).toEqual([0, 0, 0]);
        expect(Vec.toArray(builder.normals[0])).toEqual([0, 0, 1]);
    });

    test("larger faces weigh more than smaller ones sharing a vertex", () => {
        const builder = new MeshBuilder();
        builder.vertices.push(
            Vec.alloc3(0, 0, 0),
            Vec.alloc3(10, 0, 0), Vec.alloc3(0, 10, 0),
            Vec.alloc3(0, 0, -1), Vec.alloc3(0, 1, 0),
        );
        builder.triangles.push(Vec.alloc3(0, 1, 2));
        builder.triangles.push(Vec.alloc3(0, 3, 4));
        builder.generateUvs();
        builder.generateNormals();
        const [x, y, z] = Vec.toArray(builder.normals[0]);
        expect(z).toBeGreaterThan(0.99);
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(0.02);
        expect(y).toBe(0);
    });
});

describe("Mesh.parseObj file normals", () => {
    test("consistent per-vertex file normals are kept, normalized", () => {
        const mesh = Mesh.parseObj(`
v 0 0 0
v 1 0 0
v 0 1 0
vn 0 0 -5
f 1//1 2//1 3//1
`);
        for (let i = 0; i < 3; i++) {
            expect(normalAt(mesh, i)).toEqual([0, 0, -1]);
        }
    });

    test("negative normal indices resolve relative to the normals defined so far", () => {
        const mesh = Mesh.parseObj(`
v 0 0 0
v 1 0 0
v 0 1 0
vn 1 0 0
vn 0 0 -1
f -3//-1 -2//-1 -1//-1
`);
        expect(normalAt(mesh, 0)).toEqual([0, 0, -1]);
    });

    test("a vertex given different file normals by different faces triggers generation", () => {
        const mesh = Mesh.parseObj(`
v 0 0 0
v 1 0 0
v 0 1 0
v -1 0 0
vn 0 0 -1
vn 1 0 0
f 1//1 2//1 3//1
f 1//2 3//2 4//2
`);
        expect(normalAt(mesh, 1)).toEqual([0, 0, 1]);
        expect(normalAt(mesh, 3)).toEqual([0, 0, 1]);
    });

    test("a face corner without a normal index triggers generation", () => {
        const mesh = Mesh.parseObj(`
v 0 0 0
v 1 0 0
v 0 1 0
vn 0 0 -1
f 1//1 2 3//1
`);
        expect(normalAt(mesh, 0)).toEqual([0, 0, 1]);
    });

    test("blender's flat-shaded cube.obj regenerates smooth outward normals", () => {
        const mesh = Mesh.fromFile("./demo/3d/cube.obj");
        expect(mesh.vertCount).toBe(8);
        expect(mesh.triangleCount).toBe(12);
        expectOutwardNormals(mesh);
    });

    test("extra components on v lines do not spill into the next vertex", () => {
        const mesh = Mesh.parseObj(`
v 0 0 0 1
v 1 0 0 1
v 0 1 0 1
f 1 2 3
`);
        const raw = mesh.vertices.raw;
        expect(Array.from(raw)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    });
});

describe("MeshBuilder.verify", () => {
    function triangleBuilder(): MeshBuilder {
        const builder = new MeshBuilder();
        builder.vertices.push(Vec.alloc3(0, 0, 0), Vec.alloc3(1, 0, 0), Vec.alloc3(0, 1, 0));
        builder.generateUvs();
        return builder;
    }

    test("rejects a vertex index equal to the vertex count", () => {
        const builder = triangleBuilder();
        builder.triangles.push(Vec.alloc3(0, 1, 3));
        expect(() => builder.generateNormals()).toThrow("Invalid triangle");
    });

    test("rejects a negative vertex index", () => {
        const builder = triangleBuilder();
        builder.triangles.push(Vec.alloc3(0, -1, 2));
        expect(() => builder.generateNormals()).toThrow("Invalid triangle");
    });

    test("rejects a normal count that does not match the vertex count", () => {
        const builder = triangleBuilder();
        builder.triangles.push(Vec.alloc3(0, 1, 2));
        builder.normals.push(Vec.alloc3(0, 0, 1));
        expect(() => new Mesh(builder)).toThrow("matching normal");
    });
});
