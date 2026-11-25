import {SRGB_ENCODED_LINEAR_LIMIT, SRGB_GAMMA, SRGB_LINEAR_LIMIT, SRGB_LINEAR_SLOPE, SRGB_OFFSET, SRGB_SCALE} from "../gpuColorSpace";
import {wgslFloat} from "./wgsl";

export const COLOR_SPACE_WGSL = `
const SRGB_ENCODED_LINEAR_LIMIT: f32 = ${wgslFloat(SRGB_ENCODED_LINEAR_LIMIT)};
const SRGB_LINEAR_LIMIT: f32 = ${wgslFloat(SRGB_LINEAR_LIMIT)};
const SRGB_LINEAR_SLOPE: f32 = ${wgslFloat(SRGB_LINEAR_SLOPE)};
const SRGB_GAMMA: f32 = ${wgslFloat(SRGB_GAMMA)};
const SRGB_OFFSET: f32 = ${wgslFloat(SRGB_OFFSET)};
const SRGB_SCALE: f32 = ${wgslFloat(SRGB_SCALE)};

fn displayToLinear(encoded: vec3f) -> vec3f {
    let low = encoded / SRGB_LINEAR_SLOPE;
    let high = pow((encoded + SRGB_OFFSET) / SRGB_SCALE, vec3f(SRGB_GAMMA));
    return select(high, low, encoded <= vec3f(SRGB_ENCODED_LINEAR_LIMIT));
}

fn linearToDisplay(linear: vec3f) -> vec3f {
    let low = linear * SRGB_LINEAR_SLOPE;
    let high = SRGB_SCALE * pow(linear, vec3f(1.0 / SRGB_GAMMA)) - SRGB_OFFSET;
    return select(high, low, linear <= vec3f(SRGB_LINEAR_LIMIT));
}
`;
