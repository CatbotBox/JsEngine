export const MAX_FRAME_DELTA_MS = 250;
export const TICK_SNAP_TOLERANCE_MS = 1;
export const MAX_TICK_SNAP_FRACTION = 1 / 16;

const NO_TIME_MS = 0;
const NO_WHOLE_TICKS = 0;
const TICK_COUNT_EPSILON = 1e-9;

export interface FrameAdvance {
    readonly ticks: number;
    readonly frameDeltaMs: number;
    readonly alpha: number;
}

export function snapToWholeTicks(deltaMs: number, tickDeltaMs: number): number {
    const wholeTicks = Math.round(deltaMs / tickDeltaMs);
    if (wholeTicks === NO_WHOLE_TICKS) return deltaMs;
    const snappedMs = wholeTicks * tickDeltaMs;
    const toleranceMs = Math.min(TICK_SNAP_TOLERANCE_MS, tickDeltaMs * MAX_TICK_SNAP_FRACTION);
    return Math.abs(deltaMs - snappedMs) <= toleranceMs ? snappedMs : deltaMs;
}

export class FrameLoop {
    private _tickDeltaMs: number;
    private _maxCatchUpTicks: number;
    private _accumulatorMs = NO_TIME_MS;
    private _lastFrameAtMs = NO_TIME_MS;

    public constructor(tickDeltaMs: number, maxCatchUpTicks: number) {
        this._tickDeltaMs = tickDeltaMs;
        this._maxCatchUpTicks = maxCatchUpTicks;
    }

    public get tickDeltaMs(): number {
        return this._tickDeltaMs;
    }

    public get maxCatchUpTicks(): number {
        return this._maxCatchUpTicks;
    }

    public configure(tickDeltaMs: number, maxCatchUpTicks: number): void {
        this._tickDeltaMs = tickDeltaMs;
        this._maxCatchUpTicks = maxCatchUpTicks;
    }

    public start(nowMs: number): void {
        this._lastFrameAtMs = nowMs;
        this._accumulatorMs = NO_TIME_MS;
    }

    public advance(nowMs: number): FrameAdvance {
        const elapsedMs = nowMs - this._lastFrameAtMs;
        this._lastFrameAtMs = nowMs;
        const frameDeltaMs = Math.min(Math.max(elapsedMs, NO_TIME_MS), MAX_FRAME_DELTA_MS);
        const tickDeltaMs = this._tickDeltaMs;
        this._accumulatorMs += snapToWholeTicks(frameDeltaMs, tickDeltaMs);
        const dueTicks = Math.floor(this._accumulatorMs / tickDeltaMs + TICK_COUNT_EPSILON);
        this._accumulatorMs = Math.max(this._accumulatorMs - dueTicks * tickDeltaMs, NO_TIME_MS);
        const ticks = Math.min(dueTicks, this._maxCatchUpTicks);
        return {ticks, frameDeltaMs, alpha: this._accumulatorMs / tickDeltaMs};
    }
}
