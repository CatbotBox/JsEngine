import type {FrameCallback, FramePacing, FrameScheduler, PresentationBacklog} from "./platform";
import {ASSUMED_DISPLAY_INTERVAL_MS, minimumFrameIntervalMs} from "./framePacing";

const POLLS_PER_FRAME = 10;
const NEXT_TASK_DELAY_MS = 0;
const MAX_PRESENTATION_WAIT_MS = ASSUMED_DISPLAY_INTERVAL_MS;

interface TaskYield {
    schedule(task: () => void): void;
    cancel(): void;
}

interface MessagePortLike {
    onmessage: (() => void) | null;
    postMessage(message: undefined): void;
    close(): void;
}

interface MessageChannelLike {
    readonly port1: MessagePortLike;
    readonly port2: MessagePortLike;
}

export interface FrameTimerHost {
    setTimeout(task: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
    setInterval(task: () => void, intervalMs: number): unknown;
    clearInterval(handle: unknown): void;
    readonly setImmediate?: (task: () => void) => unknown;
    readonly clearImmediate?: (handle: unknown) => void;
    readonly MessageChannel?: new () => MessageChannelLike;
}

export function timerFrameScheduler(now: () => number, timers: FrameTimerHost = globalThis as unknown as FrameTimerHost): FrameScheduler {
    return {
        start(pacing: FramePacing, onFrame: FrameCallback, backlog?: PresentationBacklog): () => void {
            if (pacing.kind === "uncapped") return startUncapped(now, timers, onFrame, backlog);
            return startInterval(now, timers, minimumFrameIntervalMs(pacing), onFrame);
        },
    };
}

function startInterval(now: () => number, timers: FrameTimerHost, intervalMs: number, onFrame: FrameCallback): () => void {
    let nextFrameAtMs = now() + intervalMs;
    const handle = timers.setInterval(() => {
        const nowMs = now();
        if (nowMs < nextFrameAtMs) return;
        const fellBehindAFrame = nowMs - nextFrameAtMs >= intervalMs;
        const frameTimeMs = fellBehindAFrame ? nowMs : nextFrameAtMs;
        nextFrameAtMs = frameTimeMs + intervalMs;
        onFrame(frameTimeMs);
    }, intervalMs / POLLS_PER_FRAME);
    return () => timers.clearInterval(handle);
}

function startUncapped(now: () => number, timers: FrameTimerHost, onFrame: FrameCallback, backlog: PresentationBacklog | undefined): () => void {
    const taskYield = createTaskYield(timers);
    let running = true;
    let presentationWait: unknown;
    const frame = (): void => {
        if (!running) return;
        onFrame(now());
        if (!running) return;
        if (backlog?.backlogged() === true) presentationWait = timers.setTimeout(endPresentationWait, MAX_PRESENTATION_WAIT_MS);
        else taskYield.schedule(frame);
    };
    const endPresentationWait = (): void => {
        if (presentationWait === undefined) return;
        timers.clearTimeout(presentationWait);
        presentationWait = undefined;
        taskYield.schedule(frame);
    };
    const stopListening = backlog?.onPresented(endPresentationWait);
    taskYield.schedule(frame);
    return () => {
        running = false;
        timers.clearTimeout(presentationWait);
        presentationWait = undefined;
        stopListening?.();
        taskYield.cancel();
    };
}

function createTaskYield(host: FrameTimerHost): TaskYield {
    const {setImmediate, clearImmediate, MessageChannel} = host;
    if (setImmediate !== undefined && clearImmediate !== undefined) {
        let handle: unknown;
        return {
            schedule: task => {
                handle = setImmediate(task);
            },
            cancel: () => clearImmediate(handle),
        };
    }
    if (MessageChannel !== undefined) {
        const channel = new MessageChannel();
        let pending: (() => void) | undefined;
        channel.port1.onmessage = () => pending?.();
        return {
            schedule: task => {
                pending = task;
                channel.port2.postMessage(undefined);
            },
            cancel: () => {
                pending = undefined;
                channel.port1.onmessage = null;
                channel.port1.close();
                channel.port2.close();
            },
        };
    }
    let handle: unknown;
    return {
        schedule: task => {
            handle = host.setTimeout(task, NEXT_TASK_DELAY_MS);
        },
        cancel: () => host.clearTimeout(handle),
    };
}
