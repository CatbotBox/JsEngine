import {describe, expect, test} from "../../engine/testing/harness";
import {
    AXIS_X,
    AXIS_Y,
    DEFAULT_PIVOT_DISTANCE,
    dollyCamera,
    flyCamera,
    focusCamera2d,
    focusOrbitCamera,
    forwardOf,
    lookAround,
    MAX_PITCH_DEGREES,
    MIN_CAMERA_DISTANCE,
    orbitAroundPivot,
    orbitCameraFromPose,
    ORBIT_DEGREES_PER_PIXEL,
    panCamera2d,
    panOrbitCamera,
    poseOfOrbitCamera,
    quaternionFromAxisAngle,
    rotateVector,
    unionOfBounds,
    yawPitchRotation,
} from "./editorCameraMath";
import type {OrbitCamera, Vector3} from "./editorCameraMath";

const DIGITS = 5;

function expectVector(actual: Vector3, expected: Vector3): void {
    actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], DIGITS));
}

const LOOKING_ALONG_Z: OrbitCamera = {pivot: [0, 0, 0], yawDegrees: 0, pitchDegrees: 0, distance: 10};

describe("editor camera rotation conventions", () => {
    test("the camera looks along local +Z; positive yaw turns right and positive pitch looks down", () => {
        expectVector(forwardOf(yawPitchRotation(0, 0)), [0, 0, 1]);
        expectVector(forwardOf(yawPitchRotation(90, 0)), [1, 0, 0]);
        expectVector(forwardOf(yawPitchRotation(0, 90)), [0, -1, 0]);
    });

    test("rotating a vector matches the axis-angle rotation", () => {
        expectVector(rotateVector(quaternionFromAxisAngle(AXIS_Y, Math.PI / 2), AXIS_X), [0, 0, -1]);
    });
});

describe("orbit camera", () => {
    test("a pose round-trips through the orbit camera when it has no roll", () => {
        const pose = poseOfOrbitCamera({pivot: [1, 2, 3], yawDegrees: 30, pitchDegrees: -20, distance: 5});
        const camera = orbitCameraFromPose(pose, 5);
        expect(camera.yawDegrees).toBeCloseTo(30, DIGITS);
        expect(camera.pitchDegrees).toBeCloseTo(-20, DIGITS);
        expectVector(camera.pivot, [1, 2, 3]);
        expectVector(poseOfOrbitCamera(camera).position, pose.position);
    });

    test("a pose starts its pivot the default distance in front of the camera", () => {
        const camera = orbitCameraFromPose({position: [0, 0, -10], rotation: [0, 0, 0, 1]});
        expectVector(camera.pivot, [0, 0, -10 + DEFAULT_PIVOT_DISTANCE]);
        expect(camera.distance).toBe(DEFAULT_PIVOT_DISTANCE);
    });

    test("orbiting keeps the pivot and distance, turning by the drag and clamping the pitch", () => {
        const turned = orbitAroundPivot(LOOKING_ALONG_Z, 100, 0);
        expect(turned.yawDegrees).toBeCloseTo(100 * ORBIT_DEGREES_PER_PIXEL, DIGITS);
        const position = poseOfOrbitCamera(turned).position;
        expect(Math.hypot(...position)).toBeCloseTo(10, DIGITS);
        expect(orbitAroundPivot(LOOKING_ALONG_Z, 0, 10_000).pitchDegrees).toBe(MAX_PITCH_DEGREES);
        expect(orbitAroundPivot(LOOKING_ALONG_Z, 0, -10_000).pitchDegrees).toBe(-MAX_PITCH_DEGREES);
    });

    test("looking around keeps the camera position and moves the pivot", () => {
        const before = poseOfOrbitCamera(LOOKING_ALONG_Z).position;
        const looked = lookAround(LOOKING_ALONG_Z, 300, 0);
        expectVector(poseOfOrbitCamera(looked).position, before);
        expect(looked.pivot[0]).toBeGreaterThan(0);
    });

    test("flying moves along the camera axes at the fly speed, faster when asked", () => {
        const forward = flyCamera(LOOKING_ALONG_Z, {right: 0, up: 0, forward: 1}, 0.5, false);
        expectVector(forward.pivot, [0, 0, 3]);
        const right = flyCamera(LOOKING_ALONG_Z, {right: 1, up: 0, forward: 0}, 0.5, true);
        expectVector(right.pivot, [12, 0, 0]);
        const diagonal = flyCamera(LOOKING_ALONG_Z, {right: 1, up: 0, forward: 1}, 1, false);
        expect(Math.hypot(...diagonal.pivot)).toBeCloseTo(6, DIGITS);
        expect(flyCamera(LOOKING_ALONG_Z, {right: 0, up: 0, forward: 0}, 1, false)).toBe(LOOKING_ALONG_Z);
    });

    test("the wheel dollies toward the pivot and never through it", () => {
        expect(dollyCamera(LOOKING_ALONG_Z, 1).distance).toBeLessThan(10);
        expect(dollyCamera(LOOKING_ALONG_Z, -1).distance).toBeGreaterThan(10);
        expect(dollyCamera(LOOKING_ALONG_Z, 1_000).distance).toBe(MIN_CAMERA_DISTANCE);
    });

    test("panning moves the pivot against the world delta", () => {
        expectVector(panOrbitCamera(LOOKING_ALONG_Z, [1, 2, 0]).pivot, [-1, -2, 0]);
    });

    test("focus centres the pivot on the bounds and backs off to fit them", () => {
        const focused = focusOrbitCamera(LOOKING_ALONG_Z, [2, 2, 2], [4, 4, 4], 60);
        expectVector(focused.pivot, [3, 3, 3]);
        expect(focused.distance).toBeGreaterThan(Math.sqrt(3));
        const point = focusOrbitCamera(LOOKING_ALONG_Z, [1, 1, 1], [1, 1, 1], 60);
        expect(point.distance).toBeGreaterThan(MIN_CAMERA_DISTANCE);
    });
});

describe("2D editor camera", () => {
    test("panning moves the camera against the drag so the point under the pointer stays put", () => {
        expect(panCamera2d([10, 5, -1], 3, -2)).toEqual([7, 7, -1]);
    });

    test("focus centres x and y on the bounds and keeps the depth", () => {
        expect(focusCamera2d([0, 0, -1], [2, 4, 0], [6, 8, 0])).toEqual([4, 6, -1]);
    });

    test("the union of bounds spans every box", () => {
        expect(unionOfBounds([{min: [0, 1, 2], max: [1, 2, 3]}, {min: [-1, 3, 0], max: [0, 4, 1]}])).toEqual({min: [-1, 1, 0], max: [1, 4, 3]});
        expect(unionOfBounds([])).toBeUndefined();
    });
});
