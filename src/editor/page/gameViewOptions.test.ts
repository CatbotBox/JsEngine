import {describe, expect, test} from "../../engine/testing/harness";
import {gameStatsLines, tickRates} from "./gameStats";
import {DEFAULT_GAME_VIEW_OPTIONS, gameViewOptionsText, isLayoutMaximized, parseGameViewOptions, withGameViewOption} from "./gameViewOptions";

describe("game view options", () => {
    test("round-trip through storage text, and anything unreadable falls back to the defaults", () => {
        const options = withGameViewOption(DEFAULT_GAME_VIEW_OPTIONS, {option: "maximizeOnPlay", enabled: true});
        expect(parseGameViewOptions(gameViewOptionsText(options))).toEqual({maximizeOnPlay: true, stats: false});
        expect(parseGameViewOptions(null)).toEqual(DEFAULT_GAME_VIEW_OPTIONS);
        expect(parseGameViewOptions("not json")).toEqual(DEFAULT_GAME_VIEW_OPTIONS);
        expect(parseGameViewOptions(`{"stats": "yes", "maximizeOnPlay": true}`)).toEqual({maximizeOnPlay: true, stats: false});
    });

    test("the layout is maximized while playing or paused, only when the option is on", () => {
        const on = withGameViewOption(DEFAULT_GAME_VIEW_OPTIONS, {option: "maximizeOnPlay", enabled: true});
        expect([isLayoutMaximized(on, "edit"), isLayoutMaximized(on, "play"), isLayoutMaximized(on, "paused")]).toEqual([false, true, true]);
        expect(isLayoutMaximized(DEFAULT_GAME_VIEW_OPTIONS, "play")).toBe(false);
    });
});

describe("game stats", () => {
    test("rates come from the tick counters between two polls", () => {
        const rates = tickRates({ticks: 100, tickMsTotal: 200, timeMs: 1000}, {ticks: 130, tickMsTotal: 260, timeMs: 1500});
        expect(rates?.ticksPerSecond).toBe(60);
        expect(rates?.averageTickMs).toBe(2);
        expect(tickRates({ticks: 5, tickMsTotal: 0, timeMs: 1000}, {ticks: 5, tickMsTotal: 0, timeMs: 1500})).toEqual({ticksPerSecond: 0, averageTickMs: 0});
    });

    test("a restarted world or a stalled clock gives no rate rather than a wrong one", () => {
        expect(tickRates({ticks: 100, tickMsTotal: 0, timeMs: 1000}, {ticks: 3, tickMsTotal: 0, timeMs: 1500})).toBeUndefined();
        expect(tickRates({ticks: 1, tickMsTotal: 0, timeMs: 1000}, {ticks: 2, tickMsTotal: 0, timeMs: 1000})).toBeUndefined();
    });

    test("the overlay lines name each stat, and say when the rate is still being measured", () => {
        expect(gameStatsLines({rates: {ticksPerSecond: 59.94, averageTickMs: 1.234}, entityCount: 12, viewportWidthPx: 640, viewportHeightPx: 360, targetLabel: "Window (GPU)"})).toEqual([
            "Ticks/s 59.9",
            "Tick 1.23 ms",
            "Entities 12",
            "Viewport 640×360",
            "Target Window (GPU)",
        ]);
        expect(gameStatsLines({rates: undefined, entityCount: 0, viewportWidthPx: 0, viewportHeightPx: 0, targetLabel: ""})).toEqual([
            "Ticks/s measuring…",
            "Tick measuring…",
            "Entities 0",
            "Viewport 0×0",
        ]);
    });
});
