import {describe, expect, test} from "../../engine/testing/harness";
import {identityMat4, orthographicWorldToScreen, perspectiveWorldToScreen} from "../world/viewMath";
import {
    amountAlongScreenAxis,
    distanceToSegmentPx,
    layoutRectOf,
    overlayPointOf,
    overlayScaleOf,
    pointerAngleRadians,
    pointOnViewPlane,
    projectedBoundsRect,
    projectedBoxEdges,
    projectPoint,
    screenAxisPx,
    screenPointOf,
    viewAxisOf,
    viewPlaneDelta,
    wrapAngleRadians,
} from "./viewProjection";
import type {ViewInfoGeometry} from "./viewProjection";

const DIGITS = 5;
const SCREEN_WIDTH = 80;
const SCREEN_HEIGHT = 40;
const RIGHT_ANGLE_DEGREES = 90;

const ORTHOGRAPHIC: ViewInfoGeometry = {
    projection: "orthographic",
    worldToScreen: orthographicWorldToScreen([5, 5, 0], 20, 10),
    screenWidth: 20,
    screenHeight: 10,
    camera: {position: [5, 5, 0], rotation: [0, 0, 0, 1]},
};

const PERSPECTIVE: ViewInfoGeometry = {
    projection: "perspective",
    worldToScreen: perspectiveWorldToScreen(identityMat4(), Math.PI / 2, SCREEN_WIDTH, SCREEN_HEIGHT),
    screenWidth: SCREEN_WIDTH,
    screenHeight: SCREEN_HEIGHT,
    camera: {position: [0, 0, 0], rotation: [0, 0, 0, 1], fieldOfViewDegrees: RIGHT_ANGLE_DEGREES},
};

describe("projecting through worldToScreen", () => {
    test("the orthographic camera's position is the screen centre, one world unit per screen unit", () => {
        const centre = projectPoint(ORTHOGRAPHIC.worldToScreen, [5, 5, 0]);
        expect([centre.x, centre.y, centre.w]).toEqual([10, 5, 1]);
        expect(projectedBoundsRect(ORTHOGRAPHIC.worldToScreen, [4, 4, 0], [6, 7, 0])).toEqual({left: 9, top: 4, right: 11, bottom: 7});
    });

    test("perspective divides by view depth: 90 degrees of field of view, a two-to-one screen unit", () => {
        const centre = projectPoint(PERSPECTIVE.worldToScreen, [0, 0, 10]);
        expect(centre.x).toBeCloseTo(40, DIGITS);
        expect(centre.y).toBeCloseTo(20, DIGITS);
        expect(centre.w).toBeCloseTo(10, DIGITS);
        const right = projectPoint(PERSPECTIVE.worldToScreen, [5, 5, 10]);
        expect(right.x).toBeCloseTo(60, DIGITS);
        expect(right.y).toBeCloseTo(10, DIGITS);
    });

    test("an outline skips corners behind the camera and is absent when the whole box is", () => {
        expect(projectedBoundsRect(PERSPECTIVE.worldToScreen, [-1, -1, -5], [1, 1, -3])).toBeUndefined();
        const partial = projectedBoundsRect(PERSPECTIVE.worldToScreen, [-1, -1, -5], [1, 1, 10])!;
        expect(partial.left).toBeCloseTo(36, DIGITS);
        expect(partial.right).toBeCloseTo(44, DIGITS);
        expect(projectedBoxEdges(PERSPECTIVE.worldToScreen, [-1, -1, 5], [1, 1, 6]).length).toBe(12);
        expect(projectedBoxEdges(PERSPECTIVE.worldToScreen, [-1, -1, -5], [1, 1, 6]).length).toBe(4);
    });
});

