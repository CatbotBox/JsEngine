import {describe, expect, test} from "../../engine/testing/harness";
import {DEFAULT_SNAP_STEPS, parseSnapEnabled, parseSnapSteps, snapsThisDrag, SNAP_KINDS, SNAP_STEP_PRESETS, snapStepChoices, snapStepsText, snapStepText, withSnapStep} from "./snapSteps";

describe("snap steps", () => {
    test("the defaults are the steps Ctrl-snapping used before they became editor state", () => {
        expect(DEFAULT_SNAP_STEPS).toEqual({move2d: 1, move3d: 0.25, rotateDegrees: 15, scale: 0.1});
        for (const kind of SNAP_KINDS) expect(SNAP_STEP_PRESETS[kind].includes(DEFAULT_SNAP_STEPS[kind])).toBe(true);
    });

    test("stored steps round-trip, and missing, broken or non-positive values fall back to the defaults", () => {
        const steps = withSnapStep(DEFAULT_SNAP_STEPS, {kind: "rotateDegrees", step: 45});
        expect(parseSnapSteps(snapStepsText(steps))).toEqual(steps);
        expect(parseSnapSteps(null)).toEqual(DEFAULT_SNAP_STEPS);
        expect(parseSnapSteps("{not json")).toEqual(DEFAULT_SNAP_STEPS);
        expect(parseSnapSteps(JSON.stringify({move2d: -1, move3d: "big", scale: 0.5}))).toEqual({...DEFAULT_SNAP_STEPS, scale: 0.5});
    });

    test("every preset is a choice, named with its unit", () => {
        expect(snapStepChoices().length).toBe(SNAP_KINDS.reduce((count, kind) => count + SNAP_STEP_PRESETS[kind].length, 0));
        expect([
            snapStepText({kind: "move2d", step: 1}),
            snapStepText({kind: "move3d", step: 0.25}),
            snapStepText({kind: "rotateDegrees", step: 15}),
            snapStepText({kind: "scale", step: 0.1}),
        ]).toEqual(["1 unit", "0.25 units", "15°", "0.1"]);
    });

    test("snapping starts off and reads back what was stored", () => {
        expect(parseSnapEnabled(null)).toBe(false);
        expect(parseSnapEnabled("true")).toBe(true);
        expect(parseSnapEnabled("false")).toBe(false);
        expect(parseSnapEnabled("garbage")).toBe(false);
    });

    test("holding Ctrl flips snapping for the drag", () => {
        expect(snapsThisDrag(false, false)).toBe(false);
        expect(snapsThisDrag(false, true)).toBe(true);
        expect(snapsThisDrag(true, false)).toBe(true);
        expect(snapsThisDrag(true, true)).toBe(false);
    });
});
