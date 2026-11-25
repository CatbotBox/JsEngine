import {describe, expect, test} from "../testing/harness";
import {timerFrameScheduler, type FrameTimerHost} from "./timerFrameScheduler";
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
const TASK_DURATION_MS = 1;
const IMMEDIATE_DELAY_MS = 0;

interface FakeTask {
    readonly id: number;
    readonly run: () => void;
    readonly repeatEveryMs: number | undefined;
    dueAtMs: number;
}

class FakeTimers implements FrameTimerHost {
    private nowMs = 0;
    private nextId = 0;
    private readonly tasks = new Map<number, FakeTask>();

    public readonly now = (): number => this.nowMs;
    public readonly setTimeout = (task: () => void, delayMs: number): number => this.schedule(task, delayMs, undefined);
    public readonly clearTimeout = (handle: unknown): void => this.cancel(handle);
    public readonly setInterval = (task: () => void, intervalMs: number): number => this.schedule(task, intervalMs, intervalMs);
    public readonly clearInterval = (handle: unknown): void => this.cancel(handle);
    public readonly setImmediate = (task: () => void): number => this.schedule(task, IMMEDIATE_DELAY_MS, undefined);
    public readonly clearImmediate = (handle: unknown): void => this.cancel(handle);

    public get pendingTaskCount(): number {
        return this.tasks.size;
    }

    public runFor(durationMs: number): void {
        const endMs = this.nowMs + durationMs;
        for (let task = this.nextTaskDueBy(endMs); task !== undefined; task = this.nextTaskDueBy(endMs)) this.runTask(task);
        this.nowMs = Math.max(this.nowMs, endMs);
    }

    public runNextTask(): void {
        const task = this.nextTaskDueBy(this.nowMs);
        if (task !== undefined) this.runTask(task);
    }

    private schedule(run: () => void, delayMs: number, repeatEveryMs: number | undefined): number {
        const id = this.nextId++;
        this.tasks.set(id, {id, run, repeatEveryMs, dueAtMs: this.nowMs + delayMs});
        return id;
    }

    private cancel(handle: unknown): void {
        if (typeof handle === "number") this.tasks.delete(handle);
    }

    private nextTaskDueBy(endMs: number): FakeTask | undefined {
        let next: FakeTask | undefined;
        for (const task of this.tasks.values()) {
            if (task.dueAtMs > endMs) continue;
            if (next === undefined || task.dueAtMs < next.dueAtMs || (task.dueAtMs === next.dueAtMs && task.id < next.id)) next = task;
        }
        return next;
    }

    private runTask(task: FakeTask): void {
        this.nowMs = Math.max(this.nowMs, task.dueAtMs);
        if (task.repeatEveryMs === undefined) this.tasks.delete(task.id);
        else task.dueAtMs += task.repeatEveryMs;
        task.run();
        this.nowMs += TASK_DURATION_MS;
    }
}

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

function framesDuring(pacing: FramePacing, runMs: number, timers: FakeTimers = new FakeTimers()): number[] {
    const frameTimes: number[] = [];
    const stop = timerFrameScheduler(timers.now, timers).start(pacing, frameTimeMs => frameTimes.push(frameTimeMs));
    timers.runFor(runMs);
    stop();
    const stoppedAt = frameTimes.length;
    timers.runFor(SETTLE_MS);
    expect(frameTimes.length).toBe(stoppedAt);
    expect(timers.pendingTaskCount).toBe(0);
    return frameTimes;
}

function gapsOf(frameTimes: readonly number[]): number[] {
    return frameTimes.slice(1).map((timeMs, index) => timeMs - frameTimes[index]);
}

