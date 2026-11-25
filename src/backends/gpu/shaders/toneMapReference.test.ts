import {describe, expect, test} from "../../../engine/testing/harness";
import {displayToLinear, linearClearColorOf, linearToDisplay} from "../gpuColorSpace";
import {
    ACES_A,
    ACES_B,
    ACES_C,
    ACES_D,
    ACES_E,
    AGX_CURVE_COEFFICIENTS,
    AGX_DISPLAY_GAMMA,
    AGX_INSET_COLUMNS,
    AGX_MAX_EV,
    AGX_MIN_EV,
    AGX_OUTSET_COLUMNS,
    AGX_SMALLEST_INPUT,
    POST_PROCESS_WGSL,
} from "./postProcessShader";

type Rgb = [number, number, number];

const DIGITS = 5;
const COARSE_DIGITS = 2;
const SLOPE_DIGITS = 3;
const ROUND_TRIP_VALUES: readonly number[] = [0, 0.002, 0.04, 0.2, 0.5, 0.8, 1];
const GREY_TOLERANCE = 1e-3;
const ABOVE_WHITE = 2;
const MAT3_SIDE = 3;
const MID_GREY = 0.18;
const NARKOWICZ_WHITE = (2.51 + 0.03) / (2.43 + 0.59 + 0.14);
const NARKOWICZ_MID_GREY = 0.26690;
const SRGB_HALF_IN_LINEAR = 0.21404;
const MID_GREY_IN_SRGB = 0.46136;
const AGX_MID_GREY_DISPLAY = 0.5;
const VERY_BRIGHT = 1e4;
const HALF = 0.5;
const KNEE = 0.5;
const THRESHOLD = 1;
const SLOPE_STEP = 1e-4;
const SCENE_CLOSE_TO_DISPLAY = 0.11;
const DISPLAY_MID_TONES: readonly number[] = [0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1];
const BLACK = 0x000000;
const BACKGROUND = 0x336699;
const CHANNEL_MAX = 255;

