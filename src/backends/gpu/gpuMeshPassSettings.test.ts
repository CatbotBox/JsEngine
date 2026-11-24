import {describe, expect, test} from "../../engine/testing/harness";
import {effectiveRenderScale, GpuMeshPassSettings, MAX_RENDER_TARGET_PX, MIN_RENDER_SCALE, renderTargetPx} from "./gpuMeshPassSettings";

const WIDTH = 640, HEIGHT = 360;
const DOUBLE = 2;
const FRACTIONAL = 1.5;
const BELOW_ONE = 0.5;
const HUGE = 100;
const ODD_WIDTH = 333;

describe("render scale", () => {
    test("the default renders the 3D scene at the framebuffer size", () => {
        const scale = effectiveRenderScale(new GpuMeshPassSettings().renderScale, WIDTH, HEIGHT);
        expect([scale, renderTargetPx(WIDTH, scale), renderTargetPx(HEIGHT, scale)]).toEqual([MIN_RENDER_SCALE, WIDTH, HEIGHT]);
    });

    test("a larger scale multiplies both sides, rounding to whole pixels", () => {
        expect([renderTargetPx(WIDTH, DOUBLE), renderTargetPx(HEIGHT, DOUBLE)]).toEqual([WIDTH * DOUBLE, HEIGHT * DOUBLE]);
        expect(renderTargetPx(ODD_WIDTH, FRACTIONAL)).toBe(Math.round(ODD_WIDTH * FRACTIONAL));
        expect(effectiveRenderScale(FRACTIONAL, WIDTH, HEIGHT)).toBe(FRACTIONAL);
    });

    test("scales below one, zero, negative and non-finite fall back to the framebuffer size so the overlay is never downsampled", () => {
        for (const requested of [BELOW_ONE, 0, -DOUBLE, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
            expect(effectiveRenderScale(requested, WIDTH, HEIGHT)).toBe(MIN_RENDER_SCALE);
        }
    });

    test("the scale shrinks to keep the larger side within the texture limit, keeping the aspect ratio", () => {
        const scale = effectiveRenderScale(HUGE, WIDTH, HEIGHT);
        expect(renderTargetPx(WIDTH, scale)).toBe(MAX_RENDER_TARGET_PX);
        expect(renderTargetPx(HEIGHT, scale)).toBe(Math.round(HEIGHT * MAX_RENDER_TARGET_PX / WIDTH));
    });

    test("a framebuffer already past the limit is left at its own size", () => {
        expect(effectiveRenderScale(DOUBLE, MAX_RENDER_TARGET_PX * DOUBLE, HEIGHT)).toBe(MIN_RENDER_SCALE);
    });
});
