import {describe, expect, test} from "../../../testing/harness";
import {Vec, Vec4} from "../../../math/types/vec";
import {LocalToWorld} from "../../../translation/localToWorld";
import {Mesh, MeshBuilder} from "../mesh";
import {ViewSpaceMesh} from "../viewSpaceMesh";
import {SceneLights} from "./sceneLights";
import {VertexLighting} from "./vertexLighting";

function triangleFacingPlusZ(): Mesh {
    const builder = new MeshBuilder();
    builder.vertices.push(Vec.alloc3(0, 0, 0), Vec.alloc3(1, 0, 0), Vec.alloc3(0, 1, 0));
    builder.triangles.push(Vec.alloc3(0, 1, 2));
    builder.generateUvs();
    builder.generateNormals();
    return new Mesh(builder);
}

const identity = LocalToWorld.identity();
const identityMatrix = Vec.toArray(identity);
const identityNormalMatrix = LocalToWorld.normalMatrix3(identity, new Float32Array(9));

function shadeTriangle(setup: (lights: SceneLights) => void, albedo = 0xFFFFFF): number[] {
    const lights = new SceneLights();
    lights.beginGather();
    setup(lights);
    const lighting = new VertexLighting();
    lighting.beginFrame(lights, identity);
    const viewMesh = new ViewSpaceMesh().transformFrom(triangleFacingPlusZ(), new Float32Array(identityMatrix), identityNormalMatrix);
    const rgb = lighting.shade(viewMesh, albedo);
    return Array.from(rgb.subarray(0, 3)).map(v => Math.round(v * 1000) / 1000);
}

describe("ViewSpaceMesh", () => {
    test("transforms positions with the full affine matrix and normals with the normal matrix", () => {
        const m = LocalToWorld.fromTRS(LocalToWorld.identity(), Vec.alloc3(10, 0, 0), Vec4.alloc(0, 0, 0, 1), Vec.alloc3(2, 1, 1));
        const normalMatrix = LocalToWorld.normalMatrix3(m, new Float32Array(9));
        const viewMesh = new ViewSpaceMesh().transformFrom(triangleFacingPlusZ(), new Float32Array(Vec.toArray(m)), normalMatrix);
        expect(viewMesh.vertCount).toBe(3);
        expect(viewMesh.hasNormals).toBe(true);
        expect(Array.from(viewMesh.positions.subarray(3, 6))).toEqual([12, 0, 0]);
        expect(Array.from(viewMesh.normals.subarray(0, 3))).toEqual([0, 0, 1]);
    });

    test("skips normals when no normal matrix is given", () => {
        const viewMesh = new ViewSpaceMesh().transformFrom(triangleFacingPlusZ(), new Float32Array(identityMatrix), null);
        expect(viewMesh.hasNormals).toBe(false);
    });
});

describe("VertexLighting", () => {
    test("reports unlit when the scene has no lights", () => {
        const lights = new SceneLights();
        lights.beginGather();
        const lighting = new VertexLighting();
        lighting.beginFrame(lights, identity);
        expect(lighting.lit).toBe(false);
    });

    test("ambient alone multiplies the albedo", () => {
        expect(shadeTriangle(l => l.addAmbient(0.2, 0.4, 0.6), 0x80FF00)).toEqual([0.1, 0.4, 0]);
    });

    test("a directional light shining onto the surface adds its full color", () => {
        expect(shadeTriangle(l => {
            l.addAmbient(0.1, 0.1, 0.1);
            l.addDirectional(0, 0, -1, 0.5, 0.5, 0.5);
        })).toEqual([0.6, 0.6, 0.6]);
    });

    test("a directional light from behind contributes nothing", () => {
        expect(shadeTriangle(l => {
            l.addAmbient(0.1, 0.1, 0.1);
            l.addDirectional(0, 0, 1, 1, 1, 1);
        })).toEqual([0.1, 0.1, 0.1]);
    });

    test("a grazing directional light scales by the cosine", () => {
        const invSqrt2 = Math.SQRT1_2;
        expect(shadeTriangle(l => l.addDirectional(invSqrt2, 0, -invSqrt2, 1, 1, 1))).toEqual([0.707, 0.707, 0.707]);
    });

    test("a point light falls off with distance and reaches zero at its range", () => {
        expect(shadeTriangle(l => l.addPoint(0, 0, 1, 1, 1, 1, 2))).toEqual([0.563, 0.563, 0.563]);
        expect(shadeTriangle(l => l.addPoint(0, 0, 2, 1, 1, 1, 2))).toEqual([0, 0, 0]);
        expect(shadeTriangle(l => l.addPoint(0, 0, -1, 1, 1, 1, 5))).toEqual([0, 0, 0]);
    });

    test("light positions and directions are transformed into view space", () => {
        const viewMatrix = LocalToWorld.fromTRS(LocalToWorld.identity(), Vec.alloc3(0, 0, -1), Vec4.alloc(0, 0, 0, 1), Vec.alloc3(1, 1, 1));
        const lights = new SceneLights();
        lights.beginGather();
        lights.addPoint(0, 0, 2, 1, 1, 1, 2);
        const lighting = new VertexLighting();
        lighting.beginFrame(lights, viewMatrix);
        const viewMesh = new ViewSpaceMesh().transformFrom(triangleFacingPlusZ(), new Float32Array(identityMatrix), identityNormalMatrix);
        const rgb = lighting.shade(viewMesh, 0xFFFFFF);
        expect(Math.round(rgb[0] * 1000) / 1000).toBe(0.563);
    });

    test("intensity is not clamped here, so the rasterizer decides saturation", () => {
        expect(shadeTriangle(l => l.addDirectional(0, 0, -1, 3, 3, 3))).toEqual([3, 3, 3]);
    });
});
