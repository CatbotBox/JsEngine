import {describe, expect, test} from "../../engine/testing/harness";
import {ManualFrameScheduler} from "../../engine/testing/manualFrameScheduler";
import {PresenterBacklogs} from "../../engine/core/presenterBacklogs";
import {displayPacing, intervalPacing, UNCAPPED_PACING} from "../../engine/platform/framePacing";
import {animationFrameHostOf, animationFrameScheduler, displayFrameScheduler} from "./animationFrameScheduler";
import type {AnimationFrameHost} from "./animationFrameScheduler";

const MS_PER_SECOND = 1000;
const SIXTY_HZ_MS = MS_PER_SECOND / 60;
const HUNDRED_FORTY_FOUR_HZ_MS = MS_PER_SECOND / 144;
const THIRTY_HZ_MS = MS_PER_SECOND / 30;
const JITTER_MS = [0.3, -0.4, 0.2, -0.1, 0.4, -0.3];
const START_MS = 500;
const FRAMES_BEFORE_STOP = 2;

class FakeAnimationFrames implements AnimationFrameHost {
    private pending = new Map<number, (timestampMs: number) => void>();
    private nextHandle = 1;

    public requestAnimationFrame(callback: (timestampMs: number) => void): number {
        const handle = this.nextHandle++;
        this.pending.set(handle, callback);
        return handle;
    }

    public cancelAnimationFrame(handle: number): void {
        this.pending.delete(handle);
    }

    public get waiting(): number {
        return this.pending.size;
    }

    public refresh(timestampMs: number): void {
        const due = [...this.pending.values()];
        this.pending.clear();
        for (const callback of due) callback(timestampMs);
    }
}

function refreshFor(display: FakeAnimationFrames, refreshIntervalMs: number, durationMs: number, jitterMs: readonly number[] = [0]): void {
    const refreshes = Math.round(durationMs / refreshIntervalMs);
    for (let refresh = 0; refresh < refreshes; refresh++) {
        display.refresh(START_MS + refresh * refreshIntervalMs + jitterMs[refresh % jitterMs.length]);
    }
}

describe("animationFrameScheduler", () => {
    test("display pacing without a cap presents on every display refresh, at the refresh's timestamp", () => {
        const display = new FakeAnimationFrames();
        const frames: number[] = [];
        animationFrameScheduler(display, new ManualFrameScheduler()).start(displayPacing(), timeMs => frames.push(timeMs));
        refreshFor(display, HUNDRED_FORTY_FOUR_HZ_MS, MS_PER_SECOND);
        expect(frames.length).toBe(144);
        expect(frames[0]).toBe(START_MS);
    });

    test("a cap below the display rate skips refreshes, keeping the nearest one to each deadline", () => {
        const display = new FakeAnimationFrames();
        let frames = 0;
        animationFrameScheduler(display, new ManualFrameScheduler()).start(displayPacing(SIXTY_HZ_MS), () => frames++);
        refreshFor(display, HUNDRED_FORTY_FOUR_HZ_MS, MS_PER_SECOND);
        expect(frames).toBe(60);
    });

    test("a cap equal to the display rate keeps every jittered refresh", () => {
        const display = new FakeAnimationFrames();
        let frames = 0;
        animationFrameScheduler(display, new ManualFrameScheduler()).start(displayPacing(SIXTY_HZ_MS), () => frames++);
        refreshFor(display, SIXTY_HZ_MS, MS_PER_SECOND, JITTER_MS);
        expect(frames).toBe(60);
    });

    test("a cap above the display rate cannot add frames", () => {
        const display = new FakeAnimationFrames();
        let frames = 0;
        animationFrameScheduler(display, new ManualFrameScheduler()).start(displayPacing(SIXTY_HZ_MS), () => frames++);
        refreshFor(display, THIRTY_HZ_MS, MS_PER_SECOND);
        expect(frames).toBe(30);
    });

    test("interval and uncapped pacing go to the fallback scheduler", () => {
        const display = new FakeAnimationFrames();
        const fallback = new ManualFrameScheduler();
        const scheduler = animationFrameScheduler(display, fallback);
        scheduler.start(intervalPacing(SIXTY_HZ_MS), () => undefined);
        expect(fallback.pacing).toEqual(intervalPacing(SIXTY_HZ_MS));
        scheduler.start(UNCAPPED_PACING, () => undefined);
        expect(fallback.pacing).toEqual(UNCAPPED_PACING);
        expect(display.waiting).toBe(0);
    });

    test("the fallback scheduler gets the presentation backlog, display frames ignore it", () => {
        const display = new FakeAnimationFrames();
        const fallback = new ManualFrameScheduler();
        const backlog = new PresenterBacklogs();
        const scheduler = animationFrameScheduler(display, fallback);
        scheduler.start(UNCAPPED_PACING, () => undefined, backlog);
        expect(fallback.backlog).toBe(backlog);
        let frames = 0;
        scheduler.start(displayPacing(), () => frames++, backlog);
        refreshFor(display, SIXTY_HZ_MS, MS_PER_SECOND);
        expect(frames).toBe(60);
    });

    test("stopping cancels the pending refresh, also from inside a frame", () => {
        const display = new FakeAnimationFrames();
        let frames = 0;
        const stop = animationFrameScheduler(display, new ManualFrameScheduler()).start(displayPacing(), () => {
            frames++;
            if (frames === FRAMES_BEFORE_STOP) stop();
        });
        refreshFor(display, SIXTY_HZ_MS, MS_PER_SECOND);
        expect(frames).toBe(FRAMES_BEFORE_STOP);
        expect(display.waiting).toBe(0);
    });

    test("a host without animation frames falls back to timers", () => {
        expect(animationFrameHostOf({})).toBeUndefined();
        const display = new FakeAnimationFrames();
        const host = {
            requestAnimationFrame: (callback: (timestampMs: number) => void) => display.requestAnimationFrame(callback),
            cancelAnimationFrame: (handle: number) => display.cancelAnimationFrame(handle),
        };
        let frames = 0;
        const stop = displayFrameScheduler(host, () => START_MS).start(displayPacing(), () => frames++);
        display.refresh(START_MS);
        stop();
        expect(frames).toBe(1);
    });
});
