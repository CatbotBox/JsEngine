import {describe, expect, test} from "../../engine/testing/harness";
import {LIGHT_KIND_DIRECTIONAL, SceneLights} from "../../engine/rendering/3d/lighting/sceneLights";
import {canCastShadows, GpuShadowSelection, SELECTED_SCORE_BONUS, shadowReachOf, usesCubeShadow} from "./gpuShadowSelection";

const CASTS = true;
const OPTS_OUT = false;
const RANGE = 10;
const NO_RANGE = 0;
const WHITE = 1;
const BUDGET = 6;
const CUBE_BUDGET = 2;
const SPHERE_RADIUS = 0.5;
const TUBE_HALF_LENGTH = 2;
const RECT_HALF_WIDTH = 3;
const RECT_HALF_HEIGHT = 4;
const INNER_COS = 0.95;
const OUTER_COS = 0.9;
const CLOSED_CONE_COS = 1;
const CAMERA: readonly [number, number, number] = [0, 0, 0];
const HYSTERESIS_STEP = SELECTED_SCORE_BONUS * RANGE / 2;
const NEAR_LIGHT_X = 5;

function selected(selection: GpuShadowSelection): number[] {
    return Array.from({length: selection.count}, (_, rank) => selection.lightAt(rank));
}

function pointAt(lights: SceneLights, x: number, casts: boolean = CASTS, range: number = RANGE): void {
    lights.addPoint(x, 0, 0, WHITE, WHITE, WHITE, range, casts);
}

function spotAt(lights: SceneLights, x: number, coneCosOuter: number = OUTER_COS): void {
    lights.addSpot(x, 0, 0, 0, -1, 0, WHITE, WHITE, WHITE, RANGE, INNER_COS, coneCosOuter, CASTS);
}

function lightsOf(add: (lights: SceneLights) => void): SceneLights {
    const lights = new SceneLights();
    lights.beginGather();
    add(lights);
    return lights;
}

