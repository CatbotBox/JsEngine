import {describe, expect, test} from "../../engine/testing/harness";
import {FREE_ASPECT, fittedAspectRect, GAME_VIEW_ASPECTS, gameViewAspectOf} from "./gameViewAspect";

const WIDESCREEN = 16 / 9;

describe("game view aspect", () => {
    test("a wide area letterboxes left and right, a tall one top and bottom, both centred", () => {
        expect(fittedAspectRect(1000, 360, WIDESCREEN)).toEqual({left: 180, top: 0, width: 640, height: 360});
        expect(fittedAspectRect(640, 1000, WIDESCREEN)).toEqual({left: 0, top: 320, width: 640, height: 360});
    });

    test("the frame never exceeds the area and has whole pixels", () => {
        const frame = fittedAspectRect(801, 451, WIDESCREEN);
        expect(frame.width <= 801 && frame.height <= 451).toBe(true);
        expect([frame.left, frame.top, frame.width, frame.height].every(Number.isInteger)).toBe(true);
    });

    test("an empty area or a broken ratio gives an empty frame", () => {
        expect(fittedAspectRect(0, 400, WIDESCREEN)).toEqual({left: 0, top: 0, width: 0, height: 0});
        expect(fittedAspectRect(400, 400, Number.NaN)).toEqual({left: 0, top: 0, width: 0, height: 0});
    });

    test("ids resolve to their aspect and anything unknown is the free aspect", () => {
        expect(gameViewAspectOf("4:3").widthToHeight).toBe(4 / 3);
        expect(gameViewAspectOf(null)).toBe(FREE_ASPECT);
        expect(gameViewAspectOf("21:9")).toBe(FREE_ASPECT);
        expect(new Set(GAME_VIEW_ASPECTS.map(aspect => aspect.id)).size).toBe(GAME_VIEW_ASPECTS.length);
    });
});