describe("timerFrameScheduler", () => {
    test("interval pacing reports scheduled frame times at least one interval apart, and stops when asked", () => {
        const frameTimes = framesDuring(intervalPacing(INTERVAL_MS), RUN_MS);
        expect(frameTimes.length).toBeGreaterThan(MIN_INTERVAL_FRAMES);
        expect(gapsOf(frameTimes).every(gapMs => gapMs >= INTERVAL_MS - FLOAT_TOLERANCE_MS)).toBe(true);
    });

    test("uncapped pacing runs frames back to back, yielding between them", () => {
        const timers = new FakeTimers();
        let timerFired = false;
        timers.setTimeout(() => timerFired = true, INTERVAL_MS);
        const frameTimes = framesDuring(UNCAPPED_PACING, RUN_MS, timers);
        expect(frameTimes.length).toBeGreaterThan(MIN_UNCAPPED_FRAMES);
        expect(timerFired).toBe(true);
    });

    test("display pacing without a display paces at its cap", () => {
        const frameTimes = framesDuring(displayPacing(CAP_INTERVAL_MS), RUN_MS);
        expect(frameTimes.length).toBeGreaterThan(1);
        expect(gapsOf(frameTimes).every(gapMs => gapMs >= CAP_INTERVAL_MS - FLOAT_TOLERANCE_MS)).toBe(true);
    });

    test("uncapped pacing waits instead of spinning while the presentation is backlogged, and a presented frame wakes it at once", () => {
        const timers = new FakeTimers();
        const backlog = new ScriptedBacklog();
        let frames = 0;
        const stop = timerFrameScheduler(timers.now, timers).start(UNCAPPED_PACING, () => frames++, backlog);
        try {
            timers.runFor(RUN_MS);
            expect(frames).toBeGreaterThan(FIRST_FRAME_ONLY);
            expect(frames).toBeLessThan(Math.ceil(RUN_MS / ASSUMED_DISPLAY_INTERVAL_MS) + SPARE_WAIT_FRAMES);
            const framesBeforePresenting = frames;
            backlog.present();
            timers.runNextTask();
            expect(frames).toBe(framesBeforePresenting + 1);
        } finally {
            stop();
        }
    });

    test("uncapped pacing runs back to back again once the presentation catches up", () => {
        const timers = new FakeTimers();
        const backlog = new ScriptedBacklog();
        let frames = 0;
        const stop = timerFrameScheduler(timers.now, timers).start(UNCAPPED_PACING, () => frames++, backlog);
        try {
            timers.runNextTask();
            expect(frames).toBe(FRAMES_BEFORE_THE_FIRST_WAIT);
            backlog.isBacklogged = false;
            backlog.present();
            timers.runFor(RUN_MS);
        } finally {
            stop();
        }
        expect(frames).toBeGreaterThan(MIN_UNCAPPED_FRAMES);
    });

    test("stopping a waiting loop stops listening and ignores later presented frames", () => {
        const timers = new FakeTimers();
        const backlog = new ScriptedBacklog();
        let frames = 0;
        const stop = timerFrameScheduler(timers.now, timers).start(UNCAPPED_PACING, () => frames++, backlog);
        timers.runNextTask();
        expect(backlog.listenerCount).toBe(1);
        stop();
        expect(backlog.listenerCount).toBe(0);
        backlog.present();
        timers.runFor(SETTLE_MS);
        expect(frames).toBe(FRAMES_BEFORE_THE_FIRST_WAIT);
        expect(timers.pendingTaskCount).toBe(0);
    });

    test("interval pacing keeps its interval whatever the presentation backlog", () => {
        const timers = new FakeTimers();
        const backlog = new ScriptedBacklog();
        const frameTimes: number[] = [];
        const stop = timerFrameScheduler(timers.now, timers).start(intervalPacing(INTERVAL_MS), frameTimeMs => frameTimes.push(frameTimeMs), backlog);
        timers.runFor(RUN_MS);
        stop();
        expect(frameTimes.length).toBeGreaterThan(MIN_INTERVAL_FRAMES);
        expect(gapsOf(frameTimes).every(gapMs => gapMs >= INTERVAL_MS - FLOAT_TOLERANCE_MS)).toBe(true);
        expect(backlog.listenerCount).toBe(0);
    });

    test("a frame callback can stop its own loop", () => {
        for (const pacing of [intervalPacing(INTERVAL_MS), UNCAPPED_PACING]) {
            const timers = new FakeTimers();
            let frames = 0;
            const stop = timerFrameScheduler(timers.now, timers).start(pacing, () => {
                frames++;
                if (frames === FRAMES_BEFORE_STOP) stop();
            });
            timers.runFor(RUN_MS);
            expect(frames).toBe(FRAMES_BEFORE_STOP);
            expect(timers.pendingTaskCount).toBe(0);
        }
    });
});
