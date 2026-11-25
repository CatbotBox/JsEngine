import {CHANNEL_MASK, CHANNEL_MAX, GREEN_SHIFT, RED_SHIFT} from "../../engine/rendering/packedRgb";

export const SRGB_ENCODED_LINEAR_LIMIT = 0.04045;
export const SRGB_LINEAR_LIMIT = 0.0031308;
export const SRGB_LINEAR_SLOPE = 12.92;
export const SRGB_GAMMA = 2.4;
export const SRGB_OFFSET = 0.055;
export const SRGB_SCALE = 1 + SRGB_OFFSET;
const OPAQUE_ALPHA = 1;

export function displayToLinear(encoded: number): number {
    if (encoded <= SRGB_ENCODED_LINEAR_LIMIT) return encoded / SRGB_LINEAR_SLOPE;
    return Math.pow((encoded + SRGB_OFFSET) / SRGB_SCALE, SRGB_GAMMA);
}

export function linearToDisplay(linear: number): number {
    if (linear <= SRGB_LINEAR_LIMIT) return linear * SRGB_LINEAR_SLOPE;
    return SRGB_SCALE * Math.pow(linear, 1 / SRGB_GAMMA) - SRGB_OFFSET;
}

export function linearClearColorOf(rgb: number): GPUColor {
    return {
        r: displayToLinear(((rgb >> RED_SHIFT) & CHANNEL_MASK) / CHANNEL_MAX),
        g: displayToLinear(((rgb >> GREEN_SHIFT) & CHANNEL_MASK) / CHANNEL_MAX),
        b: displayToLinear((rgb & CHANNEL_MASK) / CHANNEL_MAX),
        a: OPAQUE_ALPHA,
    };
}
