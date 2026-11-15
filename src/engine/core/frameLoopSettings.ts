import {Component} from "./component";
import type {FramePacing} from "../platform/platform";
import {displayPacing, intervalPacing, limitPacing, UNCAPPED_PACING} from "../platform/framePacing";

const MS_PER_SECOND = 1000;
const DEFAULT_SIMULATION_TICK_RATE = 60;
const DEFAULT_RENDER_RATE = 60;
const DEFAULT_CPU_RENDER_RATE_LIMIT = 60;
const DEFAULT_MAX_CATCH_UP_TICKS = 5;
const MIN_CATCH_UP_TICKS = 1;

export const UNCAPPED_RENDER_RATE = Number.POSITIVE_INFINITY;

export class FrameLoopSettings extends Component {
    public simulationTickRate: number = DEFAULT_SIMULATION_TICK_RATE;
    public renderRate: number = DEFAULT_RENDER_RATE;
    public matchDisplay: boolean = false;
    public cpuRenderRateLimit: number = DEFAULT_CPU_RENDER_RATE_LIMIT;
    public maxCatchUpTicks: number = DEFAULT_MAX_CATCH_UP_TICKS;
}

export interface LoopTiming {
    readonly tickDeltaMs: number;
    readonly pacing: FramePacing;
    readonly renderRateLimit: number;
    readonly maxCatchUpTicks: number;
}

export function resolveLoopTiming(settings: FrameLoopSettings, framesRenderedOnCpu: boolean): LoopTiming {
    const {simulationTickRate, renderRate, matchDisplay, cpuRenderRateLimit, maxCatchUpTicks} = settings;
    const validTickRate = Number.isFinite(simulationTickRate) && simulationTickRate > 0;
    if (!validTickRate) {
        throw new Error(`FrameLoopSettings.simulationTickRate must be a positive finite number of ticks per second, not ${simulationTickRate}`);
    }
    const validRenderRate = renderRate > 0;
    if (!validRenderRate) {
        throw new Error(`FrameLoopSettings.renderRate must be a positive number of frames per second or UNCAPPED_RENDER_RATE, not ${renderRate}`);
    }
    const validCpuLimit = cpuRenderRateLimit > 0;
    if (!validCpuLimit) {
        throw new Error(`FrameLoopSettings.cpuRenderRateLimit must be a positive number of frames per second or UNCAPPED_RENDER_RATE, not ${cpuRenderRateLimit}`);
    }
    const validCatchUp = Number.isInteger(maxCatchUpTicks) && maxCatchUpTicks >= MIN_CATCH_UP_TICKS;
    if (!validCatchUp) {
        throw new Error(`FrameLoopSettings.maxCatchUpTicks must be a whole number of at least ${MIN_CATCH_UP_TICKS}, not ${maxCatchUpTicks}`);
    }
    const renderCapped = Number.isFinite(renderRate);
    const renderIntervalMs = MS_PER_SECOND / renderRate;
    const requestedPacing = matchDisplay
        ? displayPacing(renderCapped ? renderIntervalMs : undefined)
        : renderCapped ? intervalPacing(renderIntervalMs) : UNCAPPED_PACING;
    const renderRateLimited = framesRenderedOnCpu && Number.isFinite(cpuRenderRateLimit);
    const renderRateLimit = renderRateLimited ? cpuRenderRateLimit : UNCAPPED_RENDER_RATE;
    const pacing = renderRateLimited ? limitPacing(requestedPacing, MS_PER_SECOND / cpuRenderRateLimit) : requestedPacing;
    return {tickDeltaMs: MS_PER_SECOND / simulationTickRate, pacing, renderRateLimit, maxCatchUpTicks};
}

export class LoopTimingResolver {
    private _resolved: LoopTiming | undefined;
    private _simulationTickRate = DEFAULT_SIMULATION_TICK_RATE;
    private _renderRate = DEFAULT_RENDER_RATE;
    private _matchDisplay = false;
    private _cpuRenderRateLimit = DEFAULT_CPU_RENDER_RATE_LIMIT;
    private _maxCatchUpTicks = DEFAULT_MAX_CATCH_UP_TICKS;
    private _framesRenderedOnCpu = false;

    public resolve(settings: FrameLoopSettings, framesRenderedOnCpu: boolean): LoopTiming {
        const resolved = this._resolved;
        if (resolved !== undefined
            && settings.simulationTickRate === this._simulationTickRate
            && settings.renderRate === this._renderRate
            && settings.matchDisplay === this._matchDisplay
            && settings.cpuRenderRateLimit === this._cpuRenderRateLimit
            && settings.maxCatchUpTicks === this._maxCatchUpTicks
            && framesRenderedOnCpu === this._framesRenderedOnCpu) return resolved;
        const timing = resolveLoopTiming(settings, framesRenderedOnCpu);
        this._simulationTickRate = settings.simulationTickRate;
        this._renderRate = settings.renderRate;
        this._matchDisplay = settings.matchDisplay;
        this._cpuRenderRateLimit = settings.cpuRenderRateLimit;
        this._maxCatchUpTicks = settings.maxCatchUpTicks;
        this._framesRenderedOnCpu = framesRenderedOnCpu;
        this._resolved = timing;
        return timing;
    }
}
