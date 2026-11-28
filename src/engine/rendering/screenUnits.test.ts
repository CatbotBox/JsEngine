import {describe, expect, test} from "../testing/harness";
import {pointerWorldPositionInto, SCREEN_UNIT_HEIGHT_PER_WIDTH, WorldViewRect, worldViewRectInto} from "./screenUnits";

const SCREEN_WIDTH = 80;
const SCREEN_HEIGHT = 24;
const CAMERA_X = 10;
const CAMERA_Y = -6;

describe("worldViewRectInto", () => {
    test("spans the screen width by twice the screen height in world units, centred on the camera", () => {
        const view = worldViewRectInto(new WorldViewRect(), CAMERA_X, CAMERA_Y, SCREEN_WIDTH, SCREEN_HEIGHT);
        expect([view.widthUnits, view.heightUnits]).toEqual([80, 48]);
        expect([view.xMin, view.xMax, view.yMin, view.yMax]).toEqual([-30, 50, -30, 18]);
    });

    test("writes into and returns the rect it is given", () => {
        const out = new WorldViewRect();
        expect(worldViewRectInto(out, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT)).toBe(out);
        worldViewRectInto(out, CAMERA_X, CAMERA_Y, 1, 1);
        expect([out.xMin, out.yMin, out.xMax, out.yMax]).toEqual([9.5, -7, 10.5, -5]);
    });

    test("a fractional screen keeps its fraction", () => {
        const view = worldViewRectInto(new WorldViewRect(), 0, 0, 80.5, 24.25);
        expect([view.xMin, view.yMin, view.widthUnits, view.heightUnits]).toEqual([-40.25, -24.25, 80.5, 48.5]);
    });
});

describe("pointerWorldPositionInto", () => {
    test("maps a pointer cell to the world: one unit per column, two per row", () => {
        const view = worldViewRectInto(new WorldViewRect(), CAMERA_X, CAMERA_Y, SCREEN_WIDTH, SCREEN_HEIGHT);
        const out = {x: 0, y: 0};
        expect(pointerWorldPositionInto(out, view, 0, 0)).toBe(out);
        expect(out).toEqual({x: view.xMin, y: view.yMin});
        pointerWorldPositionInto(out, view, SCREEN_WIDTH, SCREEN_HEIGHT);
        expect(out).toEqual({x: view.xMax, y: view.yMax});
        pointerWorldPositionInto(out, view, 40, 12.5);
        expect(out).toEqual({x: CAMERA_X, y: CAMERA_Y + 0.5 * SCREEN_UNIT_HEIGHT_PER_WIDTH});
    });

    test("the screen centre is the camera position", () => {
        const view = worldViewRectInto(new WorldViewRect(), CAMERA_X, CAMERA_Y, SCREEN_WIDTH, SCREEN_HEIGHT);
        expect(pointerWorldPositionInto({x: 0, y: 0}, view, SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2)).toEqual({x: CAMERA_X, y: CAMERA_Y});
    });
});
