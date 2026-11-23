import {describe, expect, test} from "../testing/harness";
import {FrameLoop, MAX_FRAME_DELTA_MS, snapToWholeTicks, TICK_SNAP_TOLERANCE_MS} from "./frameLoop";
import type {FrameAdvance} from "./frameLoop";

const MS_PER_SECOND = 1000;
const TICK_RATE = 60;
const TICK_MS = MS_PER_SECOND / TICK_RATE;
const ROUND_TICK_MS = 10;
const MAX_TICKS_PER_FRAME = 5;
const START_MS = 1000;
const ALPHA_DIGITS = 6;

function loopStartedAt(startMs: number, tickMs: number = TICK_MS, maxTicksPerFrame: number = MAX_TICKS_PER_FRAME): FrameLoop {
    const loop = new FrameLoop(tickMs, maxTicksPerFrame);
    loop.start(startMs);
    return loop;
}

function advanceBy(loop: FrameLoop, clock: {nowMs: number}, deltaMs: number): FrameAdvance {
    clock.nowMs += deltaMs;
    return loop.advance(clock.nowMs);
}

describe("FrameLoop", () => {
    test("a frame one tick long runs exactly one tick and carries nothing", () => {
        const loop = loopStartedAt(START_MS);
        const advance = loop.advance(START_MS + TICK_MS);
        expect([advance.ticks, advance.alpha]).toEqual([1, 0]);
        expect(advance.frameDeltaMs).toBeCloseTo(TICK_MS, ALPHA_DIGITS);
    });

    test("a frame shorter than a tick runs no tick and carries its time as alpha", () => {
        const loop = loopStartedAt(START_MS, ROUND_TICK_MS);
        const advance = loop.advance(START_MS + 4);
        expect(advance.ticks).toBe(0);
        expect(advance.alpha).toBeCloseTo(0.4, ALPHA_DIGITS);
        expect(advance.frameDeltaMs).toBe(4);
    });

    test("short frames accumulate into ticks at the tick rate", () => {
        const loop = loopStartedAt(START_MS, ROUND_TICK_MS);
        const clock = {nowMs: START_MS};
        const ticks = [4, 4, 4, 4, 4].map(deltaMs => advanceBy(loop, clock, deltaMs).ticks);
        expect(ticks).toEqual([0, 0, 1, 0, 1]);
    });

    test("a frame several ticks long runs them all and carries the remainder", () => {
        const loop = loopStartedAt(START_MS, ROUND_TICK_MS);
        const advance = loop.advance(START_MS + 37);
        expect(advance.ticks).toBe(3);
        expect(advance.alpha).toBeCloseTo(0.7, ALPHA_DIGITS);
    });

    test("frames jittered within the snap tolerance run exactly one tick each, with no drift", () => {
        const loop = loopStartedAt(START_MS);
        const clock = {nowMs: START_MS};
        const jitterMs = [-0.9, 0.8, -0.5, 0.95, -0.95, 0.3, -0.7, 0.9];
        const advances = jitterMs.map(offsetMs => advanceBy(loop, clock, TICK_MS + offsetMs));
        expect(advances.map(advance => advance.ticks)).toEqual(jitterMs.map(() => 1));
        expect(advances.map(advance => advance.alpha)).toEqual(jitterMs.map(() => 0));
    });

    test("frames a whole number of ticks long, give or take the tolerance, snap to that many ticks", () => {
        const loop = loopStartedAt(START_MS);
        const clock = {nowMs: START_MS};
        const ticks = [2 * TICK_MS + 0.6, 2 * TICK_MS - 0.6, 3 * TICK_MS - 0.2].map(deltaMs => advanceBy(loop, clock, deltaMs).ticks);
        expect(ticks).toEqual([2, 2, 3]);
    });

    test("a frame off by more than the snap tolerance is not snapped", () => {
        const loop = loopStartedAt(START_MS);
        const offsetMs = TICK_SNAP_TOLERANCE_MS + 0.5;
        const advance = loop.advance(START_MS + TICK_MS + offsetMs);
        expect(advance.ticks).toBe(1);
        expect(advance.alpha).toBeCloseTo(offsetMs / TICK_MS, ALPHA_DIGITS);
    });

    test("snapping stays a small fraction of a fast tick", () => {
        const fastTickMs = 1;
        expect(snapToWholeTicks(16.6, fastTickMs)).toBe(16.6);
        expect(snapToWholeTicks(16.6, TICK_MS)).toBe(TICK_MS);
    });

    test("ticks past the catch-up cap are dropped, not owed to later frames", () => {
        const loop = loopStartedAt(START_MS, ROUND_TICK_MS);
        const clock = {nowMs: START_MS};
        const behind = advanceBy(loop, clock, 73);
        expect(behind.ticks).toBe(MAX_TICKS_PER_FRAME);
        expect(behind.alpha).toBeCloseTo(0.3, ALPHA_DIGITS);
        const next = advanceBy(loop, clock, ROUND_TICK_MS);
        expect(next.ticks).toBe(1);
        expect(next.alpha).toBeCloseTo(0.3, ALPHA_DIGITS);
    });

    test("a frame longer than the maximum frame delta counts as the maximum", () => {
        const loop = loopStartedAt(START_MS, ROUND_TICK_MS, Number.POSITIVE_INFINITY);
        const advance = loop.advance(START_MS + 10 * MS_PER_SECOND);
        expect(advance.frameDeltaMs).toBe(MAX_FRAME_DELTA_MS);
        expect(advance.ticks).toBe(MAX_FRAME_DELTA_MS / ROUND_TICK_MS);
    });

    test("a clock that goes backwards counts as no time", () => {
        const loop = loopStartedAt(START_MS, ROUND_TICK_MS);
        const advance = loop.advance(START_MS - 5);
        expect([advance.ticks, advance.frameDeltaMs, advance.alpha]).toEqual([0, 0, 0]);
    });

    test("restarting forgets the carried time", () => {
        const loop = loopStartedAt(START_MS, ROUND_TICK_MS);
        loop.advance(START_MS + 7);
        loop.start(START_MS + 100);
        const advance = loop.advance(START_MS + 105);
        expect(advance.ticks).toBe(0);
        expect(advance.alpha).toBeCloseTo(0.5, ALPHA_DIGITS);
    });

    test("reconfiguring the tick keeps the carried time", () => {
        const loop = loopStartedAt(START_MS, ROUND_TICK_MS);
        loop.advance(START_MS + 7);
        loop.configure(ROUND_TICK_MS / 2, MAX_TICKS_PER_FRAME);
        const advance = loop.advance(START_MS + 10);
        expect(advance.ticks).toBe(2);
        expect([loop.tickDeltaMs, loop.maxTicksPerFrame]).toEqual([ROUND_TICK_MS / 2, MAX_TICKS_PER_FRAME]);
    });

    test("a second at the tick rate runs as many ticks as the rate, whatever the frame rate", () => {
        for (const frameRate of [30, 60, 144, 1000]) {
            const loop = loopStartedAt(START_MS);
            const clock = {nowMs: START_MS};
            let ticks = 0;
            for (let frame = 0; frame < frameRate; frame++) ticks += advanceBy(loop, clock, MS_PER_SECOND / frameRate).ticks;
            expect(ticks).toBe(TICK_RATE);
        }
    });
});
