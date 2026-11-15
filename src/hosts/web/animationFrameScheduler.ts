import type {FrameCallback, FramePacing, FrameScheduler} from "../../engine/platform/platform";
import {ASSUMED_DISPLAY_INTERVAL_MS} from "../../engine/platform/framePacing";
import {timerFrameScheduler} from "../../engine/platform/timerFrameScheduler";

const NEAREST_FRAME_TOLERANCE_DIVISOR = 2;
const NO_FRAME_YET_MS = Number.NEGATIVE_INFINITY;

export interface AnimationFrameHost {
    requestAnimationFrame(callback: (timestampMs: number) => void): number;
    cancelAnimationFrame(handle: number): void;
}

export interface MaybeAnimationFrameHost {
    readonly requestAnimationFrame?: AnimationFrameHost["requestAnimationFrame"];
    readonly cancelAnimationFrame?: AnimationFrameHost["cancelAnimationFrame"];
}

export function animationFrameHostOf(host: MaybeAnimationFrameHost): AnimationFrameHost | undefined {
    const {requestAnimationFrame, cancelAnimationFrame} = host;
    if (requestAnimationFrame === undefined || cancelAnimationFrame === undefined) return undefined;
    return {
        requestAnimationFrame: callback => requestAnimationFrame.call(host, callback),
        cancelAnimationFrame: handle => cancelAnimationFrame.call(host, handle),
    };
}

export function displayFrameScheduler(host: MaybeAnimationFrameHost, now: () => number): FrameScheduler {
    const timers = timerFrameScheduler(now);
    const animationFrames = animationFrameHostOf(host);
    return animationFrames === undefined ? timers : animationFrameScheduler(animationFrames, timers);
}

export function animationFrameScheduler(host: AnimationFrameHost, fallback: FrameScheduler): FrameScheduler {
    return {
        start(pacing: FramePacing, onFrame: FrameCallback): () => void {
            if (pacing.kind !== "display") return fallback.start(pacing, onFrame);
            return startDisplayFrames(host, pacing.capIntervalMs, onFrame);
        },
    };
}

function startDisplayFrames(host: AnimationFrameHost, capIntervalMs: number | undefined, onFrame: FrameCallback): () => void {
    let running = true;
    let previousTimestampMs = NO_FRAME_YET_MS;
    let nextFrameAtMs = NO_FRAME_YET_MS;
    let handle = 0;

    const capAllows = (timestampMs: number, displayIntervalMs: number, cap: number): boolean => {
        const toleranceMs = Math.min(displayIntervalMs, cap) / NEAREST_FRAME_TOLERANCE_DIVISOR;
        if (timestampMs + toleranceMs < nextFrameAtMs) return false;
        const fellBehindAFrame = timestampMs - nextFrameAtMs >= cap;
        nextFrameAtMs = (fellBehindAFrame ? timestampMs : nextFrameAtMs) + cap;
        return true;
    };

    const onAnimationFrame = (timestampMs: number): void => {
        if (!running) return;
        const firstFrame = previousTimestampMs === NO_FRAME_YET_MS;
        const displayIntervalMs = firstFrame ? ASSUMED_DISPLAY_INTERVAL_MS : timestampMs - previousTimestampMs;
        previousTimestampMs = timestampMs;
        const due = capIntervalMs === undefined || capAllows(timestampMs, displayIntervalMs, capIntervalMs);
        if (due) onFrame(timestampMs);
        if (running) handle = host.requestAnimationFrame(onAnimationFrame);
    };

    handle = host.requestAnimationFrame(onAnimationFrame);
    return () => {
        running = false;
        host.cancelAnimationFrame(handle);
    };
}