function saturate(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function acesNarkowicz(x: number): number {
    return saturate((x * (ACES_A * x + ACES_B)) / (x * (ACES_C * x + ACES_D) + ACES_E));
}

function reinhard(x: number): number {
    return x / (1 + x);
}

function timesColumns(columns: readonly number[], v: Rgb): Rgb {
    return [0, 1, 2].map(row => columns[row] * v[0] + columns[MAT3_SIDE + row] * v[1] + columns[2 * MAT3_SIDE + row] * v[2]) as Rgb;
}

function agxContrast(x: number): number {
    return AGX_CURVE_COEFFICIENTS.reduceRight((sum, coefficient) => sum * x + coefficient, 0);
}

function agx(rgb: Rgb): Rgb {
    const inset = timesColumns(AGX_INSET_COLUMNS, rgb.map(c => Math.max(c, 0)) as Rgb);
    const encoded = inset.map(c => (Math.min(AGX_MAX_EV, Math.max(AGX_MIN_EV, Math.log2(Math.max(c, AGX_SMALLEST_INPUT)))) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV));
    const outset = timesColumns(AGX_OUTSET_COLUMNS, encoded.map(agxContrast) as Rgb);
    return outset.map(c => saturate(Math.pow(Math.max(c, 0), AGX_DISPLAY_GAMMA))) as Rgb;
}

function grey(value: number): Rgb {
    return [value, value, value];
}

function bloomExcess(brightness: number, threshold: number, knee: number): number {
    const over = Math.max(brightness - threshold, 0);
    if (over >= knee) return over - knee * HALF;
    return over * over / (knee * 2);
}

function composedAces(display: number): number {
    return linearToDisplay(acesNarkowicz(displayToLinear(display)));
}

describe("the post-process tone curves against a CPU reference using the WGSL constants", () => {
    test("the WGSL is the Narkowicz ACES fit, clamped, with the reference's constants", () => {
        expect(POST_PROCESS_WGSL.includes("return saturate((rgb * (ACES_A * rgb + ACES_B)) / (rgb * (ACES_C * rgb + ACES_D) + ACES_E));")).toBe(true);
        expect(acesNarkowicz(0)).toBe(0);
        expect(acesNarkowicz(1)).toBeCloseTo(NARKOWICZ_WHITE, DIGITS);
        expect(acesNarkowicz(MID_GREY)).toBeCloseTo(NARKOWICZ_MID_GREY, DIGITS);
        expect(acesNarkowicz(VERY_BRIGHT)).toBe(1);
    });

    test("Reinhard maps x to x / (1 + x): one to a half, never reaching one", () => {
        expect(POST_PROCESS_WGSL.includes("return rgb / (1.0 + rgb);")).toBe(true);
        expect([reinhard(0), reinhard(1)]).toEqual([0, HALF]);
        expect(reinhard(VERY_BRIGHT)).toBeLessThan(1);
    });

    test("AgX keeps greys grey, maps mid grey to about half the display range, and its log encoding and curve match the WGSL", () => {
        expect(POST_PROCESS_WGSL.includes("let encoded = (clamp(log2(max(inset, vec3f(AGX_SMALLEST_INPUT))), vec3f(AGX_MIN_EV), vec3f(AGX_MAX_EV)) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV);")).toBe(true);
        expect(POST_PROCESS_WGSL.includes("return ((((((AGX_CURVE_6 * x + AGX_CURVE_5) * x + AGX_CURVE_4) * x + AGX_CURVE_3) * x + AGX_CURVE_2) * x + AGX_CURVE_1) * x) + AGX_CURVE_0;")).toBe(true);
        expect(POST_PROCESS_WGSL.includes("return saturate(pow(max(outset, vec3f(0.0)), vec3f(AGX_DISPLAY_GAMMA)));")).toBe(true);
        const midGrey = agx(grey(MID_GREY));
        expect(Math.max(...midGrey) - Math.min(...midGrey)).toBeLessThan(GREY_TOLERANCE);
        expect(linearToDisplay(midGrey[0])).toBeCloseTo(AGX_MID_GREY_DISPLAY, COARSE_DIGITS);
        expect(agx(grey(0))[0]).toBe(0);
        expect(agx(grey(VERY_BRIGHT))[0]).toBeGreaterThan(agx(grey(1))[0]);
    });

    test("the sRGB transfer functions round-trip and hit their reference points", () => {
        expect(displayToLinear(HALF)).toBeCloseTo(SRGB_HALF_IN_LINEAR, DIGITS);
        expect(linearToDisplay(MID_GREY)).toBeCloseTo(MID_GREY_IN_SRGB, DIGITS);
        for (const value of ROUND_TRIP_VALUES) expect(linearToDisplay(displayToLinear(value))).toBeCloseTo(value, DIGITS);
    });

    test("the HDR clear colour is the background in linear light, so black stays black through every curve", () => {
        expect(linearClearColorOf(BLACK)).toEqual({r: 0, g: 0, b: 0, a: 1});
        const clear = linearClearColorOf(BACKGROUND) as GPUColorDict;
        expect([clear.r, clear.g, clear.b]).toEqual([0x33, 0x66, 0x99].map(channel => displayToLinear(channel / CHANNEL_MAX)));
        expect([composedAces(0), linearToDisplay(reinhard(0)), linearToDisplay(agx(grey(0))[0])]).toEqual([0, 0, 0]);
    });

    test("at exposure 1, ACES keeps display-range colours close to the untouched scene and compresses what is above it", () => {
        for (const display of DISPLAY_MID_TONES) expect(Math.abs(composedAces(display) - display)).toBeLessThan(SCENE_CLOSE_TO_DISPLAY);
        expect(composedAces(HALF)).toBeGreaterThan(HALF);
        expect(composedAces(ABOVE_WHITE)).toBeGreaterThan(composedAces(1));
        expect(composedAces(ABOVE_WHITE)).toBeLessThan(1);
    });

    test("the bloom threshold keeps nothing up to the threshold, eases in over the knee and continues with slope one", () => {
        expect(POST_PROCESS_WGSL.includes("let over = max(brightness - post.bloomThreshold, 0.0);")).toBe(true);
        expect(POST_PROCESS_WGSL.includes("if (over >= post.bloomKnee) {\n        return over - post.bloomKnee * KNEE_HALF;\n    }")).toBe(true);
        expect(POST_PROCESS_WGSL.includes("return over * over / (post.bloomKnee * KNEE_DOUBLE);")).toBe(true);
        expect(bloomExcess(THRESHOLD, THRESHOLD, KNEE)).toBe(0);
        expect(bloomExcess(THRESHOLD * HALF, THRESHOLD, KNEE)).toBe(0);
        const kneeEnd = THRESHOLD + KNEE;
        expect(bloomExcess(kneeEnd - SLOPE_STEP, THRESHOLD, KNEE)).toBeCloseTo(bloomExcess(kneeEnd, THRESHOLD, KNEE), SLOPE_DIGITS);
        expect((bloomExcess(kneeEnd, THRESHOLD, KNEE) - bloomExcess(kneeEnd - SLOPE_STEP, THRESHOLD, KNEE)) / SLOPE_STEP).toBeCloseTo(1, SLOPE_DIGITS);
        expect(bloomExcess(THRESHOLD + ABOVE_WHITE, THRESHOLD, 0)).toBe(ABOVE_WHITE);
    });
});
