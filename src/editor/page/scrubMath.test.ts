import {describe, expect, test} from "../../engine/testing/harness";
import {
    arrowStepDirection,
    baseStepFor,
    decimalsOfIncrement,
    NO_MODIFIERS,
    roundToIncrement,
    scrubbedValue,
    scrubUnitsPerPixelForStep,
    steppedValue,
    wheelStepDirection,
} from "./scrubMath";

const FASTER = {faster: true, slower: false};
const SLOWER = {faster: false, slower: true};
const BOTH = {faster: true, slower: true};

describe("scrub maths", () => {
    test("dragging a label right raises a number by 0.05 per pixel, rounded to that increment", () => {
        expect(scrubbedValue(1, 10, NO_MODIFIERS, "number")).toBe(1.5);
        expect(scrubbedValue(1, -20, NO_MODIFIERS, "number")).toBe(0);
        expect(scrubbedValue(0.1, 3, NO_MODIFIERS, "number")).toBe(0.25);
    });

    test("Shift is ten times faster and Alt ten times slower, both together cancel", () => {
        expect(scrubbedValue(0, 10, FASTER, "number")).toBe(5);
        expect(scrubbedValue(0, 10, SLOWER, "number")).toBe(0.05);
        expect(scrubbedValue(0, 10, BOTH, "number")).toBe(0.5);
    });

    test("integers round to whole numbers and degrees move half a degree per pixel", () => {
        expect(scrubbedValue(3, 7, NO_MODIFIERS, "integer")).toBe(4);
        expect(scrubbedValue(3, -2, NO_MODIFIERS, "integer")).toBe(3);
        expect(scrubbedValue(90, 30, NO_MODIFIERS, "degrees")).toBe(105);
    });

    test("no movement keeps the start value exactly and a non-finite start scrubs from zero", () => {
        expect(scrubbedValue(1.23456, 0, NO_MODIFIERS, "number")).toBe(1.23456);
        expect(scrubbedValue(Number.NaN, 4, NO_MODIFIERS, "number")).toBe(0.2);
        expect(scrubbedValue(Number.POSITIVE_INFINITY, -4, NO_MODIFIERS, "number")).toBe(-0.2);
    });

    test("stepping adds one step in the direction, with the same modifiers", () => {
        expect(steppedValue(1, 1, NO_MODIFIERS, "number")).toBe(1.1);
        expect(steppedValue(1, -1, FASTER, "number")).toBe(0);
        expect(steppedValue(1, 1, SLOWER, "number")).toBe(1.01);
        expect(steppedValue(5, 1, NO_MODIFIERS, "integer")).toBe(6);
        expect(steppedValue(5, -1, SLOWER, "integer")).toBe(4);
        expect(steppedValue(5, 1, FASTER, "integer")).toBe(15);
        expect(steppedValue(0.1, 1, NO_MODIFIERS, "number")).toBe(0.2);
    });

    test("a field's step option sets the step and scales the scrub speed with it", () => {
        expect(baseStepFor(undefined, "number")).toBe(0.1);
        expect(baseStepFor(0, "integer")).toBe(1);
        expect(baseStepFor(5, "integer")).toBe(5);
        expect(steppedValue(10, 1, NO_MODIFIERS, "integer", baseStepFor(5, "integer"))).toBe(15);
        expect(steppedValue(1, -1, FASTER, "number", baseStepFor(0.5, "number"))).toBe(-4);
        expect(scrubUnitsPerPixelForStep(undefined, "number")).toBe(0.05);
        expect(scrubUnitsPerPixelForStep(1, "number")).toBe(0.5);
        expect(scrubbedValue(0, 10, NO_MODIFIERS, "number", scrubUnitsPerPixelForStep(1, "number"))).toBe(5);
    });

    test("wheel and arrow keys map to step directions", () => {
        expect(wheelStepDirection(-100)).toBe(1);
        expect(wheelStepDirection(3)).toBe(-1);
        expect(wheelStepDirection(0)).toBeUndefined();
        expect(arrowStepDirection("ArrowUp")).toBe(1);
        expect(arrowStepDirection("ArrowDown")).toBe(-1);
        expect(arrowStepDirection("ArrowLeft")).toBeUndefined();
    });

    test("rounding keeps as many decimals as the increment needs", () => {
        expect(decimalsOfIncrement(0.05)).toBe(2);
        expect(decimalsOfIncrement(0.1)).toBe(1);
        expect(decimalsOfIncrement(1)).toBe(0);
        expect(decimalsOfIncrement(10)).toBe(0);
        expect(roundToIncrement(0.30000000000000004, 0.1)).toBe(0.3);
        expect(Object.is(roundToIncrement(-0.0001, 0.1), 0)).toBe(true);
    });
});
