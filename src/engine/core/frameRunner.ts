import type {FrameScheduler} from "../platform/platform";
import {interleavedFrameIntervalMs, samePacing} from "../platform/framePacing";
import {FrameLoop, MAX_FRAME_DELTA_MS} from "./frameLoop";
import type {LoopTiming} from "./frameLoopSettings";
import type {PresentationBarriers} from "./presentationBarriers";

const FIRST_TICK = 0;
const NO_TIME_MS = 0;
const NO_TICK_PROGRESS = 0;

export interface FrameRunnerHost {
    readonly now: () => number;
    readonly scheduler: FrameScheduler;
    readonly barriers: PresentationBarriers;
    loopTiming(): LoopTiming;
    simulate(tickDeltaMs: number): void;
    present(frameDeltaMs: number, tickAlpha: number): void;
}

export class FrameRunner {
    private readonly _frameLoop: FrameLoop;
    private _timing: LoopTiming;
    private _interleaveIntervalMs: number;
    private _stopScheduler: (() => void) | undefined;
    private _lastPresentationAtMs = NO_TIME_MS;
    private _nextInterleavedFrameAtMs = NO_TIME_MS;
    private _interleavedThisFrame = false;
    private _tickAlpha = NO_TICK_PROGRESS;

    public constructor(private readonly host: FrameRunnerHost) {
        const timing = host.loopTiming();
        this._timing = timing;
        this._interleaveIntervalMs = interleavedFrameIntervalMs(timing.pacing);
        this._frameLoop = new FrameLoop(timing.tickDeltaMs, timing.maxCatchUpTicks);
    }

    public get running(): boolean {
        return this._stopScheduler !== undefined;
    }

    public start(): void {
        if (this.running) return;
        this.retime(this.host.loopTiming());
        const nowMs = this.host.now();
        this._frameLoop.start(nowMs);
        this._lastPresentationAtMs = nowMs;
        this._stopScheduler = this.host.scheduler.start(this._timing.pacing, this.onFrame);
    }

    public stop(): void {
        const stopScheduler = this._stopScheduler;
        if (stopScheduler === undefined) return;
        this._stopScheduler = undefined;
        stopScheduler();
    }

    private readonly onFrame = (frameTimeMs: number): void => {
        if (!this.running) return;
        try {
            this.runFrame(frameTimeMs);
        } catch (error) {
            this.stop();
            throw error;
        }
    };

    private runFrame(frameTimeMs: number): void {
        const advance = this._frameLoop.advance(frameTimeMs);
        const barriers = this.host.barriers;
        this._interleavedThisFrame = false;
        this._nextInterleavedFrameAtMs = frameTimeMs + this._interleaveIntervalMs;
        barriers.listenAtSystemBoundaries(this.interleaveIfDue);
        try {
            for (let tick = FIRST_TICK; tick < advance.ticks; tick++) {
                if (tick !== FIRST_TICK) barriers.atSystemBoundary();
                this.host.simulate(this._timing.tickDeltaMs);
                if (!this.running) return;
            }
        } finally {
            barriers.listenAtSystemBoundaries(undefined);
        }
        this._tickAlpha = advance.alpha;
        this.presentAt(this._interleavedThisFrame ? this.host.now() : frameTimeMs);
        if (this.running) this.applyTimingChanges();
    }

    private readonly interleaveIfDue = (): void => {
        const nowMs = this.host.now();
        if (nowMs < this._nextInterleavedFrameAtMs || !this.running) return;
        this._interleavedThisFrame = true;
        this.presentAt(nowMs);
        const presentedAtMs = this.host.now();
        const presentationMs = presentedAtMs - nowMs;
        this._nextInterleavedFrameAtMs = Math.max(nowMs + this._interleaveIntervalMs, presentedAtMs + presentationMs);
    };

    private presentAt(presentationAtMs: number): void {
        const elapsedMs = presentationAtMs - this._lastPresentationAtMs;
        this._lastPresentationAtMs = presentationAtMs;
        this.host.present(Math.min(Math.max(elapsedMs, NO_TIME_MS), MAX_FRAME_DELTA_MS), this._tickAlpha);
    }

    private applyTimingChanges(): void {
        const timing = this.host.loopTiming();
        if (timing === this._timing) return;
        const pacingChanged = !samePacing(timing.pacing, this._timing.pacing);
        this.retime(timing);
        if (!pacingChanged) return;
        this._stopScheduler?.();
        this._stopScheduler = this.host.scheduler.start(timing.pacing, this.onFrame);
    }

    private retime(timing: LoopTiming): void {
        this._timing = timing;
        this._interleaveIntervalMs = interleavedFrameIntervalMs(timing.pacing);
        this._frameLoop.configure(timing.tickDeltaMs, timing.maxCatchUpTicks);
    }
}
