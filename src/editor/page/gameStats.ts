import type {EditorTickStats} from "../editorProtocol";

export interface TickRates {
    readonly ticksPerSecond: number;
    readonly averageTickMs: number;
}

export interface GameStats {
    readonly rates: TickRates | undefined;
    readonly entityCount: number;
    readonly viewportWidthPx: number;
    readonly viewportHeightPx: number;
    readonly targetLabel: string;
}

export const GAME_STATS_POLL_INTERVAL_MS = 500;

const MS_PER_SECOND = 1000;
const RATE_DECIMALS = 1;
const TICK_MS_DECIMALS = 2;
const MEASURING_TEXT = "measuring…";

export function tickRates(previous: EditorTickStats, current: EditorTickStats): TickRates | undefined {
    const elapsedMs = current.timeMs - previous.timeMs;
    const ticks = current.ticks - previous.ticks;
    if (elapsedMs <= 0 || ticks < 0) return undefined;
    return {
        ticksPerSecond: ticks * MS_PER_SECOND / elapsedMs,
        averageTickMs: ticks === 0 ? 0 : (current.tickMsTotal - previous.tickMsTotal) / ticks,
    };
}

export function gameStatsLines(stats: GameStats): string[] {
    const rates = stats.rates;
    const lines = [
        rates === undefined ? `Ticks/s ${MEASURING_TEXT}` : `Ticks/s ${rates.ticksPerSecond.toFixed(RATE_DECIMALS)}`,
        rates === undefined ? `Tick ${MEASURING_TEXT}` : `Tick ${rates.averageTickMs.toFixed(TICK_MS_DECIMALS)} ms`,
        `Entities ${stats.entityCount}`,
        `Viewport ${stats.viewportWidthPx}×${stats.viewportHeightPx}`,
    ];
    if (stats.targetLabel.length > 0) lines.push(`Target ${stats.targetLabel}`);
    return lines;
}
