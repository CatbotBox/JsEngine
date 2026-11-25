import {describe, expect, test} from "../../engine/testing/harness";
import {asFloat32Array, Vec} from "../../engine/math/types/vec";
import {Quaternions} from "../../engine/math/quaternions";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import {BASIS_FLOATS, writeLightBasis} from "./gpuShadowFit";
import {
    CUBE_FACE_BASES,
    CUBE_FACE_NEGATIVE_X,
    CUBE_FACE_NEGATIVE_Y,
    CUBE_FACE_NEGATIVE_Z,
    CUBE_FACE_POSITIVE_X,
    CUBE_FACE_POSITIVE_Y,
    CUBE_FACE_POSITIVE_Z,
    GpuShadowCube,
    GpuShadowFrustum,
} from "./gpuShadowFrustum";
import {CUBE_FACES} from "./gpuShadowSettings";

type Vec4 = [number, number, number, number];

const DIGITS = 4;
const ORIGIN: readonly [number, number, number] = [1, 3, -2];
const TAN_HALF = 0.5;
const NEAR = 0.2;
const FAR = 10;
const MAP_SIZE = 256;
const ALONG_AXIS = 4;
const HALF_BOX = 0.25;
const CORNER_HALF_BOX = 1.5;
const SAMPLE_SPREAD = 0.6;
const RANDOM_DIRECTIONS = 200;
const SEED = 12345;
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const LCG_MODULUS = 2 ** 32;
const CAMERA_TURN = 0.7;

function project(m: Float32Array, x: number, y: number, z: number): Vec4 {
    return [0, 1, 2, 3].map(row => m[row] * x + m[4 + row] * y + m[8 + row] * z + m[12 + row]) as Vec4;
}

function ndcOf(clip: Vec4): [number, number, number] {
    return [clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]];
}

function webGpuCubeLookup(x: number, y: number, z: number): {face: number, s: number, t: number, major: number} {
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    let face: number, sc: number, tc: number, ma: number;
    if (ax >= ay && ax >= az) {
        [face, sc, tc, ma] = x > 0 ? [CUBE_FACE_POSITIVE_X, -z, -y, ax] : [CUBE_FACE_NEGATIVE_X, z, -y, ax];
    } else if (ay >= az) {
        [face, sc, tc, ma] = y > 0 ? [CUBE_FACE_POSITIVE_Y, x, z, ay] : [CUBE_FACE_NEGATIVE_Y, x, -z, ay];
    } else {
        [face, sc, tc, ma] = z > 0 ? [CUBE_FACE_POSITIVE_Z, x, -y, az] : [CUBE_FACE_NEGATIVE_Z, -x, -y, az];
    }
    return {face, s: (sc / ma + 1) / 2, t: (tc / ma + 1) / 2, major: ma};
}

function renderedTexelOf(clip: Vec4): {s: number, t: number} {
    const [x, y] = ndcOf(clip);
    return {s: (x + 1) / 2, t: (1 - y) / 2};
}

