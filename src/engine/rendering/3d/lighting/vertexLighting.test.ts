import {describe, expect, test} from "../../../testing/harness";
import {Vec, Vec4} from "../../../math/types/vec";
import {LocalToWorld} from "../../../translation/localToWorld";
import {Mesh, MeshBuilder} from "../mesh";
import {Material} from "../material";
import {Texture} from "../texture";
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

function triangleFacingCamera(material: Material, firstVertexUv: [number, number] = [0, 0]): Mesh {
    const builder = new MeshBuilder();
    builder.vertices.push(Vec.alloc3(0, 0, 5), Vec.alloc3(0, 1, 5), Vec.alloc3(1, 0, 5));
    builder.triangles.push(Vec.alloc3(0, 1, 2));
    builder.materials.push(material);
    builder.vertexMaterial.push(0, 0, 0);
    builder.uvs.push(Vec.alloc2(firstVertexUv[0], firstVertexUv[1]), Vec.alloc2(0, 1), Vec.alloc2(1, 0));
    builder.generateNormals();
    return new Mesh(builder);
}

function glossyMaterial(diffuse: number, specular: number, shininess: number, emissive = 0): Material {
    const material = new Material("glossy", diffuse);
    material.specularColor = specular;
    material.shininess = shininess;
    material.emissiveColor = emissive;
    return material;
}

function shadeVertexFacingCamera(setup: (lights: SceneLights) => void, material: Material, tint = 0xFFFFFF, firstVertexUv?: [number, number]): number[] {
    const lights = new SceneLights();
    lights.beginGather();
    setup(lights);
    const lighting = new VertexLighting();
    lighting.beginFrame(lights, identity);
    const viewMesh = new ViewSpaceMesh().transformFrom(triangleFacingCamera(material, firstVertexUv), new Float32Array(identityMatrix), identityNormalMatrix);
    const rgb = lighting.shade(viewMesh, tint);
    return Array.from(rgb.subarray(0, 3)).map(v => Math.round(v * 1000) / 1000);
}

const BLACK = 0x000000, WHITE = 0xFFFFFF, HALF = 0x808080;
const halfSpecular = 128 / 255;
const towardsFace = (lights: SceneLights) => lights.addDirectional(0, 0, 1, 1, 1, 1);
const fortyFiveDegreesOntoFace = (lights: SceneLights) => lights.addDirectional(-1, 0, 1, 1, 1, 1);

describe("VertexLighting specular and emissive", () => {
    test("a material without specular or emission shades exactly as a plain material", () => {
        const plain = shadeVertexFacingCamera(l => {
            l.addAmbient(0.1, 0.1, 0.1);
            l.addPoint(0, 0, 4, 1, 1, 1, 2);
        }, new Material("plain", WHITE));
        const glossless = shadeVertexFacingCamera(l => {
            l.addAmbient(0.1, 0.1, 0.1);
            l.addPoint(0, 0, 4, 1, 1, 1, 2);
        }, glossyMaterial(WHITE, 0, 96));
        expect(glossless).toEqual(plain);
        expect(plain).toEqual([0.663, 0.663, 0.663]);
    });

    test("the mirror direction gives the full specular color at any shininess", () => {
        for (const shininess of [1, 8, 96, 1000]) {
            const rgb = shadeVertexFacingCamera(towardsFace, glossyMaterial(BLACK, HALF, shininess));
            expect(rgb).toEqual([0.502, 0.502, 0.502]);
        }
    });

    test("off the mirror direction the highlight follows cos(angle)^shininess", () => {
        const normalDotHalf = Math.cos(Math.PI / 8);
        for (const shininess of [2, 8]) {
            const expected = Math.round(halfSpecular * Math.pow(normalDotHalf, shininess) * 1000) / 1000;
            const rgb = shadeVertexFacingCamera(fortyFiveDegreesOntoFace, glossyMaterial(BLACK, HALF, shininess));
            expect(rgb[0]).toBeCloseTo(expected, 3);
            expect(rgb[1]).toBe(rgb[0]);
            expect(rgb[2]).toBe(rgb[0]);
        }
    });

    test("a negligible highlight is skipped entirely", () => {
        expect(shadeVertexFacingCamera(fortyFiveDegreesOntoFace, glossyMaterial(BLACK, HALF, 1000))).toEqual([0, 0, 0]);
    });

    test("light from behind the face gives no highlight", () => {
        expect(shadeVertexFacingCamera(l => l.addDirectional(0, 0, -1, 1, 1, 1), glossyMaterial(BLACK, HALF, 8))).toEqual([0, 0, 0]);
    });

    test("point light highlights attenuate with the same falloff as their diffuse term", () => {
        const pointLight = (l: SceneLights) => l.addPoint(0, 0, 4, 1, 1, 1, 2);
        expect(shadeVertexFacingCamera(pointLight, glossyMaterial(WHITE, 0, 8))).toEqual([0.563, 0.563, 0.563]);
        expect(shadeVertexFacingCamera(pointLight, glossyMaterial(BLACK, WHITE, 8))).toEqual([0.563, 0.563, 0.563]);
        expect(shadeVertexFacingCamera(pointLight, glossyMaterial(WHITE, WHITE, 8))).toEqual([1.125, 1.125, 1.125]);
    });

    test("specular color is tinted like the albedo", () => {
        expect(shadeVertexFacingCamera(towardsFace, glossyMaterial(BLACK, WHITE, 8), 0x0080FF)).toEqual([0, 0.502, 1]);
    });

    test("emissive adds the material color even with no lights and is tinted", () => {
        const emissive = glossyMaterial(WHITE, 0, 0, 0x404040);
        expect(shadeVertexFacingCamera(() => {}, emissive)).toEqual([0.251, 0.251, 0.251]);
        expect(shadeVertexFacingCamera(() => {}, emissive, HALF)).toEqual([0.126, 0.126, 0.126]);
        expect(shadeVertexFacingCamera(l => l.addAmbient(0.5, 0.5, 0.5), emissive)).toEqual([0.751, 0.751, 0.751]);
    });

    test("a specular texture scales the highlight by the texel at the vertex uv", () => {
        const glossMap = Texture.fromRgba(2, 1, new Uint8Array([0, 0, 0, 255, 255, 128, 0, 255]));
        const material = glossyMaterial(BLACK, WHITE, 8);
        material.specularTexture = glossMap;
        expect(shadeVertexFacingCamera(towardsFace, material, WHITE, [0.25, 0.5])).toEqual([0, 0, 0]);
        expect(shadeVertexFacingCamera(towardsFace, material, WHITE, [0.75, 0.5])).toEqual([1, 0.502, 0]);
        expect(shadeVertexFacingCamera(towardsFace, material, WHITE, [1.75, -0.5])).toEqual([1, 0.502, 0]);
    });

    test("an emissive material does not make a scene without lights count as lit", () => {
        const lights = new SceneLights();
        lights.beginGather();
        const lighting = new VertexLighting();
        lighting.beginFrame(lights, identity);
        expect(lighting.lit).toBe(false);
    });
});
