import {describe, expect, test} from "../testing/harness";
import {timerFrameScheduler} from "./timerFrameScheduler";
import {displayPacing, intervalPacing, UNCAPPED_PACING} from "./framePacing";
import type {FramePacing} from "./platform";

const INTERVAL_MS = 10;
const RUN_MS = 120;
const MIN_INTERVAL_FRAMES = 5;
const MIN_UNCAPPED_FRAMES = 50;
const CAP_INTERVAL_MS = 25;
const SETTLE_MS = 30;
const FRAMES_BEFORE_STOP = 3;
const FLOAT_TOLERANCE_MS = 1e-6;

const now = (): number => performance.now();
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

async function framesDuring(pacing: FramePacing, runMs: number): Promise<number[]> {
    const frameTimes: number[] = [];
    const stop = timerFrameScheduler(now).start(pacing, frameTimeMs => frameTimes.push(frameTimeMs));
    await sleep(runMs);
    stop();
    const stoppedAt = frameTimes.length;
    await sleep(SETTLE_MS);
    expect(frameTimes.length).toBe(stoppedAt);
    return frameTimes;
}

function gapsOf(frameTimes: readonly number[]): number[] {
    return frameTimes.slice(1).map((timeMs, index) => timeMs - frameTimes[index]);
}

describe("timerFrameScheduler", () => {
    test("interval pacing reports scheduled frame times at least one interval apart, and stops when asked", async () => {
        const frameTimes = await framesDuring(intervalPacing(INTERVAL_MS), RUN_MS);
        expect(frameTimes.length).toBeGreaterThan(MIN_INTERVAL_FRAMES);
        expect(gapsOf(frameTimes).every(gapMs => gapMs >= INTERVAL_MS - FLOAT_TOLERANCE_MS)).toBe(true);
    });

    test("uncapped pacing runs frames back to back, yielding between them", async () => {
        let timerFired = false;
        setTimeout(() => timerFired = true, INTERVAL_MS);
        const frameTimes = await framesDuring(UNCAPPED_PACING, RUN_MS);
        expect(frameTimes.length).toBeGreaterThan(MIN_UNCAPPED_FRAMES);
        expect(timerFired).toBe(true);
    });

    test("display pacing without a display paces at its cap", async () => {
        const frameTimes = await framesDuring(displayPacing(CAP_INTERVAL_MS), RUN_MS);
        expect(frameTimes.length).toBeGreaterThan(1);
        expect(gapsOf(frameTimes).every(gapMs => gapMs >= CAP_INTERVAL_MS - FLOAT_TOLERANCE_MS)).toBe(true);
    });

    test("a frame callback can stop its own loop", async () => {
        for (const pacing of [intervalPacing(INTERVAL_MS), UNCAPPED_PACING]) {
            let frames = 0;
            const stop = timerFrameScheduler(now).start(pacing, () => {
                frames++;
                if (frames === FRAMES_BEFORE_STOP) stop();
            });
            await sleep(RUN_MS);
            expect(frames).toBe(FRAMES_BEFORE_STOP);
        }
    });
});
