import type {FrameCallback, FramePacing, FrameScheduler} from "./platform";
import {minimumFrameIntervalMs} from "./framePacing";

const POLLS_PER_FRAME = 10;
const NEXT_TASK_DELAY_MS = 0;

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
        start(pacing: FramePacing, onFrame: FrameCallback): () => void {
            if (pacing.kind === "uncapped") return startUncapped(now, onFrame);
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

function startUncapped(now: () => number, onFrame: FrameCallback): () => void {
    const taskYield = createTaskYield(globalThis as unknown as YieldHost);
    let running = true;
    const frame = (): void => {
        if (!running) return;
        onFrame(now());
        if (running) taskYield.schedule(frame);
    };
    taskYield.schedule(frame);
    return () => {
        running = false;
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
