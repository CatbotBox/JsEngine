import {describe, expect, test} from "../../testing/harness";
import {Vec, Vec4} from "../../math/types/vec";
import {LocalToWorld} from "../../translation/localToWorld";
import {ScreenProjectedBounds} from "./screenProjectedBounds";

const SCREEN_WIDTH = 200;
const SCREEN_HEIGHT = 100;
const FOCAL_LENGTH = 100;
const SQUARE_CELLS = 1;
const TALL_CELLS = 2;
const ORTHOGRAPHIC: number | undefined = undefined;

function projector(focalLength: number | undefined, cellRatio: number = SQUARE_CELLS, view = LocalToWorld.identity()): ScreenProjectedBounds {
    const projected = new ScreenProjectedBounds();
    projected.begin(view, focalLength, cellRatio, SCREEN_WIDTH, SCREEN_HEIGHT);
    return projected;
}

describe("ScreenProjectedBounds", () => {
    test("a box in front projects to the screen rectangle its nearest corners span", () => {
        const projected = projector(FOCAL_LENGTH);
        expect(projected.project(-1, -1, 4, 1, 1, 5)).toBe(true);
        expect([projected.width, projected.height]).toEqual([50, 50]);
    });

    test("a box behind the camera or entirely off screen is not visible", () => {
        expect(projector(FOCAL_LENGTH).project(-1, -1, -5, 1, 1, -4)).toBe(false);
        expect(projector(FOCAL_LENGTH).project(50, -1, 4, 52, 1, 5)).toBe(false);
        expect(projector(FOCAL_LENGTH).project(-1, 30, 4, 1, 32, 5)).toBe(false);
    });

    test("a box straddling the near plane is visible and its projection is clipped to the screen", () => {
        const projected = projector(FOCAL_LENGTH);
        expect(projected.project(-1, -1, -1, 1, 1, 2)).toBe(true);
        expect([projected.width, projected.height]).toEqual([SCREEN_WIDTH, SCREEN_HEIGHT]);
    });

    test("without a focal length one unit is one pixel, stretched horizontally by the cell ratio", () => {
        const projected = projector(ORTHOGRAPHIC, TALL_CELLS);
        expect(projected.project(-10, -5, 1, 10, 5, 2)).toBe(true);
        expect([projected.width, projected.height]).toEqual([40, 10]);
    });

    test("the view matrix moves the box into view space first", () => {
        const view = LocalToWorld.fromTRS(LocalToWorld.identity(), Vec.alloc3(0, 0, 4), Vec4.alloc(0, 0, 0, 1), Vec.alloc3(1, 1, 1));
        const projected = projector(FOCAL_LENGTH, SQUARE_CELLS, view);
        expect(projected.project(-1, -1, 0, 1, 1, 1)).toBe(true);
        expect([projected.width, projected.height]).toEqual([50, 50]);
    });
});