describe("shadow selection", () => {
    test("directional lights come first in gather order, then the others by distance from the camera over their reach", () => {
        const lights = lightsOf(add => {
            pointAt(add, 8);
            add.addDirectional(0, -1, 0, WHITE, WHITE, WHITE, CASTS);
            spotAt(add, 3);
            add.addSphere(20, 0, 0, WHITE, WHITE, WHITE, RANGE * 4, SPHERE_RADIUS, CASTS);
            add.addDirectional(1, -1, 0, WHITE, WHITE, WHITE, CASTS);
        });
        const selection = new GpuShadowSelection();
        selection.select(lights, BUDGET, BUDGET, ...CAMERA);
        expect(selected(selection)).toEqual([1, 4, 2, 3, 0]);
    });

    test("lights that opt out, have no reach, a closed cone or no direction are never picked; hemisphere and ambient never take a slot", () => {
        const lights = lightsOf(add => {
            add.addAmbient(WHITE, WHITE, WHITE);
            add.addHemisphere(0, 1, 0, WHITE, WHITE, WHITE, 0, 0, 0);
            pointAt(add, 1, OPTS_OUT);
            pointAt(add, 1, CASTS, NO_RANGE);
            spotAt(add, 1, CLOSED_CONE_COS);
            add.addDirectional(0, 0, 0, WHITE, WHITE, WHITE, CASTS);
            add.addDirectional(0, -1, 0, WHITE, WHITE, WHITE, OPTS_OUT);
            pointAt(add, 2);
        });
        expect(Array.from({length: lights.count}, (_, light) => canCastShadows(lights, light))).toEqual([false, false, false, false, false, true]);
        const selection = new GpuShadowSelection();
        selection.select(lights, BUDGET, BUDGET, ...CAMERA);
        expect(selected(selection)).toEqual([5]);
    });

    test("the defaults follow the components: directional lights cast unless told not to, the others only when they opt in", () => {
        const lights = lightsOf(add => {
            add.addDirectional(0, -1, 0, WHITE, WHITE, WHITE);
            add.addPoint(1, 0, 0, WHITE, WHITE, WHITE, RANGE);
        });
        expect([canCastShadows(lights, 0), canCastShadows(lights, 1)]).toEqual([true, false]);
    });

    test("point, sphere, tube and rect lights use cube maps and reach past their range by their shape", () => {
        const lights = lightsOf(add => {
            add.addDirectional(0, -1, 0, WHITE, WHITE, WHITE);
            pointAt(add, 0);
            spotAt(add, 0);
            add.addSphere(0, 0, 0, WHITE, WHITE, WHITE, RANGE, SPHERE_RADIUS, CASTS);
            add.addTube(0, 0, 0, 1, 0, 0, WHITE, WHITE, WHITE, RANGE, TUBE_HALF_LENGTH, SPHERE_RADIUS, CASTS);
            add.addRect(0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, WHITE, WHITE, WHITE, RANGE, RECT_HALF_WIDTH, RECT_HALF_HEIGHT, CASTS);
        });
        expect(Array.from({length: lights.count}, (_, light) => usesCubeShadow(lights.kind[light]))).toEqual([false, true, false, true, true, true]);
        expect(Array.from({length: lights.count - 1}, (_, light) => shadowReachOf(lights, light + 1)))
            .toEqual([RANGE, RANGE, RANGE + SPHERE_RADIUS, RANGE + SPHERE_RADIUS + TUBE_HALF_LENGTH, RANGE + Math.hypot(RECT_HALF_WIDTH, RECT_HALF_HEIGHT)]);
        expect(lights.kind[0]).toBe(LIGHT_KIND_DIRECTIONAL);
    });

    test("the budget caps the total and the cube maps; once the cubes are spent, a farther spot still takes a free slot", () => {
        const lights = lightsOf(add => {
            add.addDirectional(0, -1, 0, WHITE, WHITE, WHITE);
            pointAt(add, 1);
            pointAt(add, 2);
            pointAt(add, 3);
            spotAt(add, 4);
            spotAt(add, 5);
        });
        const selection = new GpuShadowSelection();
        selection.select(lights, BUDGET, CUBE_BUDGET, ...CAMERA);
        expect(selected(selection)).toEqual([0, 1, 2, 4, 5]);
        selection.select(lights, 3, CUBE_BUDGET, ...CAMERA);
        expect(selected(selection)).toEqual([0, 1, 2]);
        selection.select(lights, 3, 0, ...CAMERA);
        expect(selected(selection)).toEqual([0, 4, 5]);
        selection.select(lights, 0, CUBE_BUDGET, ...CAMERA);
        expect(selected(selection)).toEqual([]);
    });

    test("a light keeps its shadow while a rival is only a little closer, and loses it once the rival is clearly closer, so shadows do not flicker", () => {
        const selection = new GpuShadowSelection();
        const at = (rivalX: number) => lightsOf(add => {
            pointAt(add, NEAR_LIGHT_X);
            pointAt(add, rivalX);
        });
        selection.select(at(NEAR_LIGHT_X + 1), 1, 1, ...CAMERA);
        expect(selected(selection)).toEqual([0]);
        selection.select(at(NEAR_LIGHT_X - HYSTERESIS_STEP), 1, 1, ...CAMERA);
        expect(selected(selection)).toEqual([0]);
        selection.select(at(NEAR_LIGHT_X + HYSTERESIS_STEP), 1, 1, ...CAMERA);
        expect(selected(selection)).toEqual([0]);
        selection.select(at(NEAR_LIGHT_X - 3 * HYSTERESIS_STEP), 1, 1, ...CAMERA);
        expect(selected(selection)).toEqual([1]);
        selection.select(at(NEAR_LIGHT_X - HYSTERESIS_STEP), 1, 1, ...CAMERA);
        expect(selected(selection)).toEqual([1]);
        selection.clear();
        selection.select(at(NEAR_LIGHT_X - HYSTERESIS_STEP), 1, 1, ...CAMERA);
        expect(selected(selection)).toEqual([1]);
        selection.clear();
        selection.select(at(NEAR_LIGHT_X + HYSTERESIS_STEP), 1, 1, ...CAMERA);
        expect(selected(selection)).toEqual([0]);
    });

    test("selection grows past its starting capacity and stays ordered", () => {
        const many = 40;
        const lights = lightsOf(add => {
            for (let i = many; i > 0; i--) pointAt(add, i);
        });
        const selection = new GpuShadowSelection();
        selection.select(lights, many, many, ...CAMERA);
        expect(selected(selection)).toEqual(Array.from({length: many}, (_, rank) => many - 1 - rank));
    });
});
