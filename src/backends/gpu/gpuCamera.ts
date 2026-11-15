import {LocalToWorld} from "../../engine/translation";
import {fromFloat32Array} from "../../engine/math/types/vec";
import type {ReadonlyVec16} from "../../engine/math/types/vec";
import {MAT4_ELEMENT, MAT4_FLOATS} from "../../engine/math/mat4Layout";
import {NEAR_PLANE_Z} from "../../engine/rendering/3d/software/meshRasterizer";
import {VEC4_FLOATS} from "./gpuLightPacking";

export const FRAME_VIEW_OFFSET = 0;
export const FRAME_PROJECTION_OFFSET = FRAME_VIEW_OFFSET + MAT4_FLOATS;
export const FRAME_TIME_OFFSET = FRAME_PROJECTION_OFFSET + MAT4_FLOATS;
export const FRAME_UNIFORM_FLOATS = FRAME_TIME_OFFSET + VEC4_FLOATS;

const HALF = 2;
const W_IS_VIEW_Z = 1;
const ORTHOGRAPHIC_W = 1;
const ORTHOGRAPHIC_DEPTH_AT_CAMERA = 1;

export function frameViewMatrix(frameUniforms: Float32Array): Float32Array {
    return frameUniforms.subarray(FRAME_VIEW_OFFSET, FRAME_VIEW_OFFSET + MAT4_FLOATS);
}

export function frameProjectionMatrix(frameUniforms: Float32Array): Float32Array {
    return frameUniforms.subarray(FRAME_PROJECTION_OFFSET, FRAME_PROJECTION_OFFSET + MAT4_FLOATS);
}

export function writeFrameTime(frameUniforms: Float32Array, elapsedSeconds: number): void {
    frameUniforms[FRAME_TIME_OFFSET] = elapsedSeconds;
}

export function perspectiveFocalLength(fieldOfViewRadians: number, heightPx: number): number {
    return heightPx / (Math.tan(fieldOfViewRadians / HALF) * HALF);
}

export function writeFrameUniforms(
    out: Float32Array,
    cameraMatrix: ReadonlyVec16,
    fieldOfViewRadians: number | undefined,
    widthPx: number,
    heightPx: number,
    pixelHeightPerWidth: number,
    orthographicDepthRange: number,
): void {
    LocalToWorld.invertAffine(cameraMatrix, fromFloat32Array<16>(frameViewMatrix(out)));
    const projection = frameProjectionMatrix(out);
    projection.fill(0);
    const halfWidth = widthPx / HALF, halfHeight = heightPx / HALF;
    if (fieldOfViewRadians !== undefined) {
        const focalLength = perspectiveFocalLength(fieldOfViewRadians, heightPx);
        projection[MAT4_ELEMENT.m00] = pixelHeightPerWidth * focalLength / halfWidth;
        projection[MAT4_ELEMENT.m11] = focalLength / halfHeight;
        projection[MAT4_ELEMENT.m23] = NEAR_PLANE_Z;
        projection[MAT4_ELEMENT.m32] = W_IS_VIEW_Z;
    } else {
        projection[MAT4_ELEMENT.m00] = pixelHeightPerWidth / halfWidth;
        projection[MAT4_ELEMENT.m11] = 1 / halfHeight;
        projection[MAT4_ELEMENT.m22] = -1 / orthographicDepthRange;
        projection[MAT4_ELEMENT.m23] = ORTHOGRAPHIC_DEPTH_AT_CAMERA;
        projection[MAT4_ELEMENT.m33] = ORTHOGRAPHIC_W;
    }
}
