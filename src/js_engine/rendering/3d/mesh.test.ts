import {describe, expect, test} from "../../testing/harness";
import {Vec} from "../../math/types/vec";
import {Mesh, MeshBuilder} from "./mesh";
import {Material, multiplyPackedRgb, packRgb} from "./material";
import {parseMtl} from "./mtlParser";

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

function uvAt(mesh: Mesh, index: number): [number, number] {
    const raw = mesh.uvs.raw;
    return [raw[index * 3], raw[index * 3 + 1]];
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
        expect(normal[0] * vx + normal[1] * vy + normal[2] * vz).toBeGreaterThan(0);
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

    test("quads fan-triangulate and every smooth cube corner points outward", () => {
        const mesh = Mesh.parseObj(CUBE_OBJ);
        expect(mesh.vertCount).toBe(8);
        expect(mesh.triangleCount).toBe(12);
        expectOutwardNormals(mesh);
        const vertices = mesh.vertices.raw;
        for (let i = 0; i < mesh.vertCount; i++) {
            const normal = normalAt(mesh, i);
            expect(Math.sign(normal[0])).toBe(Math.sign(vertices[i * 3]));
            expect(Math.sign(normal[1])).toBe(Math.sign(vertices[i * 3 + 1]));
            expect(Math.sign(normal[2])).toBe(Math.sign(vertices[i * 3 + 2]));
        }
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

    test("keepExisting leaves the flagged normals alone and generates the rest", () => {
        const builder = new MeshBuilder();
        builder.vertices.push(Vec.alloc3(0, 0, 0), Vec.alloc3(1, 0, 0), Vec.alloc3(0, 1, 0));
        builder.normals.push(Vec.alloc3(0, 0, -1), Vec.alloc3(), Vec.alloc3());
        builder.triangles.push(Vec.alloc3(0, 1, 2));
        builder.generateUvs();
        builder.generateNormals([true, false, false]);
        expect(Vec.toArray(builder.normals[0])).toEqual([0, 0, -1]);
        expect(Vec.toArray(builder.normals[1])).toEqual([0, 0, 1]);
    });
});

describe("Mesh.parseObj corners", () => {
    test("file normals are kept per corner, normalized", () => {
        const mesh = Mesh.parseObj(`
v 0 0 0
v 1 0 0
v 0 1 0
vn 0 0 -5
f 1//1 2//1 3//1
`);
        expect(mesh.vertCount).toBe(3);
        for (let i = 0; i < 3; i++) {
            expect(normalAt(mesh, i)).toEqual([0, 0, -1]);
        }
    });

    test("negative indices resolve relative to what has been defined so far", () => {
        const mesh = Mesh.parseObj(`
v 0 0 0
v 1 0 0
v 0 1 0
vt 0.5 0.25
vn 1 0 0
vn 0 0 -1
f -3/-1/-1 -2/-1/-1 -1/-1/-1
`);
        expect(normalAt(mesh, 0)).toEqual([0, 0, -1]);
        expect(uvAt(mesh, 0)).toEqual([0.5, 0.25]);
    });

    test("a position used with two different normals becomes two vertices, both with file normals", () => {
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
        expect(mesh.vertCount).toBe(6);
        expect(mesh.triangleCount).toBe(2);
        expect(normalAt(mesh, 0)).toEqual([0, 0, -1]);
        expect(normalAt(mesh, 3)).toEqual([1, 0, 0]);
        const triangles = mesh.triangles.raw;
        expect(Array.from(triangles)).toEqual([0, 1, 2, 3, 4, 5]);
    });

    test("identical corners across faces are shared", () => {
        const mesh = Mesh.parseObj(`
v 0 0 0
v 1 0 0
v 0 1 0
v 1 1 0
vt 0 0
vt 1 0
vt 0 1
vt 1 1
f 1/1 2/2 3/3
f 2/2 4/4 3/3
`);
        expect(mesh.vertCount).toBe(4);
        expect(Array.from(mesh.triangles.raw)).toEqual([0, 1, 2, 1, 3, 2]);
        expect(uvAt(mesh, 3)).toEqual([1, 1]);
    });

    test("a corner without a normal index gets a generated normal while the others keep theirs", () => {
        const mesh = Mesh.parseObj(`
v 0 0 0
v 1 0 0
v 0 1 0
vn 0 0 -1
f 1//1 2 3//1
`);
        expect(normalAt(mesh, 0)).toEqual([0, 0, -1]);
        expect(normalAt(mesh, 1)).toEqual([0, 0, 1]);
    });

    test("blender's flat-shaded cube.obj becomes 24 corners with axis-aligned normals and per-corner uvs", () => {
        const mesh = Mesh.fromFile("./demo/3d/cube.obj");
        expect(mesh.vertCount).toBe(24);
        expect(mesh.triangleCount).toBe(12);
        expectOutwardNormals(mesh);
        for (let i = 0; i < mesh.vertCount; i++) {
            const normal = normalAt(mesh, i).map(Math.abs).sort();
            expect(normal).toEqual([0, 0, 1]);
        }
        const uvs = new Set<string>();
        for (let i = 0; i < mesh.vertCount; i++) uvs.add(uvAt(mesh, i).join(","));
        expect(uvs.size).toBeGreaterThan(8);
        expect(mesh.materials.length).toBe(1);
        expect(mesh.materials[0].name).toBe("Material");
        expect(mesh.materials[0].diffuseColor).toBe(0xFFFFFF);
    });

    test("extra components on v lines do not spill into the next vertex", () => {
        const mesh = Mesh.parseObj(`
v 0 0 0 1
v 1 0 0 1
v 0 1 0 1
f 1 2 3
`);
        expect(Array.from(mesh.vertices.raw)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    });

    test("a face referencing an undefined position throws", () => {
        expect(() => Mesh.parseObj("v 0 0 0\nf 1 2 3\n")).toThrow("not defined");
    });
});

describe("Mesh materials", () => {
    const TWO_MATERIAL_OBJ = `
v 0 0 0
v 1 0 0
v 0 1 0
v 1 1 0
usemtl red
f 1 2 3
usemtl blue
f 2 4 3
`;

    test("usemtl assigns a material per corner and splits shared corners across materials", () => {
        const mesh = Mesh.parseObj(TWO_MATERIAL_OBJ);
        expect(mesh.materials.map(m => m.name)).toEqual(["red", "blue"]);
        expect(mesh.vertCount).toBe(6);
        expect(Array.from(mesh.vertexMaterial)).toEqual([0, 0, 0, 1, 1, 1]);
        expect(mesh.materialOfTriangle(0).name).toBe("red");
        expect(mesh.materialOfTriangle(1).name).toBe("blue");
    });

    test("materials named in the obj but absent from the library render as default white", () => {
        const mesh = Mesh.parseObj(TWO_MATERIAL_OBJ, parseMtl("newmtl red\nKd 1 0 0\n"));
        expect(mesh.materials[0].diffuseColor).toBe(0xFF0000);
        expect(mesh.materials[1].diffuseColor).toBe(0xFFFFFF);
    });

    test("faces before any usemtl use the default material", () => {
        const mesh = Mesh.parseObj(CCW_XY_TRIANGLE_OBJ);
        expect(mesh.materials.length).toBe(1);
        expect(mesh.materials[0].name).toBe(Material.DEFAULT_NAME);
        expect(Array.from(mesh.vertexMaterial)).toEqual([0, 0, 0]);
    });

    test("a MeshBuilder without materials yields one default material", () => {
        const builder = new MeshBuilder();
        builder.vertices.push(Vec.alloc3(0, 0, 0), Vec.alloc3(1, 0, 0), Vec.alloc3(0, 1, 0));
        builder.triangles.push(Vec.alloc3(0, 1, 2));
        builder.generateUvs();
        builder.generateNormals();
        const mesh = new Mesh(builder);
        expect(mesh.materials.length).toBe(1);
        expect(mesh.materialOfTriangle(0).diffuseColor).toBe(0xFFFFFF);
    });

    test("a material index out of range is rejected", () => {
        const builder = new MeshBuilder();
        builder.vertices.push(Vec.alloc3(0, 0, 0), Vec.alloc3(1, 0, 0), Vec.alloc3(0, 1, 0));
        builder.triangles.push(Vec.alloc3(0, 1, 2));
        builder.vertexMaterial.push(0, 0, 1);
        builder.generateUvs();
        builder.generateNormals();
        expect(() => new Mesh(builder)).toThrow("Invalid material index");
    });
});

describe("parseMtl", () => {
    test("reads Kd and map_Kd per material and ignores what it does not know", () => {
        const library = parseMtl(`
# comment
newmtl leaf
Ns 96
Kd 0.2 0.8 0.4
map_Kd -s 1 1 1 textures/leaf.png
newmtl bark
Kd 0.5 0.25 0
d 1.0
`, "models");
        expect(library.size).toBe(2);
        expect(library.get("leaf")!.diffuseColor).toBe(packRgb(0.2, 0.8, 0.4));
        expect(library.get("leaf")!.diffuseTexturePath!.replace(/\\/g, "/")).toBe("models/textures/leaf.png");
        expect(library.get("bark")!.diffuseColor).toBe(0x804000);
        expect(library.get("bark")!.diffuseTexturePath).toBeUndefined();
    });

    test("statements before the first newmtl are ignored", () => {
        expect(parseMtl("Kd 1 0 0\n").size).toBe(0);
    });

    test("map_Kd keeps spaces in the file name and skips option flags with their arguments", () => {
        const pathOf = (line: string, baseDirectory = "models") =>
            parseMtl(`newmtl m\n${line}\n`, baseDirectory).get("m")!.diffuseTexturePath!.replace(/\\/g, "/");
        expect(pathOf("map_Kd textures\\indoor plant_2_COL.jpg")).toBe("models/textures/indoor plant_2_COL.jpg");
        expect(pathOf("map_Kd  textures\\\\indoor plant_2_NOR.jpg")).toBe("models/textures/indoor plant_2_NOR.jpg");
        expect(pathOf("map_Kd -s 1 1 1 -o 0 0 0 -clamp on my tex.png")).toBe("models/my tex.png");
        expect(pathOf("map_Kd -bm 0.5 leaf.png", "")).toBe("leaf.png");
        expect(pathOf("map_Kd C:\\textures\\abs.png")).toBe("C:/textures/abs.png");
        expect(pathOf("map_Kd /textures/abs.png")).toBe("/textures/abs.png");
    });
});

describe("packed color helpers", () => {
    test("multiplying by white is the identity for every channel value", () => {
        for (const value of [0, 1, 2, 127, 128, 254, 255]) {
            const packed = (value << 16) | (value << 8) | value;
            expect(multiplyPackedRgb(0xFFFFFF, packed)).toBe(packed);
            expect(multiplyPackedRgb(packed, 0xFFFFFF)).toBe(packed);
        }
    });

    test("multiplying scales channels and packRgb clamps", () => {
        expect(multiplyPackedRgb(0x808080, 0x808080)).toBe(0x404040);
        expect(packRgb(2, -1, 0.5)).toBe(0xFF0080);
    });
});
