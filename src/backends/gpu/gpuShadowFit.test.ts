import {describe, expect, test} from "../../engine/testing/harness";
import {asFloat32Array, Vec} from "../../engine/math/types/vec";
import {Quaternions} from "../../engine/math/quaternions";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import {NEAR_PLANE_Z} from "../../engine/rendering/3d/software/meshRasterizer";
import {GpuShadowFit} from "./gpuShadowFit";
import type {GpuShadowView} from "./gpuShadowFit";

type Xyz = readonly [number, number, number];

const WIDTH = 64, HEIGHT = 48;
const FOV = Math.PI / 3;
const SQUARE = 1;
const DEPTH_RANGE = 1000;
const MAX_DISTANCE = 30;
const MAP_SIZE = 1024;
const SUN: Xyz = [-0.4, -0.8, 0.45];
const STRAIGHT_DOWN: Xyz = [0, -1, 0];
const UNIT_SCALE: Xyz = [1, 1, 1];
const NO_TURN: Xyz = [0, 0, 0];
const POSE_POSITION: Xyz = [3.25, 1.5, -7.75];
const POSE_TURN: Xyz = [0.3, -0.6, 0.1];
const NDC_EPSILON = 1e-4;
const TEXEL_EPSILON = 2e-3;
const SUB_TEXEL_FRACTION = 0.37;
const HALF = 0.5;
const UNBOUNDED = true;
const BOUNDED_ONLY = false;
const NO_EXTENT = 0;
const CASTER_HALF_SIZE = 0.5;
const ORTHOGRAPHIC_DISTANCE = 20;
const ORTHOGRAPHIC_WIDTH = 40, ORTHOGRAPHIC_HEIGHT = 30;
const WORLD_POINTS: readonly Xyz[] = [[0, 0, 5], [4.5, -2.25, 11], [-6, 1, 20.5], [1.75, 3.5, 2]];

function camera(position: Xyz = NO_TURN, turn: Xyz = NO_TURN, scale: Xyz = UNIT_SCALE): Float32Array {
    return asFloat32Array(LocalToWorld.fromTRS(LocalToWorld.identity(), Vec.alloc3(...position), Quaternions.eulerToQuat(Vec.alloc3(...turn)), Vec.alloc3(...scale)));
}

function perspectiveView(cameraMatrix: Float32Array): GpuShadowView {
    return {cameraMatrix, fieldOfViewRadians: FOV, widthPx: WIDTH, heightPx: HEIGHT, pixelHeightPerWidth: SQUARE, orthographicDepthRange: DEPTH_RANGE};
}

function orthographicView(cameraMatrix: Float32Array): GpuShadowView {
    return {cameraMatrix, fieldOfViewRadians: undefined, widthPx: ORTHOGRAPHIC_WIDTH, heightPx: ORTHOGRAPHIC_HEIGHT, pixelHeightPerWidth: SQUARE, orthographicDepthRange: ORTHOGRAPHIC_DISTANCE};
}

function transform(m: ArrayLike<number>, [x, y, z]: Xyz): Xyz {
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
    ];
}

function fitted(view: GpuShadowView, direction: Xyz = SUN, withUnboundedCasters: boolean = BOUNDED_ONLY): GpuShadowFit {
    const fit = new GpuShadowFit();
    expect(fit.fit(view, MAX_DISTANCE, MAP_SIZE, ...direction)).toBe(true);
    fit.finish(withUnboundedCasters);
    return fit;
}

function perspectiveSliceCorners(): Xyz[] {
    const tanY = Math.tan(FOV / 2), tanX = tanY * WIDTH / HEIGHT;
    const corners: Xyz[] = [];
    for (const depth of [NEAR_PLANE_Z, MAX_DISTANCE]) {
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) corners.push([sx * tanX * depth, sy * tanY * depth, depth]);
    }
    return corners;
}

function orthographicBoxCorners(): Xyz[] {
    const corners: Xyz[] = [];
    for (const depth of [0, ORTHOGRAPHIC_DISTANCE]) {
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) corners.push([sx * ORTHOGRAPHIC_WIDTH / 2, sy * ORTHOGRAPHIC_HEIGHT / 2, depth]);
    }
    return corners;
}

function expectInsideLightClip([x, y, z]: Xyz): void {
    expect(Math.abs(x)).not.toBeGreaterThan(1 + NDC_EPSILON);
    expect(Math.abs(y)).not.toBeGreaterThan(1 + NDC_EPSILON);
    expect(z).not.toBeLessThan(-NDC_EPSILON);
    expect(z).not.toBeGreaterThan(1 + NDC_EPSILON);
}

