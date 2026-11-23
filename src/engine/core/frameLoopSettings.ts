import {Component} from "./component";
import type {FramePacing} from "../platform/platform";
import type {RendererKind} from "./activeRenderers";
import {MAX_FRAME_DELTA_MS} from "./frameLoop";
import {displayPacing, interleavedFrameIntervalMs, intervalPacing, limitPacing, UNCAPPED_PACING} from "../platform/framePacing";

const MS_PER_SECOND = 1000;
const DEFAULT_SIMULATION_TICK_RATE = 60;
const DEFAULT_RENDER_RATE = 60;
const DEFAULT_CPU_RENDER_RATE_LIMIT = 60;
const DEFAULT_MAX_CATCH_UP_TICKS = 5;
const MIN_CATCH_UP_TICKS = 1;
const MIN_TICKS_PER_FRAME = 1;
const TICKS_PER_FRAME_EPSILON = 1e-9;

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
    readonly maxTicksPerFrame: number;
}

export function resolveLoopTiming(settings: FrameLoopSettings, frameRenderer: RendererKind | undefined): LoopTiming {
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
        throw new Error(`FrameLoopSettings.maxCatchUpTicks must be a whole number of at least ${MIN_CATCH_UP_TICKS}: how many frames' worth of ticks `
            + `one frame may run to catch up, not ${maxCatchUpTicks}`);
    }
    const tickDeltaMs = MS_PER_SECOND / simulationTickRate;
    const renderRateLimited = frameRenderer === "cpu" && Number.isFinite(cpuRenderRateLimit);
    const renderRateLimit = renderRateLimited ? cpuRenderRateLimit : UNCAPPED_RENDER_RATE;
    const pacing = frameRenderer === undefined
        ? intervalPacing(Math.min(tickDeltaMs, MAX_FRAME_DELTA_MS))
        : presentationPacing(renderRate, matchDisplay, renderRateLimit);
    const frameIntervalMs = interleavedFrameIntervalMs(pacing);
    const maxTicksPerFrame = ticksPerFrame(frameIntervalMs, tickDeltaMs) * maxCatchUpTicks;
    return {tickDeltaMs, pacing, renderRateLimit, maxTicksPerFrame};
}

function presentationPacing(renderRate: number, matchDisplay: boolean, renderRateLimit: number): FramePacing {
    const renderCapped = Number.isFinite(renderRate);
    const renderIntervalMs = MS_PER_SECOND / renderRate;
    const requestedPacing = matchDisplay
        ? displayPacing(renderCapped ? renderIntervalMs : undefined)
        : renderCapped ? intervalPacing(renderIntervalMs) : UNCAPPED_PACING;
    return Number.isFinite(renderRateLimit) ? limitPacing(requestedPacing, MS_PER_SECOND / renderRateLimit) : requestedPacing;
}

function ticksPerFrame(frameIntervalMs: number, tickDeltaMs: number): number {
    return Math.max(Math.ceil(frameIntervalMs / tickDeltaMs - TICKS_PER_FRAME_EPSILON), MIN_TICKS_PER_FRAME);
}

export class LoopTimingResolver {
    private _resolved: LoopTiming | undefined;
    private _simulationTickRate = DEFAULT_SIMULATION_TICK_RATE;
    private _renderRate = DEFAULT_RENDER_RATE;
    private _matchDisplay = false;
    private _cpuRenderRateLimit = DEFAULT_CPU_RENDER_RATE_LIMIT;
    private _maxCatchUpTicks = DEFAULT_MAX_CATCH_UP_TICKS;
    private _frameRenderer: RendererKind | undefined;

    public resolve(settings: FrameLoopSettings, frameRenderer: RendererKind | undefined): LoopTiming {
        const resolved = this._resolved;
        if (resolved !== undefined
            && settings.simulationTickRate === this._simulationTickRate
            && settings.renderRate === this._renderRate
            && settings.matchDisplay === this._matchDisplay
            && settings.cpuRenderRateLimit === this._cpuRenderRateLimit
            && settings.maxCatchUpTicks === this._maxCatchUpTicks
            && frameRenderer === this._frameRenderer) return resolved;
        const timing = resolveLoopTiming(settings, frameRenderer);
        this._simulationTickRate = settings.simulationTickRate;
        this._renderRate = settings.renderRate;
        this._matchDisplay = settings.matchDisplay;
        this._cpuRenderRateLimit = settings.cpuRenderRateLimit;
        this._maxCatchUpTicks = settings.maxCatchUpTicks;
        this._frameRenderer = frameRenderer;
        this._resolved = timing;
        return timing;
    }
}
