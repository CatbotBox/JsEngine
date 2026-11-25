import {describe, expect, test} from "../../../testing/harness";
import {Vec, Vec4} from "../../../math/types/vec";
import {LocalToWorld} from "../../../translation/localToWorld";
import {Mesh, MeshBuilder} from "../mesh";
import {Material} from "../material";
import {Texture} from "../texture";
import {ViewSpaceMesh} from "../viewSpaceMesh";
import {SceneLights} from "./sceneLights";
import {VertexLighting, VertexShading} from "./vertexLighting";
import {BLACK_RGB, WHITE_RGB} from "../../packedRgb";

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

function roundedFirstVertex(rgb: Float64Array): number[] {
    return Array.from(rgb.subarray(0, 3)).map(v => Math.round(v * 1000) / 1000);
}

function firstVertexTotal(shading: VertexShading): number[] {
    return roundedFirstVertex(shading.diffuseRgb.map((diffuse, i) => diffuse + shading.specularRgb[i]));
}

function shadeTriangle(setup: (lights: SceneLights) => void, albedo = 0xFFFFFF): number[] {
    const lights = new SceneLights();
    lights.beginGather();
    setup(lights);
    const lighting = new VertexLighting();
    lighting.beginFrame(lights, identity);
    const viewMesh = new ViewSpaceMesh().transformFrom(triangleFacingPlusZ(), new Float32Array(identityMatrix), identityNormalMatrix);
    return firstVertexTotal(lighting.shade(viewMesh, albedo));
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
        const rgb = lighting.shade(viewMesh, 0xFFFFFF).diffuseRgb;
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

function shadeFacingCamera(setup: (lights: SceneLights) => void, material: Material, tint = 0xFFFFFF, firstVertexUv?: [number, number]): VertexShading {
    const lights = new SceneLights();
    lights.beginGather();
    setup(lights);
    const lighting = new VertexLighting();
    lighting.beginFrame(lights, identity);
    const viewMesh = new ViewSpaceMesh().transformFrom(triangleFacingCamera(material, firstVertexUv), new Float32Array(identityMatrix), identityNormalMatrix);
    return lighting.shade(viewMesh, tint);
}

function shadeVertexFacingCamera(setup: (lights: SceneLights) => void, material: Material, tint = 0xFFFFFF, firstVertexUv?: [number, number]): number[] {
    return firstVertexTotal(shadeFacingCamera(setup, material, tint, firstVertexUv));
}

const HALF = 0x808080;
const halfSpecular = 128 / 255;
const towardsFace = (lights: SceneLights) => lights.addDirectional(0, 0, 1, 1, 1, 1);
const fortyFiveDegreesOntoFace = (lights: SceneLights) => lights.addDirectional(-1, 0, 1, 1, 1, 1);

describe("VertexLighting specular and emissive", () => {
    test("a material without specular or emission shades exactly as a plain material", () => {
        const plain = shadeVertexFacingCamera(l => {
            l.addAmbient(0.1, 0.1, 0.1);
            l.addPoint(0, 0, 4, 1, 1, 1, 2);
        }, new Material("plain", WHITE_RGB));
        const glossless = shadeVertexFacingCamera(l => {
            l.addAmbient(0.1, 0.1, 0.1);
            l.addPoint(0, 0, 4, 1, 1, 1, 2);
        }, glossyMaterial(WHITE_RGB, 0, 96));
        expect(glossless).toEqual(plain);
        expect(plain).toEqual([0.663, 0.663, 0.663]);
    });

    test("the mirror direction gives the full specular color at any shininess", () => {
        for (const shininess of [1, 8, 96, 1000]) {
            const rgb = shadeVertexFacingCamera(towardsFace, glossyMaterial(BLACK_RGB, HALF, shininess));
            expect(rgb).toEqual([0.502, 0.502, 0.502]);
        }
    });

    test("off the mirror direction the highlight follows cos(angle)^shininess", () => {
        const normalDotHalf = Math.cos(Math.PI / 8);
        for (const shininess of [2, 8]) {
            const expected = Math.round(halfSpecular * Math.pow(normalDotHalf, shininess) * 1000) / 1000;
            const rgb = shadeVertexFacingCamera(fortyFiveDegreesOntoFace, glossyMaterial(BLACK_RGB, HALF, shininess));
            expect(rgb[0]).toBeCloseTo(expected, 3);
            expect(rgb[1]).toBe(rgb[0]);
            expect(rgb[2]).toBe(rgb[0]);
        }
    });

    test("a negligible highlight is skipped entirely", () => {
        expect(shadeVertexFacingCamera(fortyFiveDegreesOntoFace, glossyMaterial(BLACK_RGB, HALF, 1000))).toEqual([0, 0, 0]);
    });

    test("light from behind the face gives no highlight", () => {
        expect(shadeVertexFacingCamera(l => l.addDirectional(0, 0, -1, 1, 1, 1), glossyMaterial(BLACK_RGB, HALF, 8))).toEqual([0, 0, 0]);
    });

    test("point light highlights attenuate with the same falloff as their diffuse term", () => {
        const pointLight = (l: SceneLights) => l.addPoint(0, 0, 4, 1, 1, 1, 2);
        expect(shadeVertexFacingCamera(pointLight, glossyMaterial(WHITE_RGB, 0, 8))).toEqual([0.563, 0.563, 0.563]);
        expect(shadeVertexFacingCamera(pointLight, glossyMaterial(BLACK_RGB, WHITE_RGB, 8))).toEqual([0.563, 0.563, 0.563]);
        expect(shadeVertexFacingCamera(pointLight, glossyMaterial(WHITE_RGB, WHITE_RGB, 8))).toEqual([1.125, 1.125, 1.125]);
    });

    test("the highlight is kept apart from the diffuse and emissive light", () => {
        const shading = shadeFacingCamera(towardsFace, glossyMaterial(HALF, WHITE_RGB, 8, 0x404040));
        expect(roundedFirstVertex(shading.diffuseRgb)).toEqual([0.753, 0.753, 0.753]);
        expect(roundedFirstVertex(shading.specularRgb)).toEqual([1, 1, 1]);
    });

    test("shading reports whether any material can produce a highlight", () => {
        expect(shadeFacingCamera(towardsFace, glossyMaterial(HALF, WHITE_RGB, 8)).hasSpecular).toBe(true);
        expect(shadeFacingCamera(towardsFace, glossyMaterial(HALF, 0, 8)).hasSpecular).toBe(false);
    });

    test("specular color is tinted like the albedo", () => {
        expect(shadeVertexFacingCamera(towardsFace, glossyMaterial(BLACK_RGB, WHITE_RGB, 8), 0x0080FF)).toEqual([0, 0.502, 1]);
    });

    test("emissive adds the material color even with no lights and is tinted", () => {
        const emissive = glossyMaterial(WHITE_RGB, 0, 0, 0x404040);
        expect(shadeVertexFacingCamera(() => {}, emissive)).toEqual([0.251, 0.251, 0.251]);
        expect(shadeVertexFacingCamera(() => {}, emissive, HALF)).toEqual([0.126, 0.126, 0.126]);
        expect(shadeVertexFacingCamera(l => l.addAmbient(0.5, 0.5, 0.5), emissive)).toEqual([0.751, 0.751, 0.751]);
    });

    test("a specular texture scales the highlight by the texel at the vertex uv", () => {
        const glossMap = Texture.fromRgba(2, 1, new Uint8Array([0, 0, 0, 255, 255, 128, 0, 255]));
        const material = glossyMaterial(BLACK_RGB, WHITE_RGB, 8);
        material.specularTexture = glossMap;
        expect(shadeVertexFacingCamera(towardsFace, material, WHITE_RGB, [0.25, 0.5])).toEqual([0, 0, 0]);
        expect(shadeVertexFacingCamera(towardsFace, material, WHITE_RGB, [0.75, 0.5])).toEqual([1, 0.502, 0]);
        expect(shadeVertexFacingCamera(towardsFace, material, WHITE_RGB, [1.75, -0.5])).toEqual([1, 0.502, 0]);
    });

    test("an emissive material does not make a scene without lights count as lit", () => {
        const lights = new SceneLights();
        lights.beginGather();
        const lighting = new VertexLighting();
        lighting.beginFrame(lights, identity);
        expect(lighting.lit).toBe(false);
    });
});

const RANGE = 4;
const POINT_ABOVE = 0.563;
const POINT_ABOVE_EXACT = (1 - 4 / (RANGE * RANGE)) ** 2;
const INNER_CONE = 0.2;
const OUTER_CONE = 0.4;
const CONE_EDGE_MARGIN = 0.01;
const GLOSSY_SHININESS = 64;
const SHARP_SHININESS = 512;
const SPHERE_RADIUS = 0.6;
const TINY_SIZE = 1e-6;
const HALF_POWER = 0.5;

function spotAboveTiltedBy(angle: number, cosInner = Math.cos(INNER_CONE), cosOuter = Math.cos(OUTER_CONE)): (lights: SceneLights) => void {
    return lights => lights.addSpot(0, 0, 2, 0, Math.sin(angle), -Math.cos(angle), 1, 1, 1, RANGE, cosInner, cosOuter);
}

function alphaOf(shininess: number): number {
    return Math.sqrt(2 / (shininess + 2));
}

describe("VertexLighting spot lights", () => {
    test("inside the inner cone a spot light shades exactly like a point light at its position", () => {
        expect(shadeTriangle(spotAboveTiltedBy(0))).toEqual([POINT_ABOVE, POINT_ABOVE, POINT_ABOVE]);
        expect(shadeTriangle(spotAboveTiltedBy(INNER_CONE - CONE_EDGE_MARGIN))).toEqual([POINT_ABOVE, POINT_ABOVE, POINT_ABOVE]);
    });

    test("past the outer cone it gives nothing, and halfway between the cone cosines it gives half, smoothly", () => {
        expect(shadeTriangle(spotAboveTiltedBy(OUTER_CONE + CONE_EDGE_MARGIN))).toEqual([0, 0, 0]);
        const halfwayCos = (Math.cos(INNER_CONE) + Math.cos(OUTER_CONE)) * HALF_POWER;
        expect(shadeTriangle(spotAboveTiltedBy(Math.acos(halfwayCos)))[0]).toBeCloseTo(POINT_ABOVE_EXACT * HALF_POWER, 3);
        const justInsideOuter = shadeTriangle(spotAboveTiltedBy(OUTER_CONE - CONE_EDGE_MARGIN))[0];
        expect(justInsideOuter).toBeGreaterThan(0);
        expect(justInsideOuter).toBeLessThan(0.01);
    });

    test("equal cone cosines make a hard edge instead of dividing by zero", () => {
        const hard = Math.cos(OUTER_CONE);
        expect(shadeTriangle(spotAboveTiltedBy(OUTER_CONE - CONE_EDGE_MARGIN, hard, hard))).toEqual([POINT_ABOVE, POINT_ABOVE, POINT_ABOVE]);
        expect(shadeTriangle(spotAboveTiltedBy(OUTER_CONE + CONE_EDGE_MARGIN, hard, hard))).toEqual([0, 0, 0]);
    });

    test("distance falls off like a point light and reaches zero at the range", () => {
        expect(shadeTriangle(l => l.addSpot(0, 0, RANGE, 0, 0, -1, 1, 1, 1, RANGE, Math.cos(INNER_CONE), Math.cos(OUTER_CONE)))).toEqual([0, 0, 0]);
        expect(shadeTriangle(l => l.addSpot(0, 0, 1, 0, 0, -1, 1, 1, 1, 2, Math.cos(INNER_CONE), Math.cos(OUTER_CONE))))
            .toEqual(shadeTriangle(l => l.addPoint(0, 0, 1, 1, 1, 1, 2)));
    });
});

describe("VertexLighting sphere and tube lights", () => {
    test("shrunk to nothing, a sphere or tube light shades like a point light, highlight included", () => {
        const point = (l: SceneLights) => l.addPoint(0.3, 0.2, 1, 1, 0.9, 0.8, RANGE);
        const glossy = glossyMaterial(HALF, WHITE_RGB, GLOSSY_SHININESS);
        for (const size of [0, TINY_SIZE]) {
            const sphere = (l: SceneLights) => l.addSphere(0.3, 0.2, 1, 1, 0.9, 0.8, RANGE, size);
            const tube = (l: SceneLights) => l.addTube(0.3, 0.2, 1, 1, 0, 0, 1, 0.9, 0.8, RANGE, size, size);
            expect(shadeTriangle(sphere)).toEqual(shadeTriangle(point));
            expect(shadeTriangle(tube)).toEqual(shadeTriangle(point));
            expect(shadeVertexFacingCamera(sphere, glossy)).toEqual(shadeVertexFacingCamera(point, glossy));
            expect(shadeVertexFacingCamera(tube, glossy)).toEqual(shadeVertexFacingCamera(point, glossy));
        }
    });

    test("range is measured from the sphere's surface, so a bigger bulb reaches further", () => {
        const surfaceAt = (radius: number) => shadeTriangle(l => l.addSphere(0, 0, 2, 1, 1, 1, RANGE, radius))[0];
        expect(surfaceAt(0)).toBe(POINT_ABOVE);
        expect(surfaceAt(1)).toBeCloseTo((1 - 1 / (RANGE * RANGE)) ** 2, 3);
        expect(shadeTriangle(l => l.addSphere(0, 0, RANGE + 0.5, 1, 1, 1, RANGE, 0))).toEqual([0, 0, 0]);
        expect(shadeTriangle(l => l.addSphere(0, 0, RANGE + 0.5, 1, 1, 1, RANGE, 1))[0]).toBeGreaterThan(0);
    });

    test("seen in a mirror direction, a sphere light's peak is scaled by Karis's energy normalisation (alpha / alpha')^2", () => {
        const radius = SPHERE_RADIUS;
        const centreDistance = 4;
        const shading = shadeFacingCamera(l => l.addSphere(0, 0, 1, 1, 1, 1, 10, radius), glossyMaterial(BLACK_RGB, WHITE_RGB, GLOSSY_SHININESS));
        const alpha = alphaOf(GLOSSY_SHININESS);
        const widened = alpha + radius / (3 * centreDistance);
        const surfaceDistance = centreDistance - radius;
        const attenuation = (1 - surfaceDistance * surfaceDistance / 100) ** 2;
        expect(shading.specularRgb[0]).toBeCloseTo(attenuation * (alpha / widened) ** 2, 5);
    });

    test("a sphere light's highlight reaches angles where a point light's highlight is negligible", () => {
        const sharp = glossyMaterial(BLACK_RGB, WHITE_RGB, SHARP_SHININESS);
        expect(shadeVertexFacingCamera(l => l.addPoint(1.2, 0, 1, 1, 1, 1, 10), sharp)).toEqual([0, 0, 0]);
        expect(shadeVertexFacingCamera(l => l.addSphere(1.2, 0, 1, 1, 1, 1, 10, 1), sharp)[0]).toBeGreaterThan(0.1);
    });

    test("a tube lights a surface from the nearest point of its segment, whose length lies along the given axis", () => {
        expect(shadeTriangle(l => l.addTube(3, 0, 1, 2, 0, 0, 1, 1, 1, RANGE, 3, 0)))
            .toEqual(shadeTriangle(l => l.addPoint(0, 0, 1, 1, 1, 1, RANGE)));
        expect(shadeTriangle(l => l.addTube(3, 0, 1, 0, 2, 0, 1, 1, 1, RANGE, 3, 0)))
            .toEqual(shadeTriangle(l => l.addPoint(3, 0, 1, 1, 1, 1, RANGE)));
    });

    test("a tube's highlight streaks along it: a reflection ray crossing the tube lights up where its centre alone would not", () => {
        const sharp = glossyMaterial(BLACK_RGB, WHITE_RGB, SHARP_SHININESS);
        expect(shadeVertexFacingCamera(l => l.addPoint(1.2, 0, 1, 1, 1, 1, 10), sharp)).toEqual([0, 0, 0]);
        expect(shadeVertexFacingCamera(l => l.addTube(1.2, 0, 1, 1, 0, 0, 1, 1, 1, 10, 1.5, 0), sharp)[0]).toBeGreaterThan(0.1);
    });
});

describe("VertexLighting rect lights", () => {
    const facingDown = (l: SceneLights, halfWidth: number, halfHeight: number) =>
        l.addRect(0, 0, 2, 0, 0, -1, 1, 0, 0, 0, -1, 0, 1, 1, 1, RANGE, halfWidth, halfHeight);

    test("shrunk to nothing and seen straight on, a rect light shades like a point light, highlight included", () => {
        expect(shadeTriangle(l => facingDown(l, 0, 0))).toEqual([POINT_ABOVE, POINT_ABOVE, POINT_ABOVE]);
        expect(shadeTriangle(l => facingDown(l, TINY_SIZE, TINY_SIZE))).toEqual([POINT_ABOVE, POINT_ABOVE, POINT_ABOVE]);
        const glossy = glossyMaterial(HALF, WHITE_RGB, GLOSSY_SHININESS);
        expect(shadeVertexFacingCamera(l => l.addRect(0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 1, 1, 1, 10, 0, 0), glossy))
            .toEqual(shadeVertexFacingCamera(l => l.addPoint(0, 0, 1, 1, 1, 1, 10), glossy));
    });

    test("it is one-sided: nothing behind its plane or in it", () => {
        expect(shadeTriangle(l => l.addRect(0, 0, 2, 0, 0, 1, 1, 0, 0, 0, 1, 0, 1, 1, 1, RANGE, 1, 1))).toEqual([0, 0, 0]);
        expect(shadeTriangle(l => l.addRect(0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, RANGE, 1, 1))).toEqual([0, 0, 0]);
    });

    test("a panel seen at an angle sends less light, by the cosine at the panel", () => {
        const sixtyDegrees = Math.PI / 3;
        const tilted = shadeTriangle(l => l.addRect(0, 0, 2, 0, Math.sin(sixtyDegrees), -Math.cos(sixtyDegrees), 1, 0, 0, 0, 0, 1, 1, 1, 1, RANGE, 0, 0));
        expect(tilted[0]).toBeCloseTo(POINT_ABOVE_EXACT * Math.cos(sixtyDegrees), 3);
    });

    test("the closest point of the rectangle stands in for the whole panel", () => {
        const offToTheSide = shadeTriangle(l => l.addRect(3, 0, 2, 0, 0, -1, 1, 0, 0, 0, 1, 0, 1, 1, 1, RANGE, 1, 1))[0];
        const towardEdge = Math.SQRT1_2;
        const falloff = 1 - 8 / (RANGE * RANGE);
        expect(offToTheSide).toBeCloseTo(towardEdge * falloff * falloff * towardEdge, 3);
        expect(shadeTriangle(l => facingDown(l, 5, 5))).toEqual([POINT_ABOVE, POINT_ABOVE, POINT_ABOVE]);
    });

    test("a panel's highlight is widened and normalised in both of its directions", () => {
        const sharp = glossyMaterial(BLACK_RGB, WHITE_RGB, SHARP_SHININESS);
        expect(shadeVertexFacingCamera(l => l.addRect(1.2, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 1, 1, 1, 10, 0, 0), sharp)).toEqual([0, 0, 0]);
        expect(shadeVertexFacingCamera(l => l.addRect(1.2, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 1, 1, 1, 10, 1.5, 0.5), sharp)[0]).toBeGreaterThan(0);
    });
});

describe("VertexLighting hemisphere light", () => {
    const sky = [0.6, 0.4, 0.2];
    const ground = [0.2, 0.2, 0];
    const hemisphereWithUp = (x: number, y: number, z: number) => (l: SceneLights) => l.addHemisphere(x, y, z, sky[0], sky[1], sky[2], ground[0], ground[1], ground[2]);

    test("a normal along the up axis sees the sky, against it the ground, and across it the average", () => {
        expect(shadeTriangle(hemisphereWithUp(0, 0, 1))).toEqual(sky);
        expect(shadeTriangle(hemisphereWithUp(0, 0, -1))).toEqual(ground);
        expect(shadeTriangle(hemisphereWithUp(1, 0, 0))).toEqual([0.4, 0.3, 0.1]);
        expect(shadeTriangle(hemisphereWithUp(0, 0, 3))).toEqual(sky);
    });

    test("it adds to the ambient light rather than replacing it, and on its own still counts as lit", () => {
        expect(shadeTriangle(l => {
            l.addAmbient(0.1, 0.1, 0.1);
            hemisphereWithUp(0, 0, 1)(l);
        })).toEqual([0.7, 0.5, 0.3]);
        const lights = new SceneLights();
        lights.beginGather();
        hemisphereWithUp(0, 1, 0)(lights);
        const lighting = new VertexLighting();
        lighting.beginFrame(lights, identity);
        expect(lighting.lit).toBe(true);
    });

    test("it makes no highlight", () => {
        const shading = shadeFacingCamera(hemisphereWithUp(0, 0, -1), glossyMaterial(BLACK_RGB, WHITE_RGB, GLOSSY_SHININESS));
        expect(roundedFirstVertex(shading.specularRgb)).toEqual([0, 0, 0]);
    });

    test("the up axis turns with the camera", () => {
        const viewMatrix = LocalToWorld.fromTRS(LocalToWorld.identity(), Vec.alloc3(0, 0, 0), Vec4.alloc(0, Math.SQRT1_2, 0, Math.SQRT1_2), Vec.alloc3(1, 1, 1));
        const lights = new SceneLights();
        lights.beginGather();
        hemisphereWithUp(-1, 0, 0)(lights);
        const lighting = new VertexLighting();
        lighting.beginFrame(lights, viewMatrix);
        const viewMesh = new ViewSpaceMesh().transformFrom(triangleFacingPlusZ(), new Float32Array(identityMatrix), identityNormalMatrix);
        expect(roundedFirstVertex(lighting.shade(viewMesh, WHITE_RGB).diffuseRgb)).toEqual(sky);
    });
});
