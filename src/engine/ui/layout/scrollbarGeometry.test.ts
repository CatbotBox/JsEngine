import {describe, expect, test} from "../../testing/harness";
import {
    clampScrollOffset,
    maxScrollOffset,
    MIN_SCROLLBAR_THUMB_UNITS,
    NO_SCROLLBAR_UNITS,
    pagedScrollOffset,
    revealScrollDelta,
    SCROLLBAR_THICKNESS_UNITS,
    scrollbarReservation,
    scrollbarThumbLength,
    scrollbarThumbStart,
    scrollPerThumbUnit,
    wheelScrollOffset,
} from "./scrollbarGeometry";

const TRACK_START = 2;
const TRACK = 4;
const VIEWPORT = 4;
const CONTENT = 10;
const MAX_SCROLL = CONTENT - VIEWPORT;
const WHEEL_STEP = 3;
const NOTCH_UP = 1;
const NOTCH_DOWN = -1;

describe("scrollbar geometry", () => {
    test("always reserves a unit, never reserves none, auto reserves only on overflow", () => {
        expect([scrollbarReservation("always", false), scrollbarReservation("always", true)]).toEqual([SCROLLBAR_THICKNESS_UNITS, SCROLLBAR_THICKNESS_UNITS]);
        expect([scrollbarReservation("never", false), scrollbarReservation("never", true)]).toEqual([NO_SCROLLBAR_UNITS, NO_SCROLLBAR_UNITS]);
        expect([scrollbarReservation("auto", false), scrollbarReservation("auto", true)]).toEqual([NO_SCROLLBAR_UNITS, SCROLLBAR_THICKNESS_UNITS]);
    });

    test("the scroll range is what the content overhangs the viewport, and offsets clamp into it", () => {
        expect(maxScrollOffset(CONTENT, VIEWPORT)).toBe(MAX_SCROLL);
        expect(maxScrollOffset(VIEWPORT - 1, VIEWPORT)).toBe(0);
        expect([clampScrollOffset(-1, MAX_SCROLL), clampScrollOffset(3, MAX_SCROLL), clampScrollOffset(50, MAX_SCROLL)]).toEqual([0, 3, MAX_SCROLL]);
    });

    test("the thumb is the viewport's share of the track in whole units, at least one, the whole track without overflow", () => {
        expect(scrollbarThumbLength(TRACK, VIEWPORT, CONTENT)).toBe(2);
        expect(scrollbarThumbLength(TRACK, VIEWPORT, 1000)).toBe(MIN_SCROLLBAR_THUMB_UNITS);
        expect(scrollbarThumbLength(TRACK, VIEWPORT, VIEWPORT)).toBe(TRACK);
    });

    test("the thumb sits along the track in proportion to the offset over the scroll range", () => {
        const thumb = scrollbarThumbLength(TRACK, VIEWPORT, CONTENT);
        expect(scrollbarThumbStart(TRACK_START, TRACK, thumb, 0, MAX_SCROLL)).toBe(TRACK_START);
        expect(scrollbarThumbStart(TRACK_START, TRACK, thumb, MAX_SCROLL / 2, MAX_SCROLL)).toBe(TRACK_START + 1);
        expect(scrollbarThumbStart(TRACK_START, TRACK, thumb, MAX_SCROLL, MAX_SCROLL)).toBe(TRACK_START + TRACK - thumb);
        expect(scrollbarThumbStart(TRACK_START, TRACK, TRACK, 0, 0)).toBe(TRACK_START);
    });

    test("one unit of thumb travel scrolls the range over the free track, and a full thumb scrolls nothing", () => {
        expect(scrollPerThumbUnit(TRACK, 2, MAX_SCROLL)).toBe(MAX_SCROLL / 2);
        expect(scrollPerThumbUnit(TRACK, TRACK, MAX_SCROLL)).toBe(0);
    });

    test("paging moves a page toward the pointer and clamps", () => {
        expect(pagedScrollOffset(0, VIEWPORT, true, MAX_SCROLL)).toBe(VIEWPORT);
        expect(pagedScrollOffset(VIEWPORT, VIEWPORT, true, MAX_SCROLL)).toBe(MAX_SCROLL);
        expect(pagedScrollOffset(VIEWPORT, VIEWPORT, false, MAX_SCROLL)).toBe(0);
    });

    test("a wheel notch down scrolls toward the end by the step, a notch up toward the start, both clamped", () => {
        expect(wheelScrollOffset(0, NOTCH_DOWN, WHEEL_STEP, MAX_SCROLL)).toBe(WHEEL_STEP);
        expect(wheelScrollOffset(WHEEL_STEP, NOTCH_DOWN * 2, WHEEL_STEP, MAX_SCROLL)).toBe(MAX_SCROLL);
        expect(wheelScrollOffset(WHEEL_STEP, NOTCH_UP, WHEEL_STEP, MAX_SCROLL)).toBe(0);
        expect(wheelScrollOffset(0, NOTCH_UP, WHEEL_STEP, MAX_SCROLL)).toBe(0);
    });

    test("revealing a span moves it the least distance into the view, start first when it does not fit", () => {
        expect(revealScrollDelta(1, 2, 0, 4)).toBe(0);
        expect(revealScrollDelta(-3, -2, 0, 4)).toBe(-3);
        expect(revealScrollDelta(6, 7, 0, 4)).toBe(3);
        expect(revealScrollDelta(2, 9, 0, 4)).toBe(2);
    });
});