function texelOf(fit: GpuShadowFit, point: Xyz): [number, number] {
    const [x, y] = transform(fit.worldToLightClip, point);
    return [(x * HALF + HALF) * MAP_SIZE, (HALF - y * HALF) * MAP_SIZE];
}

function expectWholeTexelShift(before: GpuShadowFit, after: GpuShadowFit): void {
    for (const point of WORLD_POINTS) {
        const [u0, v0] = texelOf(before, point), [u1, v1] = texelOf(after, point);
        expect(Math.abs(u1 - u0 - Math.round(u1 - u0))).toBeLessThan(TEXEL_EPSILON);
        expect(Math.abs(v1 - v0 - Math.round(v1 - v0))).toBeLessThan(TEXEL_EPSILON);
    }
}

function boxAround([x, y, z]: Xyz, half: number): [number, number, number, number, number, number] {
    return [x - half, y - half, z - half, x + half, y + half, z + half];
}

describe("GpuShadowFit", () => {
    test("the light box holds every corner of the perspective frustum slice out to maxDistance, from a turned and moved camera", () => {
        const cameraMatrix = camera(POSE_POSITION, POSE_TURN);
        const fit = fitted(perspectiveView(cameraMatrix));
        for (const corner of perspectiveSliceCorners()) {
            const world = transform(cameraMatrix, corner);
            expectInsideLightClip(transform(fit.worldToLightClip, world));
            const fromView = transform(fit.viewToLightClip, corner), fromWorld = transform(fit.worldToLightClip, world);
            for (let axis = 0; axis < 3; axis++) expect(fromView[axis]).toBeCloseTo(fromWorld[axis], 4);
        }
        expect(fit.sliceFarViewDepth).toBe(MAX_DISTANCE);
        expect(fit.texelWorldSize).toBeCloseTo(2 * fit.halfExtent / MAP_SIZE, 9);
    });

    test("an orthographic camera fits its view box, cut at the nearer of its depth range and maxDistance", () => {
        const cameraMatrix = camera(POSE_POSITION, POSE_TURN);
        const fit = fitted(orthographicView(cameraMatrix));
        for (const corner of orthographicBoxCorners()) expectInsideLightClip(transform(fit.worldToLightClip, transform(cameraMatrix, corner)));
        expect(fit.sliceFarViewDepth).toBe(Math.min(ORTHOGRAPHIC_DISTANCE, MAX_DISTANCE));
    });

    test("a caster behind the camera, between the light and the view, is accepted and moves the near plane back to hold it", () => {
        const fit = new GpuShadowFit();
        expect(fit.fit(perspectiveView(camera()), MAX_DISTANCE, MAP_SIZE, 0, -0.5, 1)).toBe(true);
        const sphereNear = fit.nearZ;
        const behindAndAbove: Xyz = [0, 4, -6];
        expect(fit.acceptsCaster(...boxAround(behindAndAbove, CASTER_HALF_SIZE))).toBe(true);
        expect(fit.nearZ).toBeLessThan(sphereNear);
        fit.finish(BOUNDED_ONLY);
        const [xMin, yMin, zMin, xMax, yMax, zMax] = boxAround(behindAndAbove, CASTER_HALF_SIZE);
        for (const x of [xMin, xMax]) for (const y of [yMin, yMax]) for (const z of [zMin, zMax]) {
            const [, , depth] = transform(fit.worldToLightClip, [x, y, z]);
            expect(depth).not.toBeLessThan(0);
            expect(depth).not.toBeGreaterThan(1);
        }
    });

    test("casters beside the light box or beyond its far side are rejected and leave the near plane alone", () => {
        const fit = new GpuShadowFit();
        expect(fit.fit(perspectiveView(camera()), MAX_DISTANCE, MAP_SIZE, ...STRAIGHT_DOWN)).toBe(true);
        const near = fit.nearZ;
        expect(fit.acceptsCaster(...boxAround([500, 0, 10], CASTER_HALF_SIZE))).toBe(false);
        expect(fit.acceptsCaster(...boxAround([0, -500, 10], CASTER_HALF_SIZE))).toBe(false);
        expect(fit.nearZ).toBe(near);
        expect(fit.acceptsCaster(...boxAround([0, 500, 10], CASTER_HALF_SIZE))).toBe(true);
        expect(fit.nearZ).toBeLessThan(near);
    });

    test("an accepted caster reports its light-space footprint in shadow-map texels for LOD selection", () => {
        const fit = new GpuShadowFit();
        expect(fit.fit(perspectiveView(camera()), MAX_DISTANCE, MAP_SIZE, ...STRAIGHT_DOWN)).toBe(true);
        expect(fit.acceptsCaster(...boxAround([0, 0, 10], CASTER_HALF_SIZE))).toBe(true);
        expect(fit.casterWidthTexels).toBeCloseTo(2 * CASTER_HALF_SIZE / fit.texelWorldSize, 6);
        expect(fit.casterHeightTexels).toBeCloseTo(2 * CASTER_HALF_SIZE / fit.texelWorldSize, 6);
        expect(fit.acceptsCaster(0, 0, 10, 0, 0, 10)).toBe(true);
        expect([fit.casterWidthTexels, fit.casterHeightTexels]).toEqual([NO_EXTENT, NO_EXTENT]);
    });

    test("texel snapping: a sub-texel camera move shifts every world point by whole shadow-map texels", () => {
        const reference = fitted(perspectiveView(camera(POSE_POSITION, POSE_TURN)));
        const texel = reference.texelWorldSize;
        for (const axis of [0, 1, 2]) {
            const moved: [number, number, number] = [...POSE_POSITION];
            moved[axis] += texel * SUB_TEXEL_FRACTION;
            const after = fitted(perspectiveView(camera(moved, POSE_TURN)));
            expect(after.texelWorldSize).toBe(texel);
            expectWholeTexelShift(reference, after);
        }
    });

    test("turning the camera keeps the texel size and the texel grid, so shadows do not shimmer", () => {
        const reference = fitted(perspectiveView(camera(POSE_POSITION, POSE_TURN)));
        const turned = fitted(perspectiveView(camera(POSE_POSITION, [POSE_TURN[0] + 0.05, POSE_TURN[1] - 0.3, POSE_TURN[2]])));
        expect(turned.texelWorldSize).toBe(reference.texelWorldSize);
        expectWholeTexelShift(reference, turned);
    });

    test("unbounded casters push the near plane back by a radius, since their extent is unknown", () => {
        const bounded = fitted(perspectiveView(camera()), SUN, BOUNDED_ONLY);
        const unbounded = fitted(perspectiveView(camera()), SUN, UNBOUNDED);
        expect(bounded.nearZ - unbounded.nearZ).toBeCloseTo(bounded.radius, 6);
        expect(unbounded.farZ).toBe(bounded.farZ);
    });

    test("a light straight down still gets a valid basis", () => {
        const fit = fitted(perspectiveView(camera()), STRAIGHT_DOWN);
        expect(fit.worldToLightClip.every(Number.isFinite)).toBe(true);
        for (const corner of perspectiveSliceCorners()) expectInsideLightClip(transform(fit.worldToLightClip, corner));
    });

    test("a scaled camera fits a sphere scaled by its largest axis and offsets normals in view units", () => {
        const scale: Xyz = [2, 2, 2];
        const cameraMatrix = camera(POSE_POSITION, POSE_TURN, scale);
        const fit = fitted(perspectiveView(cameraMatrix));
        expect(fit.viewUnitsPerWorldUnit).toBeCloseTo(1 / scale[0], 6);
        for (const corner of perspectiveSliceCorners()) expectInsideLightClip(transform(fit.worldToLightClip, transform(cameraMatrix, corner)));
    });

    test("nothing is fitted for a zero light direction, a maxDistance inside the near plane, a non-finite one, or a map too small to snap", () => {
        const view = perspectiveView(camera());
        const fit = new GpuShadowFit();
        expect(fit.fit(view, MAX_DISTANCE, MAP_SIZE, 0, 0, 0)).toBe(false);
        expect(fit.fit(view, NEAR_PLANE_Z / 2, MAP_SIZE, ...SUN)).toBe(false);
        expect(fit.fit(view, Number.POSITIVE_INFINITY, MAP_SIZE, ...SUN)).toBe(false);
        expect(fit.fit(view, Number.NaN, MAP_SIZE, ...SUN)).toBe(false);
        expect(fit.fit(view, MAX_DISTANCE, 2, ...SUN)).toBe(false);
        expect(fit.fit({...view, heightPx: 0}, MAX_DISTANCE, MAP_SIZE, ...SUN)).toBe(false);
    });
});