function randomDirections(count: number): [number, number, number][] {
    let state = SEED;
    const next = () => {
        state = (state * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS;
        return state / LCG_MODULUS * 2 - 1;
    };
    return Array.from({length: count}, () => [next(), next(), next()]);
}

function spotFrustum(forward: [number, number, number] = [0, -1, 0]): GpuShadowFrustum {
    const basis = new Float64Array(BASIS_FLOATS);
    writeLightBasis(basis, ...forward);
    const frustum = new GpuShadowFrustum();
    frustum.aim(ORIGIN[0], ORIGIN[1], ORIGIN[2], basis, TAN_HALF, NEAR, FAR, MAP_SIZE);
    return frustum;
}

function boxAt(caster: {acceptsCaster(xMin: number, yMin: number, zMin: number, xMax: number, yMax: number, zMax: number): boolean}, x: number, y: number, z: number, half: number = HALF_BOX): boolean {
    return caster.acceptsCaster(x - half, y - half, z - half, x + half, y + half, z + half);
}

describe("spot shadow frustum", () => {
    test("the axis projects to the map centre, the cone's edge to the map edge, and depth runs 0 at near to 1 at far", () => {
        const frustum = spotFrustum();
        const basis = new Float64Array(BASIS_FLOATS);
        writeLightBasis(basis, 0, -1, 0);
        const m = frustum.worldToLightClip;
        const onAxis = ndcOf(project(m, ORIGIN[0], ORIGIN[1] - ALONG_AXIS, ORIGIN[2]));
        expect(onAxis[0]).toBeCloseTo(0, DIGITS);
        expect(onAxis[1]).toBeCloseTo(0, DIGITS);
        expect(onAxis[2]).toBeCloseTo(frustum.depthScale + frustum.depthOffset / ALONG_AXIS, DIGITS);
        const right = ndcOf(project(m, ORIGIN[0] + basis[0] * TAN_HALF * ALONG_AXIS, ORIGIN[1] - ALONG_AXIS + basis[1] * TAN_HALF * ALONG_AXIS, ORIGIN[2] + basis[2] * TAN_HALF * ALONG_AXIS));
        expect(right[0]).toBeCloseTo(1, DIGITS);
        expect(right[1]).toBeCloseTo(0, DIGITS);
        const up = ndcOf(project(m, ORIGIN[0] + basis[3] * TAN_HALF * ALONG_AXIS, ORIGIN[1] - ALONG_AXIS + basis[4] * TAN_HALF * ALONG_AXIS, ORIGIN[2] + basis[5] * TAN_HALF * ALONG_AXIS));
        expect(up[0]).toBeCloseTo(0, DIGITS);
        expect(up[1]).toBeCloseTo(1, DIGITS);
        expect(ndcOf(project(m, ORIGIN[0], ORIGIN[1] - NEAR, ORIGIN[2]))[2]).toBeCloseTo(0, DIGITS);
        expect(ndcOf(project(m, ORIGIN[0], ORIGIN[1] - FAR, ORIGIN[2]))[2]).toBeCloseTo(1, DIGITS);
        expect(project(m, ORIGIN[0], ORIGIN[1] - ALONG_AXIS, ORIGIN[2])[3]).toBeCloseTo(ALONG_AXIS, DIGITS);
        expect(frustum.texelSpread).toBeCloseTo(2 * TAN_HALF / MAP_SIZE, DIGITS);
    });

    test("the view-to-light matrix is the world-to-light matrix after the camera", () => {
        const frustum = spotFrustum();
        const camera = LocalToWorld.fromTRS(LocalToWorld.identity(), Vec.alloc3(2, 1, -6), Quaternions.eulerToQuat(Vec.alloc3(0, CAMERA_TURN, 0)), Vec.alloc3(1, 1, 1));
        const cameraMatrix = asFloat32Array(camera);
        frustum.finishView(new Float64Array(cameraMatrix));
        const viewPoint: [number, number, number] = [0.5, -1, 3];
        const world = project(cameraMatrix, ...viewPoint);
        const direct = project(frustum.worldToLightClip, world[0], world[1], world[2]);
        const viaView = project(frustum.viewToLightClip, ...viewPoint);
        direct.forEach((value, i) => expect(viaView[i]).toBeCloseTo(value, DIGITS));
    });

    test("casters are kept inside the cone and range and dropped behind the light, beside the cone or past its range, with a footprint that grows up close", () => {
        const frustum = spotFrustum();
        expect(boxAt(frustum, ORIGIN[0], ORIGIN[1] - ALONG_AXIS, ORIGIN[2])).toBe(true);
        const far = frustum.casterWidthTexels;
        expect(boxAt(frustum, ORIGIN[0], ORIGIN[1] - 1, ORIGIN[2])).toBe(true);
        expect(frustum.casterWidthTexels).toBeGreaterThan(far);
        expect(boxAt(frustum, ORIGIN[0], ORIGIN[1] + ALONG_AXIS, ORIGIN[2])).toBe(false);
        expect(boxAt(frustum, ORIGIN[0] + ALONG_AXIS, ORIGIN[1] - 1, ORIGIN[2])).toBe(false);
        expect(boxAt(frustum, ORIGIN[0], ORIGIN[1] - FAR - 1, ORIGIN[2])).toBe(false);
        expect(boxAt(frustum, ORIGIN[0] + FAR * TAN_HALF * 0.9, ORIGIN[1] - FAR * 0.95, ORIGIN[2])).toBe(false);
        expect(boxAt(frustum, ORIGIN[0], ORIGIN[1], ORIGIN[2], ALONG_AXIS)).toBe(true);
    });
});

describe("point shadow cube", () => {
    test("each face's matrix stores a direction at the texel WebGPU's cube lookup reads for it", () => {
        const cube = new GpuShadowCube();
        cube.aim(ORIGIN[0], ORIGIN[1], ORIGIN[2], NEAR, FAR, MAP_SIZE);
        const faceSamples: [number, number, number][] = [
            [1, SAMPLE_SPREAD, -SAMPLE_SPREAD / 2], [-1, -SAMPLE_SPREAD, SAMPLE_SPREAD / 2],
            [SAMPLE_SPREAD / 2, 1, -SAMPLE_SPREAD], [-SAMPLE_SPREAD, -1, SAMPLE_SPREAD / 2],
            [SAMPLE_SPREAD, -SAMPLE_SPREAD / 2, 1], [-SAMPLE_SPREAD / 2, SAMPLE_SPREAD, -1],
        ];
        faceSamples.forEach((direction, face) => {
            const lookup = webGpuCubeLookup(...direction);
            expect(lookup.face).toBe(face);
            const clip = project(cube.faces[face].worldToLightClip, ORIGIN[0] + direction[0], ORIGIN[1] + direction[1], ORIGIN[2] + direction[2]);
            const texel = renderedTexelOf(clip);
            expect(texel.s).toBeCloseTo(lookup.s, DIGITS);
            expect(texel.t).toBeCloseTo(lookup.t, DIGITS);
            expect(clip[3]).toBeCloseTo(lookup.major, DIGITS);
        });
    });

    test("faces follow WebGPU's layer order +X -X +Y -Y +Z -Z, look along their axis, and every direction lands in exactly the face the lookup picks", () => {
        expect([CUBE_FACE_POSITIVE_X, CUBE_FACE_NEGATIVE_X, CUBE_FACE_POSITIVE_Y, CUBE_FACE_NEGATIVE_Y, CUBE_FACE_POSITIVE_Z, CUBE_FACE_NEGATIVE_Z]).toEqual([0, 1, 2, 3, 4, 5]);
        expect(CUBE_FACE_BASES.map(basis => basis.slice(6, 9))).toEqual([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]);
        const cube = new GpuShadowCube();
        cube.aim(ORIGIN[0], ORIGIN[1], ORIGIN[2], NEAR, FAR, MAP_SIZE);
        for (const direction of randomDirections(RANDOM_DIRECTIONS)) {
            const point: [number, number, number] = [ORIGIN[0] + direction[0], ORIGIN[1] + direction[1], ORIGIN[2] + direction[2]];
            const covering = cube.faces.map((face, index) => ({index, clip: project(face.worldToLightClip, ...point)}))
                .filter(({clip}) => clip[3] > 0 && Math.abs(clip[0]) < clip[3] && Math.abs(clip[1]) < clip[3])
                .map(({index}) => index);
            expect(covering).toEqual([webGpuCubeLookup(...direction).face]);
        }
        expect(cube.faces.length).toBe(CUBE_FACES);
    });

    test("depth along each face matches the shader's major-axis depth, and the view-to-offset matrix takes view points to world offsets from the light", () => {
        const cube = new GpuShadowCube();
        cube.aim(ORIGIN[0], ORIGIN[1], ORIGIN[2], NEAR, FAR, MAP_SIZE);
        for (const direction of randomDirections(RANDOM_DIRECTIONS)) {
            const lookup = webGpuCubeLookup(...direction);
            const scaled: [number, number, number] = [direction[0] * ALONG_AXIS, direction[1] * ALONG_AXIS, direction[2] * ALONG_AXIS];
            const clip = project(cube.faces[lookup.face].worldToLightClip, ORIGIN[0] + scaled[0], ORIGIN[1] + scaled[1], ORIGIN[2] + scaled[2]);
            expect(clip[2] / clip[3]).toBeCloseTo(cube.depthScale + cube.depthOffset / (lookup.major * ALONG_AXIS), DIGITS);
        }
        const camera = asFloat32Array(LocalToWorld.fromTRS(LocalToWorld.identity(), Vec.alloc3(2, 1, -6), Quaternions.eulerToQuat(Vec.alloc3(0, CAMERA_TURN, 0)), Vec.alloc3(1, 1, 1)));
        cube.finishView(new Float64Array(camera));
        const viewPoint: [number, number, number] = [0.5, -1, 3];
        const world = project(camera, ...viewPoint);
        const offset = project(cube.viewToLightOffset, ...viewPoint);
        expect(offset[0]).toBeCloseTo(world[0] - ORIGIN[0], DIGITS);
        expect(offset[1]).toBeCloseTo(world[1] - ORIGIN[1], DIGITS);
        expect(offset[2]).toBeCloseTo(world[2] - ORIGIN[2], DIGITS);
        expect(offset[3]).toBeCloseTo(1, DIGITS);
        expect(cube.texelSpread).toBeCloseTo(2 / MAP_SIZE, DIGITS);
    });

    test("casters are kept by the faces that see them, dropped past the light's reach, and dropped behind a rect light's emitter", () => {
        const cube = new GpuShadowCube();
        cube.aim(ORIGIN[0], ORIGIN[1], ORIGIN[2], NEAR, FAR, MAP_SIZE);
        const below = cube.faces.map(face => boxAt(face, ORIGIN[0], ORIGIN[1] - ALONG_AXIS, ORIGIN[2]));
        expect(below).toEqual([false, false, false, true, false, false]);
        const corner = cube.faces.map(face => boxAt(face, ORIGIN[0] + ALONG_AXIS, ORIGIN[1] + ALONG_AXIS, ORIGIN[2], CORNER_HALF_BOX));
        expect(corner).toEqual([true, false, true, false, false, false]);
        expect(cube.faces.some(face => boxAt(face, ORIGIN[0] + FAR, ORIGIN[1] + FAR, ORIGIN[2]))).toBe(false);
        cube.cullBehind(0, -1, 0);
        expect(cube.faces.some(face => boxAt(face, ORIGIN[0], ORIGIN[1] + ALONG_AXIS, ORIGIN[2]))).toBe(false);
        expect(boxAt(cube.faces[CUBE_FACE_NEGATIVE_Y], ORIGIN[0], ORIGIN[1] - ALONG_AXIS, ORIGIN[2])).toBe(true);
        cube.aim(ORIGIN[0], ORIGIN[1], ORIGIN[2], NEAR, FAR, MAP_SIZE);
        expect(boxAt(cube.faces[CUBE_FACE_POSITIVE_Y], ORIGIN[0], ORIGIN[1] + ALONG_AXIS, ORIGIN[2])).toBe(true);
    });
});
