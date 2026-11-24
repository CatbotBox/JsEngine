import {describe, expect, test} from "../../engine/testing/harness";
import {ManualFrameScheduler} from "../../engine/testing/manualFrameScheduler";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {PresenterBacklogs} from "../../engine/core/presenterBacklogs";
import {World} from "../../engine/core/world";
import {FrameLoopSettings, UNCAPPED_RENDER_RATE} from "../../engine/core/frameLoopSettings";
import type {RendererKind} from "../../engine/core/activeRenderers";
import {DISPLAY_CAPPED_PACING, displayPacing, INTERVAL_CAPPED_PACING, intervalPacing, UNCAPPED_PACING} from "../../engine/platform/framePacing";
import {animationFrameHostOf, animationFrameScheduler, displayFrameScheduler} from "./animationFrameScheduler";
import type {AnimationFrameHost} from "./animationFrameScheduler";
import type {FrameScheduler} from "../../engine/platform/platform";

const MS_PER_SECOND = 1000;
const SIXTY_HZ_MS = MS_PER_SECOND / 60;
const HUNDRED_FORTY_FOUR_HZ_MS = MS_PER_SECOND / 144;
const THIRTY_HZ_MS = MS_PER_SECOND / 30;
const JITTER_MS = [0.3, -0.4, 0.2, -0.1, 0.4, -0.3];
const START_MS = 500;
const FRAMES_BEFORE_STOP = 2;
const GPU_RENDERER: RendererKind = "gpu";
const DEFAULT_TICK_RATE = 60;
const DEFAULT_RENDER_RATE = 60;
const DEFAULT_MAX_CATCH_UP_TICKS = 5;
const TICKS_PER_THIRTY_HZ_REFRESH = 2;
const TICK_PACE_TOLERANCE = 1;
const STALL_MS = 10 * MS_PER_SECOND;
const NO_JITTER_MS = [0];
const TICKS_BEFORE_UNCAPPED = 2;

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

function refreshFor(display: FakeAnimationFrames, refreshIntervalMs: number, durationMs: number, jitterMs: readonly number[] = NO_JITTER_MS): void {
    const refreshes = Math.round(durationMs / refreshIntervalMs);
    for (let refresh = 0; refresh < refreshes; refresh++) {
        display.refresh(START_MS + refresh * refreshIntervalMs + jitterMs[refresh % jitterMs.length]);
    }
}

interface DisplayWorldRig {
    readonly world: World;
    readonly settings: FrameLoopSettings;
    readonly display: FakeAnimationFrames;
    readonly fallback: ManualFrameScheduler;
    readonly loopStartMs: number;
    readonly frameTimesMs: readonly number[];
    refreshFor(durationMs: number, jitterMs?: readonly number[]): void;
    refreshAt(timestampMs: number): void;
}

function recordingFrameTimes(scheduler: FrameScheduler, frameTimesMs: number[]): FrameScheduler {
    return {
        cappedPacing: scheduler.cappedPacing,
        start: (pacing, onFrame, backlog) => scheduler.start(pacing, frameTimeMs => {
            frameTimesMs.push(frameTimeMs);
            onFrame(frameTimeMs);
        }, backlog),
    };
}

function displayWorldRig(refreshIntervalMs: number): DisplayWorldRig {
    const display = new FakeAnimationFrames();
    const fallback = new ManualFrameScheduler();
    const frameTimesMs: number[] = [];
    const loopStartMs = START_MS - refreshIntervalMs;
    const frameScheduler = recordingFrameTimes(animationFrameScheduler(display, fallback, DISPLAY_CAPPED_PACING), frameTimesMs);
    const platform = new MemoryPlatform({frameScheduler, now: loopStartMs});
    const world = new World({platform});
    world.renderers.add(GPU_RENDERER);
    const settings = new FrameLoopSettings();
    world.entityManager.createEntity("frameLoop", [settings]);
    const refreshAt = (timestampMs: number): void => {
        platform.setNow(timestampMs);
        display.refresh(timestampMs);
    };
    return {
        world,
        settings,
        display,
        fallback,
        loopStartMs,
        frameTimesMs,
        refreshAt,
        refreshFor(durationMs: number, jitterMs: readonly number[] = NO_JITTER_MS): void {
            const refreshes = Math.round(durationMs / refreshIntervalMs);
            for (let refresh = 0; refresh < refreshes; refresh++) refreshAt(START_MS + refresh * refreshIntervalMs + jitterMs[refresh % jitterMs.length]);
        },
    };
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

    test("only a scheduler with animation frames asks for display-capped pacing, and only when its host asks for it", () => {
        const display = new FakeAnimationFrames();
        const host = {
            requestAnimationFrame: (callback: (timestampMs: number) => void) => display.requestAnimationFrame(callback),
            cancelAnimationFrame: (handle: number) => display.cancelAnimationFrame(handle),
        };
        const now = () => START_MS;
        expect(displayFrameScheduler(host, now, DISPLAY_CAPPED_PACING).cappedPacing).toBe(DISPLAY_CAPPED_PACING);
        expect(displayFrameScheduler(host, now).cappedPacing).toBe(INTERVAL_CAPPED_PACING);
        expect(displayFrameScheduler({}, now, DISPLAY_CAPPED_PACING).cappedPacing).toBeUndefined();
    });
});

