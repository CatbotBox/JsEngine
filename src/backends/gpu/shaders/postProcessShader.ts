import {AGX_TONE_MAPPING, REINHARD_TONE_MAPPING} from "../gpuPostProcessSettings";
import type {GpuToneMapping} from "../gpuPostProcessSettings";
import {COLOR_SPACE_WGSL} from "./colorSpaceShader";
import {POST_BLOOM_BINDING, POST_PROCESS_BIND_GROUP, POST_SAMPLER_BINDING, POST_SOURCE_BINDING, POST_UNIFORMS_BINDING} from "./postProcessLayout";
import {wgslFloat} from "./wgsl";

export const POST_PROCESS_SHADER_NAME = "post process";
export const FULL_SCREEN_VERTEX_ENTRY_POINT = "fullScreenVertexMain";
export const BLOOM_DOWNSAMPLE_ENTRY_POINT = "bloomDownsampleMain";
export const BLOOM_UPSAMPLE_ENTRY_POINT = "bloomUpsampleMain";
export const COMPOSITE_ENTRY_POINT = "compositeMain";

export const POST_EXPOSURE_OFFSET = 0;
export const POST_BLOOM_INTENSITY_OFFSET = POST_EXPOSURE_OFFSET + 1;
export const POST_BLOOM_THRESHOLD_OFFSET = POST_BLOOM_INTENSITY_OFFSET + 1;
export const POST_BLOOM_KNEE_OFFSET = POST_BLOOM_THRESHOLD_OFFSET + 1;
export const POST_PROCESS_UNIFORM_FLOATS = POST_BLOOM_KNEE_OFFSET + 1;

export const BLOOM_PREFILTER_OVERRIDE = "BLOOM_PREFILTER";
export const TONE_MAPPING_OVERRIDE = "TONE_MAPPING";
export const ENCODE_SRGB_OUTPUT_OVERRIDE = "ENCODE_SRGB_OUTPUT";

export const ACES_TONE_MAPPING_ID = 0;
export const AGX_TONE_MAPPING_ID = 1;
export const REINHARD_TONE_MAPPING_ID = 2;

export const ACES_A = 2.51;
export const ACES_B = 0.03;
export const ACES_C = 2.43;
export const ACES_D = 0.59;
export const ACES_E = 0.14;

export const AGX_MIN_EV = -12.47393;
export const AGX_MAX_EV = 4.026069;
export const AGX_SMALLEST_INPUT = 1e-10;
export const AGX_DISPLAY_GAMMA = 2.2;
export const AGX_INSET_COLUMNS: readonly number[] = [
    0.842479062253094, 0.0423282422610123, 0.0423756549057051,
    0.0784335999999992, 0.878468636469772, 0.0784336,
    0.0792237451477643, 0.0791661274605434, 0.879142973793104,
];
export const AGX_OUTSET_COLUMNS: readonly number[] = [
    1.19687900512017, -0.0528968517574562, -0.0529716355144438,
    -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
    -0.0990297440797205, -0.0989611768448433, 1.15107367264116,
];
export const AGX_CURVE_COEFFICIENTS: readonly number[] = [-0.00232, 0.1191, 0.4298, -6.868, 31.96, -40.14, 15.5];

export const LUMA_WEIGHTS: readonly number[] = [0.2126, 0.7152, 0.0722];
export const DOWNSAMPLE_OUTER_REACH_TEXELS = 2;
export const DOWNSAMPLE_INNER_REACH_TEXELS = 1;
export const DOWNSAMPLE_CENTRE_WEIGHT = 0.5;
export const DOWNSAMPLE_CORNER_WEIGHT = 0.125;
export const BOX_AVERAGE = 0.25;
export const TENT_REACH_TEXELS = 1;
export const TENT_CENTRE_WEIGHT = 4;
export const TENT_EDGE_WEIGHT = 2;
export const TENT_CORNER_WEIGHT = 1;
export const TENT_TOTAL_WEIGHT = TENT_CENTRE_WEIGHT + TENT_EDGE_WEIGHT * 4 + TENT_CORNER_WEIGHT * 4;
export const SMALLEST_BLOOM_BRIGHTNESS = 1e-4;
export const SOURCE_MIP_LEVEL = 0;
const KNEE_HALF = 0.5;
const KNEE_DOUBLE = 2;

