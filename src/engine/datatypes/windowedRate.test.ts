import {describe, expect, test} from "../testing/harness";
import {RateWindow, WindowedCount} from "./windowedRate";

const START_MS = 100;
const WINDOW_MS = 500;

describe("RateWindow", () => {
    test("stays open until the minimum length has passed", () => {
        const window = new RateWindow(START_MS);

        expect(window.tryClose(START_MS + WINDOW_MS - 1, WINDOW_MS)).toBe(false);
        expect(window.lengthMs).toBe(0);
    });

    test("closing records the actual length and starts the next window there", () => {
        const window = new RateWindow(START_MS);

        expect(window.tryClose(START_MS + 600, WINDOW_MS)).toBe(true);
        expect(window.lengthMs).toBe(600);
        expect(window.tryClose(START_MS + 600 + WINDOW_MS, WINDOW_MS)).toBe(true);
        expect(window.lengthMs).toBe(WINDOW_MS);
    });
});

describe("WindowedCount", () => {
    test("reports zero before any window closes", () => {
        const count = new WindowedCount();

        expect(count.delta).toBe(0);
        expect(count.perSecond).toBe(0);
    });

    test("measures the growth of a running total over each window", () => {
        const frames = new WindowedCount();
        frames.closeWindow(30, WINDOW_MS);
        expect(frames.delta).toBe(30);
        expect(frames.perSecond).toBe(60);

        frames.closeWindow(40, WINDOW_MS);
        expect(frames.delta).toBe(10);
        expect(frames.perSecond).toBe(20);
    });

    test("deltaPer divides by another count's delta and is zero when that delta is", () => {
        const submits = new WindowedCount();
        const bytes = new WindowedCount();
        submits.closeWindow(4, WINDOW_MS);
        bytes.closeWindow(1000, WINDOW_MS);
        expect(bytes.deltaPer(submits)).toBe(250);

        submits.closeWindow(4, WINDOW_MS);
        bytes.closeWindow(1000, WINDOW_MS);
        expect(bytes.deltaPer(submits)).toBe(0);
    });
});
