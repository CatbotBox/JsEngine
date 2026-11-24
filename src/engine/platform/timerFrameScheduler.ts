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

interface YieldHost {
    readonly setImmediate?: (task: () => void) => unknown;
    readonly clearImmediate?: (handle: unknown) => void;
    readonly MessageChannel?: new () => MessageChannelLike;
}

export function timerFrameScheduler(now: () => number): FrameScheduler {
    return {
        start(pacing: FramePacing, onFrame: FrameCallback, backlog?: PresentationBacklog): () => void {
            if (pacing.kind === "uncapped") return startUncapped(now, onFrame, backlog);
            return startInterval(now, minimumFrameIntervalMs(pacing), onFrame);
        },
    };
}

function startInterval(now: () => number, intervalMs: number, onFrame: FrameCallback): () => void {
    let nextFrameAtMs = now() + intervalMs;
    const handle = setInterval(() => {
        const nowMs = now();
        if (nowMs < nextFrameAtMs) return;
        const fellBehindAFrame = nowMs - nextFrameAtMs >= intervalMs;
        const frameTimeMs = fellBehindAFrame ? nowMs : nextFrameAtMs;
        nextFrameAtMs = frameTimeMs + intervalMs;
        onFrame(frameTimeMs);
    }, intervalMs / POLLS_PER_FRAME);
    return () => clearInterval(handle);
}

function startUncapped(now: () => number, onFrame: FrameCallback, backlog: PresentationBacklog | undefined): () => void {
    const taskYield = createTaskYield(globalThis as unknown as YieldHost);
    let running = true;
    let presentationWait: ReturnType<typeof setTimeout> | undefined;
    const frame = (): void => {
        if (!running) return;
        onFrame(now());
        if (!running) return;
        if (backlog?.backlogged() === true) presentationWait = setTimeout(endPresentationWait, MAX_PRESENTATION_WAIT_MS);
        else taskYield.schedule(frame);
    };
    const endPresentationWait = (): void => {
        if (presentationWait === undefined) return;
        clearTimeout(presentationWait);
        presentationWait = undefined;
        taskYield.schedule(frame);
    };
    const stopListening = backlog?.onPresented(endPresentationWait);
    taskYield.schedule(frame);
    return () => {
        running = false;
        clearTimeout(presentationWait);
        presentationWait = undefined;
        stopListening?.();
        taskYield.cancel();
    };
}

function createTaskYield(host: YieldHost): TaskYield {
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
    let handle: ReturnType<typeof setTimeout> | undefined;
    return {
        schedule: task => {
            handle = setTimeout(task, NEXT_TASK_DELAY_MS);
        },
        cancel: () => clearTimeout(handle),
    };
}