describe("overlay pixels and screen units", () => {
    const scale = overlayScaleOf(ORTHOGRAPHIC, {left: 110, top: 220, width: 160, height: 160}, {left: 100, top: 200, width: 300, height: 300})!;

    test("the canvas offset and size give the overlay's pixels per screen unit", () => {
        expect(scale).toEqual({originLeftPx: 10, originTopPx: 20, pxPerUnitX: 8, pxPerUnitY: 16});
        expect(overlayPointOf(scale, {x: 2, y: 1})).toEqual({x: 26, y: 36});
        expect(screenPointOf(scale, {x: 26, y: 36})).toEqual({x: 2, y: 1});
    });

    test("a zoomed page's visual rects map back to layout pixels before the overlay scale is taken", () => {
        const zoom = 2;
        const zoomed = overlayScaleOf(ORTHOGRAPHIC,
            layoutRectOf({left: 220, top: 440, width: 320, height: 320}, zoom),
            layoutRectOf({left: 200, top: 400, width: 600, height: 600}, zoom));
        expect(zoomed).toEqual(scale);
    });

    test("there is no scale before the world reports a screen size", () => {
        expect(overlayScaleOf({screenWidth: 0, screenHeight: 0}, {left: 0, top: 0, width: 10, height: 10}, {left: 0, top: 0, width: 10, height: 10})).toBeUndefined();
    });

    test("a world axis projects to overlay pixels per world unit", () => {
        expect(screenAxisPx(ORTHOGRAPHIC.worldToScreen, scale, [0, 0, 0], [1, 0, 0])!.x).toBeCloseTo(8, DIGITS);
        expect(screenAxisPx(ORTHOGRAPHIC.worldToScreen, scale, [0, 0, 0], [0, 1, 0])!.y).toBeCloseTo(16, DIGITS);
        expect(amountAlongScreenAxis({x: 8, y: 0}, {x: 16, y: 5})).toBe(2);
        expect(amountAlongScreenAxis({x: 0, y: 0}, {x: 16, y: 5})).toBe(0);
    });
});

describe("dragging on the view plane", () => {
    test("orthographic drags move one world unit per screen unit", () => {
        expect(viewPlaneDelta(ORTHOGRAPHIC, 1, 3, -2)).toEqual([3, -2, 0]);
        expect(pointOnViewPlane(ORTHOGRAPHIC, {x: 0, y: 0}, 0)).toEqual([-5, 0, 0]);
        expect(viewAxisOf(ORTHOGRAPHIC)).toEqual([0, 0, 1]);
    });

    test("a perspective drag moves the point so it stays under the pointer at its depth", () => {
        const delta = viewPlaneDelta(PERSPECTIVE, 10, 4, 2);
        expect(delta[0]).toBeCloseTo(1, DIGITS);
        expect(delta[1]).toBeCloseTo(-1, DIGITS);
        expect(delta[2]).toBeCloseTo(0, DIGITS);
        const moved = projectPoint(PERSPECTIVE.worldToScreen, [delta[0], delta[1], 10]);
        expect(moved.x).toBeCloseTo(44, DIGITS);
        expect(moved.y).toBeCloseTo(22, DIGITS);
        const dropped = pointOnViewPlane(PERSPECTIVE, {x: 44, y: 22}, 10);
        expect(dropped[0]).toBeCloseTo(1, DIGITS);
        expect(dropped[1]).toBeCloseTo(-1, DIGITS);
        expect(dropped[2]).toBeCloseTo(10, DIGITS);
    });
});

describe("pointer geometry", () => {
    test("angles are measured clockwise on screen and wrapped to half a turn", () => {
        expect(pointerAngleRadians({x: 0, y: 0}, {x: 0, y: 1})).toBeCloseTo(Math.PI / 2, DIGITS);
        expect(wrapAngleRadians(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2, DIGITS);
        expect(wrapAngleRadians(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2, DIGITS);
    });

    test("the distance to a segment clamps to its ends", () => {
        const segment = {from: {x: 0, y: 0}, to: {x: 10, y: 0}};
        expect(distanceToSegmentPx({x: 5, y: 3}, segment)).toBe(3);
        expect(distanceToSegmentPx({x: 13, y: 4}, segment)).toBe(5);
    });
});
