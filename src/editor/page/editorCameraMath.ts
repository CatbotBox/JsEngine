export type Vector3 = readonly [number, number, number];

export type Quaternion = readonly [number, number, number, number];

export interface CameraPose {
    readonly position: Vector3;
    readonly rotation: Quaternion;
}

export interface OrbitCamera {
    readonly pivot: Vector3;
    readonly yawDegrees: number;
    readonly pitchDegrees: number;
    readonly distance: number;
}

export interface FlyInput {
    readonly right: number;
    readonly up: number;
    readonly forward: number;
}

export const ORBIT_DEGREES_PER_PIXEL = 0.3;
export const MAX_PITCH_DEGREES = 89;
export const DEFAULT_PIVOT_DISTANCE = 10;
export const MIN_CAMERA_DISTANCE = 0.05;
export const DOLLY_FACTOR_PER_NOTCH = 0.85;
export const FLY_UNITS_PER_SECOND = 6;
export const FLY_FAST_MULTIPLIER = 4;
export const FOCUS_DISTANCE_MARGIN = 1.6;
export const MIN_FOCUS_RADIUS = 0.5;

export const AXIS_X: Vector3 = [1, 0, 0];
export const AXIS_Y: Vector3 = [0, 1, 0];
export const AXIS_Z: Vector3 = [0, 0, 1];
export const IDENTITY_QUATERNION: Quaternion = [0, 0, 0, 1];

const HALF = 0.5;
const RADIANS_PER_DEGREE = Math.PI / 180;
const DEGREES_PER_RADIAN = 180 / Math.PI;
const UNIT_SINE = 1;

export function degreesToRadians(degrees: number): number {
    return degrees * RADIANS_PER_DEGREE;
}

export function radiansToDegrees(radians: number): number {
    return radians * DEGREES_PER_RADIAN;
}

