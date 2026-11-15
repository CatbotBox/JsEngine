import {Vec} from "../../engine/math/types/vec";
import type {ReadonlyVec16} from "../../engine/math/types/vec";
import {MAT4_ELEMENT, MAT4_FLOATS, MAT4_TRANSLATION_X, MAT4_TRANSLATION_Y, MAT4_TRANSLATION_Z} from "../../engine/math/mat4Layout";
import {SCREEN_UNIT_HEIGHT_PER_WIDTH} from "../../engine/rendering/screenUnits";

export type Mat4 = number[];

export type Point3 = readonly [number, number, number];

export interface Ray {
    readonly origin: Point3;
    readonly direction: Point3;
}

export interface Box {
    readonly min: Point3;
    readonly max: Point3;
}

const HALF = 0.5;
const PARALLEL_EPSILON = 1e-12;
const SINGULAR_DETERMINANT_EPSILON = 1e-12;
const AXES = 3;
const MAT4_SIZE = 4;

export function mat4FromVec16(matrix: ReadonlyVec16): Mat4 {
    return Vec.toArray(matrix);
}

export function identityMat4(): Mat4 {
    const m = new Array<number>(MAT4_FLOATS).fill(0);
    m[MAT4_ELEMENT.m00] = 1;
    m[MAT4_ELEMENT.m11] = 1;
    m[MAT4_ELEMENT.m22] = 1;
    m[MAT4_ELEMENT.m33] = 1;
    return m;
}

export function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
    const out = new Array<number>(MAT4_FLOATS).fill(0);
    for (let column = 0; column < MAT4_SIZE; column++) {
        for (let row = 0; row < MAT4_SIZE; row++) {
            let sum = 0;
            for (let k = 0; k < MAT4_SIZE; k++) sum += a[k * MAT4_SIZE + row] * b[column * MAT4_SIZE + k];
            out[column * MAT4_SIZE + row] = sum;
        }
    }
    return out;
}

export function invertAffineMat4(m: Mat4): Mat4 {
    const a00 = m[0], a01 = m[4], a02 = m[8];
    const a10 = m[1], a11 = m[5], a12 = m[9];
    const a20 = m[2], a21 = m[6], a22 = m[10];
    const b01 = a22 * a11 - a12 * a21;
    const b11 = -a22 * a10 + a12 * a20;
    const b21 = a21 * a10 - a11 * a20;
    const determinant = a00 * b01 + a01 * b11 + a02 * b21;
    if (Math.abs(determinant) < SINGULAR_DETERMINANT_EPSILON) return identityMat4();
    const inverse = 1 / determinant;
    const i00 = b01 * inverse, i01 = (-a22 * a01 + a02 * a21) * inverse, i02 = (a12 * a01 - a02 * a11) * inverse;
    const i10 = b11 * inverse, i11 = (a22 * a00 - a02 * a20) * inverse, i12 = (-a12 * a00 + a02 * a10) * inverse;
    const i20 = b21 * inverse, i21 = (-a21 * a00 + a01 * a20) * inverse, i22 = (a11 * a00 - a01 * a10) * inverse;
    const tx = m[MAT4_TRANSLATION_X], ty = m[MAT4_TRANSLATION_Y], tz = m[MAT4_TRANSLATION_Z];
    const out = identityMat4();
    out[0] = i00;
    out[1] = i10;
    out[2] = i20;
    out[4] = i01;
    out[5] = i11;
    out[6] = i21;
    out[8] = i02;
    out[9] = i12;
    out[10] = i22;
    out[MAT4_TRANSLATION_X] = -(i00 * tx + i01 * ty + i02 * tz);
    out[MAT4_TRANSLATION_Y] = -(i10 * tx + i11 * ty + i12 * tz);
    out[MAT4_TRANSLATION_Z] = -(i20 * tx + i21 * ty + i22 * tz);
    return out;
}

export function translationOf(m: Mat4): Point3 {
    return [m[MAT4_TRANSLATION_X], m[MAT4_TRANSLATION_Y], m[MAT4_TRANSLATION_Z]];
}

export function transformDirection(m: Mat4, d: Point3): Point3 {
    return [
        m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
        m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
        m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
    ];
}

export function projectToScreen(m: Mat4, p: Point3): {readonly x: number, readonly y: number, readonly w: number} {
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    return {x: x / w, y: y / w, w};
}

export function focalLengthInScreenRows(screenHeight: number, fieldOfViewRadians: number): number {
    return screenHeight / (Math.tan(fieldOfViewRadians * HALF) * 2);
}

export function orthographicWorldToScreen(cameraPosition: Point3, screenWidth: number, screenHeight: number): Mat4 {
    const m = identityMat4();
    m[MAT4_TRANSLATION_X] = screenWidth * HALF - cameraPosition[0];
    m[MAT4_TRANSLATION_Y] = screenHeight * HALF - cameraPosition[1];
    return m;
}

export function perspectiveWorldToScreen(cameraMatrix: Mat4, fieldOfViewRadians: number, screenWidth: number, screenHeight: number): Mat4 {
    const focal = focalLengthInScreenRows(screenHeight, fieldOfViewRadians);
    const projection = new Array<number>(MAT4_FLOATS).fill(0);
    projection[MAT4_ELEMENT.m00] = SCREEN_UNIT_HEIGHT_PER_WIDTH * focal;
    projection[MAT4_ELEMENT.m02] = screenWidth * HALF;
    projection[MAT4_ELEMENT.m11] = -focal;
    projection[MAT4_ELEMENT.m12] = screenHeight * HALF;
    projection[MAT4_ELEMENT.m23] = 1;
    projection[MAT4_ELEMENT.m32] = 1;
    return multiplyMat4(projection, invertAffineMat4(cameraMatrix));
}

function normalized(v: Point3): Point3 {
    const length = Math.hypot(v[0], v[1], v[2]);
    return length === 0 ? v : [v[0] / length, v[1] / length, v[2] / length];
}

export function screenRay(cameraMatrix: Mat4, fieldOfViewRadians: number, screenWidth: number, screenHeight: number, x: number, y: number): Ray {
    const focal = focalLengthInScreenRows(screenHeight, fieldOfViewRadians);
    const viewDirection: Point3 = [
        (x - screenWidth * HALF) / (SCREEN_UNIT_HEIGHT_PER_WIDTH * focal),
        (screenHeight * HALF - y) / focal,
        1,
    ];
    return {origin: translationOf(cameraMatrix), direction: normalized(transformDirection(cameraMatrix, viewDirection))};
}

export function rayBoxDistance(ray: Ray, box: Box): number | undefined {
    let near = Number.NEGATIVE_INFINITY;
    let far = Number.POSITIVE_INFINITY;
    for (let axis = 0; axis < AXES; axis++) {
        const origin = ray.origin[axis], direction = ray.direction[axis];
        const min = box.min[axis], max = box.max[axis];
        if (Math.abs(direction) < PARALLEL_EPSILON) {
            if (origin < min || origin > max) return undefined;
            continue;
        }
        const t1 = (min - origin) / direction, t2 = (max - origin) / direction;
        near = Math.max(near, Math.min(t1, t2));
        far = Math.min(far, Math.max(t1, t2));
    }
    const entry = Math.max(near, 0);
    return far >= entry ? entry : undefined;
}