export function toneMappingIdOf(toneMapping: GpuToneMapping): number {
    switch (toneMapping) {
        case AGX_TONE_MAPPING:
            return AGX_TONE_MAPPING_ID;
        case REINHARD_TONE_MAPPING:
            return REINHARD_TONE_MAPPING_ID;
        default:
            return ACES_TONE_MAPPING_ID;
    }
}

function wgslFloats(values: readonly number[]): string {
    return values.map(wgslFloat).join(", ");
}

export const POST_PROCESS_WGSL = `
const ACES_A: f32 = ${wgslFloat(ACES_A)};
const ACES_B: f32 = ${wgslFloat(ACES_B)};
const ACES_C: f32 = ${wgslFloat(ACES_C)};
const ACES_D: f32 = ${wgslFloat(ACES_D)};
const ACES_E: f32 = ${wgslFloat(ACES_E)};
const AGX_MIN_EV: f32 = ${wgslFloat(AGX_MIN_EV)};
const AGX_MAX_EV: f32 = ${wgslFloat(AGX_MAX_EV)};
const AGX_SMALLEST_INPUT: f32 = ${wgslFloat(AGX_SMALLEST_INPUT)};
const AGX_DISPLAY_GAMMA: f32 = ${wgslFloat(AGX_DISPLAY_GAMMA)};
const AGX_INSET: mat3x3f = mat3x3f(${wgslFloats(AGX_INSET_COLUMNS)});
const AGX_OUTSET: mat3x3f = mat3x3f(${wgslFloats(AGX_OUTSET_COLUMNS)});
${AGX_CURVE_COEFFICIENTS.map((coefficient, power) => `const AGX_CURVE_${power}: f32 = ${wgslFloat(coefficient)};`).join("\n")}
const LUMA_WEIGHTS: vec3f = vec3f(${wgslFloats(LUMA_WEIGHTS)});
const DOWNSAMPLE_OUTER_REACH_TEXELS: f32 = ${wgslFloat(DOWNSAMPLE_OUTER_REACH_TEXELS)};
const DOWNSAMPLE_INNER_REACH_TEXELS: f32 = ${wgslFloat(DOWNSAMPLE_INNER_REACH_TEXELS)};
const DOWNSAMPLE_CENTRE_WEIGHT: f32 = ${wgslFloat(DOWNSAMPLE_CENTRE_WEIGHT)};
const DOWNSAMPLE_CORNER_WEIGHT: f32 = ${wgslFloat(DOWNSAMPLE_CORNER_WEIGHT)};
const BOX_AVERAGE: f32 = ${wgslFloat(BOX_AVERAGE)};
const TENT_REACH_TEXELS: f32 = ${wgslFloat(TENT_REACH_TEXELS)};
const TENT_CENTRE_WEIGHT: f32 = ${wgslFloat(TENT_CENTRE_WEIGHT)};
const TENT_EDGE_WEIGHT: f32 = ${wgslFloat(TENT_EDGE_WEIGHT)};
const TENT_CORNER_WEIGHT: f32 = ${wgslFloat(TENT_CORNER_WEIGHT)};
const TENT_TOTAL_WEIGHT: f32 = ${wgslFloat(TENT_TOTAL_WEIGHT)};
const SMALLEST_BLOOM_BRIGHTNESS: f32 = ${wgslFloat(SMALLEST_BLOOM_BRIGHTNESS)};
const SOURCE_MIP_LEVEL: f32 = ${wgslFloat(SOURCE_MIP_LEVEL)};
const KNEE_HALF: f32 = ${wgslFloat(KNEE_HALF)};
const KNEE_DOUBLE: f32 = ${wgslFloat(KNEE_DOUBLE)};
const ACES_TONE_MAPPING_ID: u32 = ${ACES_TONE_MAPPING_ID}u;
const AGX_TONE_MAPPING_ID: u32 = ${AGX_TONE_MAPPING_ID}u;
const REINHARD_TONE_MAPPING_ID: u32 = ${REINHARD_TONE_MAPPING_ID}u;

override ${BLOOM_PREFILTER_OVERRIDE}: bool = false;
override ${TONE_MAPPING_OVERRIDE}: u32 = ACES_TONE_MAPPING_ID;
override ${ENCODE_SRGB_OUTPUT_OVERRIDE}: bool = true;
${COLOR_SPACE_WGSL}
struct PostProcess {
    exposure: f32,
    bloomIntensity: f32,
    bloomThreshold: f32,
    bloomKnee: f32,
}

@group(${POST_PROCESS_BIND_GROUP}) @binding(${POST_SAMPLER_BINDING}) var postSampler: sampler;
@group(${POST_PROCESS_BIND_GROUP}) @binding(${POST_SOURCE_BINDING}) var postSource: texture_2d<f32>;
@group(${POST_PROCESS_BIND_GROUP}) @binding(${POST_UNIFORMS_BINDING}) var<uniform> post: PostProcess;
@group(${POST_PROCESS_BIND_GROUP}) @binding(${POST_BLOOM_BINDING}) var postBloom: texture_2d<f32>;

struct FullScreenVertex {
    @builtin(position) clip: vec4f,
    @location(0) uv: vec2f,
}

@vertex
fn ${FULL_SCREEN_VERTEX_ENTRY_POINT}(@builtin(vertex_index) index: u32) -> FullScreenVertex {
    let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
    var output: FullScreenVertex;
    output.clip = vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
    output.uv = vec2f(corner.x, 1.0 - corner.y);
    return output;
}

fn sourceTexel() -> vec2f {
    return 1.0 / vec2f(textureDimensions(postSource));
}

fn bloomTap(uv: vec2f, texel: vec2f, x: f32, y: f32) -> vec3f {
    return textureSampleLevel(postSource, postSampler, uv + texel * vec2f(x, y), SOURCE_MIP_LEVEL).rgb;
}

fn karisWeight(rgb: vec3f) -> f32 {
    return 1.0 / (1.0 + dot(rgb, LUMA_WEIGHTS));
}

fn bloomExcess(brightness: f32) -> f32 {
    let over = max(brightness - post.bloomThreshold, 0.0);
    if (over >= post.bloomKnee) {
        return over - post.bloomKnee * KNEE_HALF;
    }
    return over * over / (post.bloomKnee * KNEE_DOUBLE);
}

fn prefiltered(rgb: vec3f) -> vec3f {
    let brightness = max(rgb.r, max(rgb.g, rgb.b));
    return rgb * (bloomExcess(brightness) / max(brightness, SMALLEST_BLOOM_BRIGHTNESS));
}

@fragment
fn ${BLOOM_DOWNSAMPLE_ENTRY_POINT}(input: FullScreenVertex) -> @location(0) vec4f {
    let texel = sourceTexel();
    let uv = input.uv;
    let outer = DOWNSAMPLE_OUTER_REACH_TEXELS;
    let inner = DOWNSAMPLE_INNER_REACH_TEXELS;
    let a = bloomTap(uv, texel, -outer, -outer);
    let b = bloomTap(uv, texel, 0.0, -outer);
    let c = bloomTap(uv, texel, outer, -outer);
    let d = bloomTap(uv, texel, -outer, 0.0);
    let e = bloomTap(uv, texel, 0.0, 0.0);
    let f = bloomTap(uv, texel, outer, 0.0);
    let g = bloomTap(uv, texel, -outer, outer);
    let h = bloomTap(uv, texel, 0.0, outer);
    let i = bloomTap(uv, texel, outer, outer);
    let j = bloomTap(uv, texel, -inner, -inner);
    let k = bloomTap(uv, texel, inner, -inner);
    let l = bloomTap(uv, texel, -inner, inner);
    let m = bloomTap(uv, texel, inner, inner);
    let centre = (j + k + l + m) * BOX_AVERAGE;
    let topLeft = (a + b + d + e) * BOX_AVERAGE;
    let topRight = (b + c + e + f) * BOX_AVERAGE;
    let bottomLeft = (d + e + g + h) * BOX_AVERAGE;
    let bottomRight = (e + f + h + i) * BOX_AVERAGE;
    if (${BLOOM_PREFILTER_OVERRIDE}) {
        let centreWeight = DOWNSAMPLE_CENTRE_WEIGHT * karisWeight(centre);
        let topLeftWeight = DOWNSAMPLE_CORNER_WEIGHT * karisWeight(topLeft);
        let topRightWeight = DOWNSAMPLE_CORNER_WEIGHT * karisWeight(topRight);
        let bottomLeftWeight = DOWNSAMPLE_CORNER_WEIGHT * karisWeight(bottomLeft);
        let bottomRightWeight = DOWNSAMPLE_CORNER_WEIGHT * karisWeight(bottomRight);
        let weighted = centre * centreWeight + topLeft * topLeftWeight + topRight * topRightWeight
            + bottomLeft * bottomLeftWeight + bottomRight * bottomRightWeight;
        let totalWeight = centreWeight + topLeftWeight + topRightWeight + bottomLeftWeight + bottomRightWeight;
        return vec4f(prefiltered(weighted / totalWeight), 1.0);
    }
    return vec4f(centre * DOWNSAMPLE_CENTRE_WEIGHT + (topLeft + topRight + bottomLeft + bottomRight) * DOWNSAMPLE_CORNER_WEIGHT, 1.0);
}

@fragment
fn ${BLOOM_UPSAMPLE_ENTRY_POINT}(input: FullScreenVertex) -> @location(0) vec4f {
    let texel = sourceTexel();
    let uv = input.uv;
    let reach = TENT_REACH_TEXELS;
    let corners = bloomTap(uv, texel, -reach, -reach) + bloomTap(uv, texel, reach, -reach)
        + bloomTap(uv, texel, -reach, reach) + bloomTap(uv, texel, reach, reach);
    let edges = bloomTap(uv, texel, 0.0, -reach) + bloomTap(uv, texel, -reach, 0.0)
        + bloomTap(uv, texel, reach, 0.0) + bloomTap(uv, texel, 0.0, reach);
    let centre = bloomTap(uv, texel, 0.0, 0.0);
    return vec4f((centre * TENT_CENTRE_WEIGHT + edges * TENT_EDGE_WEIGHT + corners * TENT_CORNER_WEIGHT) / TENT_TOTAL_WEIGHT, 1.0);
}

fn acesNarkowicz(rgb: vec3f) -> vec3f {
    return saturate((rgb * (ACES_A * rgb + ACES_B)) / (rgb * (ACES_C * rgb + ACES_D) + ACES_E));
}

fn agxContrast(x: vec3f) -> vec3f {
    return ((((((AGX_CURVE_6 * x + AGX_CURVE_5) * x + AGX_CURVE_4) * x + AGX_CURVE_3) * x + AGX_CURVE_2) * x + AGX_CURVE_1) * x) + AGX_CURVE_0;
}

fn agx(rgb: vec3f) -> vec3f {
    let inset = AGX_INSET * max(rgb, vec3f(0.0));
    let encoded = (clamp(log2(max(inset, vec3f(AGX_SMALLEST_INPUT))), vec3f(AGX_MIN_EV), vec3f(AGX_MAX_EV)) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV);
    let outset = AGX_OUTSET * agxContrast(encoded);
    return saturate(pow(max(outset, vec3f(0.0)), vec3f(AGX_DISPLAY_GAMMA)));
}

fn reinhard(rgb: vec3f) -> vec3f {
    return rgb / (1.0 + rgb);
}

fn toneMap(rgb: vec3f) -> vec3f {
    if (${TONE_MAPPING_OVERRIDE} == AGX_TONE_MAPPING_ID) {
        return agx(rgb);
    }
    if (${TONE_MAPPING_OVERRIDE} == REINHARD_TONE_MAPPING_ID) {
        return reinhard(rgb);
    }
    return acesNarkowicz(rgb);
}

@fragment
fn ${COMPOSITE_ENTRY_POINT}(input: FullScreenVertex) -> @location(0) vec4f {
    let scene = textureSampleLevel(postSource, postSampler, input.uv, SOURCE_MIP_LEVEL).rgb;
    let bloom = textureSampleLevel(postBloom, postSampler, input.uv, SOURCE_MIP_LEVEL).rgb;
    let mapped = toneMap(max((scene + bloom * post.bloomIntensity) * post.exposure, vec3f(0.0)));
    if (${ENCODE_SRGB_OUTPUT_OVERRIDE}) {
        return vec4f(linearToDisplay(mapped), 1.0);
    }
    return vec4f(mapped, 1.0);
}
`;