describe("a gpu world paced by animation frames", () => {
    test("the default render rate presents on every refresh of a 60 Hz display, one tick each, through jitter", () => {
        const rig = displayWorldRig(SIXTY_HZ_MS);
        rig.world.startLoop();
        expect(rig.fallback.running).toBe(false);
        rig.refreshFor(MS_PER_SECOND, JITTER_MS);
        expect([rig.world.time.frameCount, rig.world.time.tickCount]).toEqual([DEFAULT_RENDER_RATE, DEFAULT_TICK_RATE]);
    });

    test("a 144 Hz display presents the default render rate's 60 frames a second, and ticks keep pace with the presented frames", () => {
        const rig = displayWorldRig(HUNDRED_FORTY_FOUR_HZ_MS);
        rig.world.startLoop();
        rig.refreshFor(MS_PER_SECOND);
        expect(rig.world.time.frameCount).toBe(DEFAULT_RENDER_RATE);
        expect(rig.frameTimesMs.length).toBe(DEFAULT_RENDER_RATE);
        const lastFrameMs = rig.frameTimesMs[rig.frameTimesMs.length - 1];
        const elapsedTicks = (lastFrameMs - rig.loopStartMs) / (MS_PER_SECOND / DEFAULT_TICK_RATE);
        expect(Math.abs(rig.world.time.tickCount - elapsedTicks)).toBeLessThan(TICK_PACE_TOLERANCE);
    });

    test("a 30 Hz display presents every refresh and catches the simulation up with two ticks a frame", () => {
        const rig = displayWorldRig(THIRTY_HZ_MS);
        rig.world.startLoop();
        rig.refreshFor(MS_PER_SECOND);
        expect(rig.world.time.frameCount).toBe(DEFAULT_RENDER_RATE / TICKS_PER_THIRTY_HZ_REFRESH);
        expect(rig.world.time.tickCount).toBe(DEFAULT_TICK_RATE);
    });

    test("a display that stops refreshing (a hidden page) resumes with at most maxCatchUpTicks ticks", () => {
        const rig = displayWorldRig(SIXTY_HZ_MS);
        rig.world.startLoop();
        rig.refreshAt(START_MS);
        rig.refreshAt(START_MS + STALL_MS);
        expect(rig.world.time.tickCount).toBe(1 + DEFAULT_MAX_CATCH_UP_TICKS);
    });

    test("an uncapped render rate keeps the fallback's uncapped frames and presentation backlog", () => {
        const rig = displayWorldRig(SIXTY_HZ_MS);
        rig.settings.renderRate = UNCAPPED_RENDER_RATE;
        rig.world.startLoop();
        expect(rig.fallback.pacing).toEqual(UNCAPPED_PACING);
        expect(rig.fallback.backlog).toBe(rig.world.presenterBacklogs);
        expect(rig.display.waiting).toBe(0);
    });

    test("switching to uncapped inside a display frame stops the display frames and hands over to the fallback", () => {
        const rig = displayWorldRig(SIXTY_HZ_MS);
        rig.world.startLoop();
        rig.refreshAt(START_MS);
        rig.settings.renderRate = UNCAPPED_RENDER_RATE;
        rig.refreshAt(START_MS + SIXTY_HZ_MS);
        expect(rig.fallback.pacing).toEqual(UNCAPPED_PACING);
        expect(rig.display.waiting).toBe(0);
        expect(rig.world.time.tickCount).toBe(TICKS_BEFORE_UNCAPPED);
        rig.fallback.frame(START_MS + TICKS_BEFORE_UNCAPPED * SIXTY_HZ_MS);
        expect(rig.world.time.tickCount).toBe(TICKS_BEFORE_UNCAPPED + 1);
    });

    test("a world without a renderer ticks on the fallback's intervals at the tick rate", () => {
        const rig = displayWorldRig(SIXTY_HZ_MS);
        rig.world.renderers.remove(GPU_RENDERER);
        rig.world.startLoop();
        expect(rig.fallback.pacing).toEqual(intervalPacing(MS_PER_SECOND / DEFAULT_TICK_RATE));
        expect(rig.display.waiting).toBe(0);
    });
});