export function addVectors(a: Vector3, b: Vector3): Vector3 {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subtractVectors(a: Vector3, b: Vector3): Vector3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scaleVector(v: Vector3, factor: number): Vector3 {
    return [v[0] * factor, v[1] * factor, v[2] * factor];
}

export function dotVectors(a: Vector3, b: Vector3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vectorLength(v: Vector3): number {
    return Math.hypot(v[0], v[1], v[2]);
}

export function normalizeVector(v: Vector3): Vector3 {
    const length = vectorLength(v);
    return length === 0 ? v : scaleVector(v, 1 / length);
}

export function multiplyQuaternions(a: Quaternion, b: Quaternion): Quaternion {
    const [ax, ay, az, aw] = a;
    const [bx, by, bz, bw] = b;
    return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ];
}

export function quaternionFromAxisAngle(axis: Vector3, radians: number): Quaternion {
    const unit = normalizeVector(axis);
    const sine = Math.sin(radians * HALF);
    return [unit[0] * sine, unit[1] * sine, unit[2] * sine, Math.cos(radians * HALF)];
}

export function conjugateQuaternion(q: Quaternion): Quaternion {
    return [-q[0], -q[1], -q[2], q[3]];
}

export function normalizeQuaternion(q: Quaternion): Quaternion {
    const length = Math.hypot(q[0], q[1], q[2], q[3]);
    return length === 0 ? IDENTITY_QUATERNION : [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

export function rotateVector(q: Quaternion, v: Vector3): Vector3 {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [
        v[0] + w * tx + (y * tz - z * ty),
        v[1] + w * ty + (z * tx - x * tz),
        v[2] + w * tz + (x * ty - y * tx),
    ];
}

export function forwardOf(rotation: Quaternion): Vector3 {
    return rotateVector(rotation, AXIS_Z);
}

export function rightOf(rotation: Quaternion): Vector3 {
    return rotateVector(rotation, AXIS_X);
}

export function upOf(rotation: Quaternion): Vector3 {
    return rotateVector(rotation, AXIS_Y);
}

export function yawPitchRotation(yawDegrees: number, pitchDegrees: number): Quaternion {
    return multiplyQuaternions(quaternionFromAxisAngle(AXIS_Y, degreesToRadians(yawDegrees)), quaternionFromAxisAngle(AXIS_X, degreesToRadians(pitchDegrees)));
}

function clampPitch(pitchDegrees: number): number {
    return Math.max(-MAX_PITCH_DEGREES, Math.min(MAX_PITCH_DEGREES, pitchDegrees));
}

export function orbitCameraFromPose(pose: CameraPose, pivotDistance: number = DEFAULT_PIVOT_DISTANCE): OrbitCamera {
    const forward = normalizeVector(forwardOf(normalizeQuaternion(pose.rotation)));
    const sinePitch = Math.max(-UNIT_SINE, Math.min(UNIT_SINE, -forward[1]));
    return {
        pivot: addVectors(pose.position, scaleVector(forward, pivotDistance)),
        yawDegrees: radiansToDegrees(Math.atan2(forward[0], forward[2])),
        pitchDegrees: clampPitch(radiansToDegrees(Math.asin(sinePitch))),
        distance: Math.max(MIN_CAMERA_DISTANCE, pivotDistance),
    };
}

export function poseOfOrbitCamera(camera: OrbitCamera): CameraPose {
    const rotation = yawPitchRotation(camera.yawDegrees, camera.pitchDegrees);
    return {position: subtractVectors(camera.pivot, scaleVector(forwardOf(rotation), camera.distance)), rotation};
}

export function orbitAroundPivot(camera: OrbitCamera, deltaXPx: number, deltaYPx: number): OrbitCamera {
    return {
        ...camera,
        yawDegrees: camera.yawDegrees + deltaXPx * ORBIT_DEGREES_PER_PIXEL,
        pitchDegrees: clampPitch(camera.pitchDegrees + deltaYPx * ORBIT_DEGREES_PER_PIXEL),
    };
}

export function lookAround(camera: OrbitCamera, deltaXPx: number, deltaYPx: number): OrbitCamera {
    const position = poseOfOrbitCamera(camera).position;
    const turned = orbitAroundPivot(camera, deltaXPx, deltaYPx);
    const forward = forwardOf(yawPitchRotation(turned.yawDegrees, turned.pitchDegrees));
    return {...turned, pivot: addVectors(position, scaleVector(forward, camera.distance))};
}

export function flyCamera(camera: OrbitCamera, input: FlyInput, elapsedSeconds: number, fast: boolean): OrbitCamera {
    const rotation = yawPitchRotation(camera.yawDegrees, camera.pitchDegrees);
    const direction = addVectors(addVectors(scaleVector(rightOf(rotation), input.right), scaleVector(AXIS_Y, input.up)), scaleVector(forwardOf(rotation), input.forward));
    const length = vectorLength(direction);
    if (length === 0 || elapsedSeconds <= 0) return camera;
    const distance = FLY_UNITS_PER_SECOND * (fast ? FLY_FAST_MULTIPLIER : 1) * elapsedSeconds;
    return {...camera, pivot: addVectors(camera.pivot, scaleVector(direction, distance / length))};
}

export function dollyCamera(camera: OrbitCamera, notchesTowardPivot: number): OrbitCamera {
    return {...camera, distance: Math.max(MIN_CAMERA_DISTANCE, camera.distance * DOLLY_FACTOR_PER_NOTCH ** notchesTowardPivot)};
}

export function panOrbitCamera(camera: OrbitCamera, worldDelta: Vector3): OrbitCamera {
    return {...camera, pivot: subtractVectors(camera.pivot, worldDelta)};
}

export function boundsCenter(min: Vector3, max: Vector3): Vector3 {
    return scaleVector(addVectors(min, max), HALF);
}

export function focusOrbitCamera(camera: OrbitCamera, min: Vector3, max: Vector3, fieldOfViewDegrees: number): OrbitCamera {
    const radius = Math.max(MIN_FOCUS_RADIUS, vectorLength(subtractVectors(max, min)) * HALF);
    const sine = Math.sin(degreesToRadians(fieldOfViewDegrees) * HALF);
    const distance = sine > 0 ? radius / sine * FOCUS_DISTANCE_MARGIN : radius * FOCUS_DISTANCE_MARGIN;
    return {...camera, pivot: boundsCenter(min, max), distance: Math.max(MIN_CAMERA_DISTANCE, distance)};
}

export function panCamera2d(position: Vector3, deltaXUnits: number, deltaYUnits: number): Vector3 {
    return [position[0] - deltaXUnits, position[1] - deltaYUnits, position[2]];
}

export function focusCamera2d(position: Vector3, min: Vector3, max: Vector3): Vector3 {
    const center = boundsCenter(min, max);
    return [center[0], center[1], position[2]];
}

export function unionOfBounds(bounds: readonly {readonly min: Vector3, readonly max: Vector3}[]): {readonly min: Vector3, readonly max: Vector3} | undefined {
    if (bounds.length === 0) return undefined;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const box of bounds) {
        for (let axis = 0; axis < min.length; axis++) {
            min[axis] = Math.min(min[axis], box.min[axis]);
            max[axis] = Math.max(max[axis], box.max[axis]);
        }
    }
    return {min, max};
}
