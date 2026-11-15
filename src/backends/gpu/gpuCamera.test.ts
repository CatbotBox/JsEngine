import {describe, expect, test} from "../../engine/testing/harness";
import {LocalToWorld} from "../../engine/translation";
import {asFloat32Array} from "../../engine/math/types/vec";
import {MAT4_TRANSLATION_Z} from "../../engine/math/mat4Layout";
import {NEAR_PLANE_Z} from "../../engine/rendering/3d/software/meshRasterizer";
import {FRAME_UNIFORM_FLOATS, frameProjectionMatrix, frameViewMatrix, writeFrameUniforms} from "./gpuCamera";
import {SOFTWARE_FRONT_FACE} from "./gpuPipelineCache";

const WIDTH = 320, HEIGHT = 200;
const FOV = Math.PI / 3;
const SQUARE = 1;
const TALL_PIXELS = 2;
const DEPTH_RANGE = 50;
const DIGITS = 4;
const CAMERA_BEHIND_ORIGIN_Z = -4;

interface Projected {
    readonly sx: number;
    readonly sy: number;
    readonly depth: number;
    readonly ndcX: number;
    readonly ndcY: number;
}

function transform(m: Float32Array, x: number, y: number, z: number, w: number): [number, number, number, number] {
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12] * w,
        m[1] * x + m[5] * y + m[9] * z + m[13] * w,
        m[2] * x + m[6] * y + m[10] * z + m[14] * w,
        m[3] * x + m[7] * y + m[11] * z + m[15] * w,
    ];
}

function project(uniforms: Float32Array, x: number, y: number, z: number): Projected {
    const view = transform(frameViewMatrix(uniforms), x, y, z, 1);
    const clip = transform(frameProjectionMatrix(uniforms), ...view);
    const ndcX = clip[0] / clip[3], ndcY = clip[1] / clip[3];
    return {sx: (ndcX + 1) * WIDTH / 2, sy: (1 - ndcY) * HEIGHT / 2, depth: clip[2] / clip[3], ndcX, ndcY};
}

function uniformsFor(fov: number | undefined, pixelHeightPerWidth: number, camera = LocalToWorld.identity()): Float32Array {
    const uniforms = new Float32Array(FRAME_UNIFORM_FLOATS);
    writeFrameUniforms(uniforms, camera, fov, WIDTH, HEIGHT, pixelHeightPerWidth, DEPTH_RANGE);
    return uniforms;
}

function softwarePerspective(x: number, y: number, z: number, pixelHeightPerWidth: number): {sx: number, sy: number} {
    const focalLength = HEIGHT / (Math.tan(FOV / 2) * 2);
    return {sx: WIDTH / 2 + x * focalLength / z * pixelHeightPerWidth, sy: HEIGHT / 2 - y * focalLength / z};
}

const POINTS: readonly [number, number, number][] = [[0, 0, 4], [1, 0.5, 3], [-2, 1.5, 7], [0.25, -1, 0.5]];

describe("writeFrameUniforms", () => {
    test("perspective lands every point on the software rasterizer's pixel, square and tall pixels, non-square raster", () => {
        for (const pixelHeightPerWidth of [SQUARE, TALL_PIXELS]) {
            const uniforms = uniformsFor(FOV, pixelHeightPerWidth);
            for (const [x, y, z] of POINTS) {
                const gpu = project(uniforms, x, y, z);
                const software = softwarePerspective(x, y, z, pixelHeightPerWidth);
                expect(gpu.sx).toBeCloseTo(software.sx, DIGITS);
                expect(gpu.sy).toBeCloseTo(software.sy, DIGITS);
            }
        }
    });

    test("orthographic (no field of view) is one unit per raster pixel around the centre", () => {
        for (const pixelHeightPerWidth of [SQUARE, TALL_PIXELS]) {
            const uniforms = uniformsFor(undefined, pixelHeightPerWidth);
            for (const [x, y, z] of POINTS) {
                const gpu = project(uniforms, x, y, z);
                expect(gpu.sx).toBeCloseTo(WIDTH / 2 + x * pixelHeightPerWidth, DIGITS);
                expect(gpu.sy).toBeCloseTo(HEIGHT / 2 - y, DIGITS);
                expect(gpu.depth).toBeCloseTo(1 - z / DEPTH_RANGE, DIGITS);
            }
        }
    });

    test("reversed infinite depth: 1 at the near plane, falling towards 0 with distance, never below it", () => {
        const uniforms = uniformsFor(FOV, SQUARE);
        expect(project(uniforms, 0, 0, NEAR_PLANE_Z).depth).toBeCloseTo(1, DIGITS);
        const depths = [1, 10, 100, 10_000].map(z => project(uniforms, 0, 0, z).depth);
        for (let i = 1; i < depths.length; i++) expect(depths[i]).toBeLessThan(depths[i - 1]);
        expect(depths[depths.length - 1]).toBeGreaterThan(0);
        expect(project(uniforms, 0, 0, NEAR_PLANE_Z / 2).depth).toBeGreaterThan(1);
    });

    test("the view is the inverse of the camera's transform", () => {
        const camera = LocalToWorld.identity();
        asFloat32Array(camera)[MAT4_TRANSLATION_Z] = CAMERA_BEHIND_ORIGIN_Z;
        const uniforms = uniformsFor(FOV, SQUARE, camera);
        const viewOrigin = transform(frameViewMatrix(uniforms), 0, 0, 0, 1);
        expect(viewOrigin).toEqual([0, 0, -CAMERA_BEHIND_ORIGIN_Z, 1]);
    });

    test("a triangle the software rasterizer treats as front-facing is clockwise in NDC, so the pipelines use frontFace cw", () => {
        const uniforms = uniformsFor(FOV, SQUARE);
        const corners = [[-1, -1, 4], [1, 1, 4], [1, -1, 4]].map(([x, y, z]) => project(uniforms, x, y, z));
        const [a, b, c] = corners;
        const softwareArea2 = (c.sx - a.sx) * (b.sy - a.sy) - (c.sy - a.sy) * (b.sx - a.sx);
        expect(softwareArea2).toBeLessThan(0);
        const ndcSignedArea = (a.ndcX * b.ndcY - b.ndcX * a.ndcY) + (b.ndcX * c.ndcY - c.ndcX * b.ndcY) + (c.ndcX * a.ndcY - a.ndcX * c.ndcY);
        expect(ndcSignedArea).toBeLessThan(0);
        expect(SOFTWARE_FRONT_FACE).toBe("cw");
    });
});
