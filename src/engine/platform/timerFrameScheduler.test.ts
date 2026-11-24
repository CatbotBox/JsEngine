import {describe, expect, test} from "../testing/harness";
import {timerFrameScheduler} from "./timerFrameScheduler";
import {ASSUMED_DISPLAY_INTERVAL_MS, displayPacing, intervalPacing, UNCAPPED_PACING} from "./framePacing";
import type {FramePacing, PresentationBacklog} from "./platform";

const INTERVAL_MS = 10;
const RUN_MS = 120;
const MIN_INTERVAL_FRAMES = 5;
const MIN_UNCAPPED_FRAMES = 50;
const CAP_INTERVAL_MS = 25;
const SETTLE_MS = 30;
const FRAMES_BEFORE_STOP = 3;
const FLOAT_TOLERANCE_MS = 1e-6;
const FRAMES_BEFORE_THE_FIRST_WAIT = 1;
const SPARE_WAIT_FRAMES = 3;
const FIRST_FRAME_ONLY = 1;

const now = (): number => performance.now();
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const nextImmediateTask = () => new Promise<void>(done => setImmediate(done));

class ScriptedBacklog implements PresentationBacklog {
    public isBacklogged = true;
    private readonly listeners = new Set<() => void>();

    public get listenerCount(): number {
        return this.listeners.size;
    }

    public backlogged(): boolean {
        return this.isBacklogged;
    }

    public onPresented(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    public present(): void {
        for (const listener of [...this.listeners]) listener();
    }
}

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

    test("uncapped pacing waits instead of spinning while the presentation is backlogged, and a presented frame wakes it at once", async () => {
        const backlog = new ScriptedBacklog();
        let frames = 0;
        const stop = timerFrameScheduler(now).start(UNCAPPED_PACING, () => frames++, backlog);
        try {
            await sleep(RUN_MS);
            expect(frames).toBeGreaterThan(FIRST_FRAME_ONLY);
            expect(frames).toBeLessThan(Math.ceil(RUN_MS / ASSUMED_DISPLAY_INTERVAL_MS) + SPARE_WAIT_FRAMES);
            const framesBeforePresenting = frames;
            backlog.present();
            await nextImmediateTask();
            expect(frames).toBe(framesBeforePresenting + 1);
        } finally {
            stop();
        }
    });

    test("uncapped pacing runs back to back again once the presentation catches up", async () => {
        const backlog = new ScriptedBacklog();
        let frames = 0;
        const stop = timerFrameScheduler(now).start(UNCAPPED_PACING, () => frames++, backlog);
        try {
            await nextImmediateTask();
            expect(frames).toBe(FRAMES_BEFORE_THE_FIRST_WAIT);
            backlog.isBacklogged = false;
            backlog.present();
            await sleep(RUN_MS);
        } finally {
            stop();
        }
        expect(frames).toBeGreaterThan(MIN_UNCAPPED_FRAMES);
    });

    test("stopping a waiting loop stops listening and ignores later presented frames", async () => {
        const backlog = new ScriptedBacklog();
        let frames = 0;
        const stop = timerFrameScheduler(now).start(UNCAPPED_PACING, () => frames++, backlog);
        await nextImmediateTask();
        expect(backlog.listenerCount).toBe(1);
        stop();
        expect(backlog.listenerCount).toBe(0);
        backlog.present();
        await sleep(SETTLE_MS);
        expect(frames).toBe(FRAMES_BEFORE_THE_FIRST_WAIT);
    });

    test("interval pacing keeps its interval whatever the presentation backlog", async () => {
        const backlog = new ScriptedBacklog();
        const frameTimes: number[] = [];
        const stop = timerFrameScheduler(now).start(intervalPacing(INTERVAL_MS), frameTimeMs => frameTimes.push(frameTimeMs), backlog);
        await sleep(RUN_MS);
        stop();
        expect(frameTimes.length).toBeGreaterThan(MIN_INTERVAL_FRAMES);
        expect(backlog.listenerCount).toBe(0);
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
