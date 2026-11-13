import {describe, expect, test} from "../testing/harness";
import {anchorFractionX, anchorFractionY, anchoredStart} from "./screenAnchor";

const SCREEN_EXTENT = 100;
const ELEMENT_EXTENT = 11;

describe("anchoredStart", () => {
    test("places an element at the start, centre or end of the screen, rounding down", () => {
        expect(anchoredStart(anchorFractionX("top-left"), SCREEN_EXTENT, ELEMENT_EXTENT)).toBe(0);
        expect(anchoredStart(anchorFractionX("top-center"), SCREEN_EXTENT, ELEMENT_EXTENT)).toBe(44);
        expect(anchoredStart(anchorFractionX("top-right"), SCREEN_EXTENT, ELEMENT_EXTENT)).toBe(89);
        expect(anchoredStart(anchorFractionY("bottom-left"), SCREEN_EXTENT, ELEMENT_EXTENT)).toBe(89);
    });

    test("is unit-free: the same fraction in pixels lands on the scaled start", () => {
        const pixelsPerUnit = 8;
        expect(anchoredStart(1, SCREEN_EXTENT * pixelsPerUnit, ELEMENT_EXTENT * pixelsPerUnit)).toBe(89 * pixelsPerUnit);
    });

    test("an element larger than the screen starts before it", () => {
        expect(anchoredStart(anchorFractionX("middle-center"), 10, 13)).toBe(-2);
    });
});
