import {
    conjugateQuaternion,
    IDENTITY_QUATERNION,
    multiplyQuaternions,
    normalizeQuaternion,
    quaternionFromAxisAngle,
    rotateVector,
} from "./editorCameraMath";
import type {Quaternion, Vector3} from "./editorCameraMath";

export type Matrix3 = readonly number[];

export interface LocalTransform {
    readonly rotation: Quaternion;
    readonly scale: Vector3;
}

export const IDENTITY_MATRIX3: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const UNIT_SCALE: Vector3 = [1, 1, 1];

const SIZE = 3;
const SINGULAR_DETERMINANT = 1e-12;

export function matrix3FromRotationScale(rotation: Quaternion, scale: Vector3): Matrix3 {
    const x = rotateVector(rotation, [scale[0], 0, 0]);
    const y = rotateVector(rotation, [0, scale[1], 0]);
    const z = rotateVector(rotation, [0, 0, scale[2]]);
    return [...x, ...y, ...z];
}

export function multiplyMatrix3(a: Matrix3, b: Matrix3): Matrix3 {
    const out = new Array<number>(SIZE * SIZE).fill(0);
    for (let column = 0; column < SIZE; column++) {
        for (let row = 0; row < SIZE; row++) {
            let sum = 0;
            for (let k = 0; k < SIZE; k++) sum += a[k * SIZE + row] * b[column * SIZE + k];
            out[column * SIZE + row] = sum;
        }
    }
    return out;
}

export function invertMatrix3(m: Matrix3): Matrix3 | undefined {
    const [a, b, c, d, e, f, g, h, i] = m;
    const c00 = e * i - f * h, c01 = -(d * i - f * g), c02 = d * h - e * g;
    const determinant = a * c00 + b * c01 + c * c02;
    if (Math.abs(determinant) < SINGULAR_DETERMINANT) return undefined;
    const inverse = 1 / determinant;
    return [
        c00 * inverse, -(b * i - c * h) * inverse, (b * f - c * e) * inverse,
        c01 * inverse, (a * i - c * g) * inverse, -(a * f - c * d) * inverse,
        c02 * inverse, -(a * h - b * g) * inverse, (a * e - b * d) * inverse,
    ];
}

export function applyMatrix3(m: Matrix3, v: Vector3): Vector3 {
    return [
        m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
        m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
        m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
    ];
}

export function chainLinear(chain: readonly LocalTransform[]): Matrix3 {
    return chain.reduce<Matrix3>((linear, transform) => multiplyMatrix3(linear, matrix3FromRotationScale(transform.rotation, transform.scale)), IDENTITY_MATRIX3);
}

export function chainRotation(chain: readonly LocalTransform[]): Quaternion {
    return normalizeQuaternion(chain.reduce<Quaternion>((rotation, transform) => multiplyQuaternions(rotation, transform.rotation), IDENTITY_QUATERNION));
}

export function snapToIncrement(value: number, increment: number): number {
    return increment > 0 ? Math.round(value / increment) * increment + 0 : value;
}

export function snapVector(v: Vector3, increment: number): Vector3 {
    return [snapToIncrement(v[0], increment), snapToIncrement(v[1], increment), snapToIncrement(v[2], increment)];
}

export function rotatedAboutWorldAxis(local: Quaternion, parentWorld: Quaternion, worldAxis: Vector3, radians: number): Quaternion {
    const delta = quaternionFromAxisAngle(worldAxis, radians);
    return normalizeQuaternion(multiplyQuaternions(multiplyQuaternions(multiplyQuaternions(conjugateQuaternion(parentWorld), delta), parentWorld), local));
}

export function localDeltaOf(parentLinear: Matrix3, worldDelta: Vector3): Vector3 {
    const inverse = invertMatrix3(parentLinear);
    return inverse === undefined ? worldDelta : applyMatrix3(inverse, worldDelta);
}
