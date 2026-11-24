import type {CappedPacingKind, FramePacing} from "./platform";

const MS_PER_SECOND = 1000;
const ASSUMED_DISPLAY_REFRESH_RATE = 60;
const NO_MINIMUM_INTERVAL_MS = 0;

export const ASSUMED_DISPLAY_INTERVAL_MS = MS_PER_SECOND / ASSUMED_DISPLAY_REFRESH_RATE;
export const UNCAPPED_PACING: FramePacing = {kind: "uncapped"};
export const INTERVAL_CAPPED_PACING: CappedPacingKind = "interval";
export const DISPLAY_CAPPED_PACING: CappedPacingKind = "display";

export function intervalPacing(intervalMs: number): FramePacing {
    return {kind: "interval", intervalMs};
}

export function displayPacing(capIntervalMs?: number): FramePacing {
    return capIntervalMs === undefined ? {kind: "display"} : {kind: "display", capIntervalMs};
}

export function cappedFramePacing(kind: CappedPacingKind, intervalMs: number): FramePacing {
    return kind === "display" ? displayPacing(intervalMs) : intervalPacing(intervalMs);
}

export function samePacing(a: FramePacing, b: FramePacing): boolean {
    switch (a.kind) {
        case "interval":
            return b.kind === "interval" && a.intervalMs === b.intervalMs;
        case "uncapped":
            return b.kind === "uncapped";
        case "display":
            return b.kind === "display" && a.capIntervalMs === b.capIntervalMs;
    }
}

export function minimumFrameIntervalMs(pacing: FramePacing): number {
    switch (pacing.kind) {
        case "interval":
            return pacing.intervalMs;
        case "uncapped":
            return NO_MINIMUM_INTERVAL_MS;
        case "display":
            return Math.max(pacing.capIntervalMs ?? NO_MINIMUM_INTERVAL_MS, ASSUMED_DISPLAY_INTERVAL_MS);
    }
}

export function interleavedFrameIntervalMs(pacing: FramePacing): number {
    return pacing.kind === "uncapped" ? ASSUMED_DISPLAY_INTERVAL_MS : minimumFrameIntervalMs(pacing);
}

export function limitPacing(pacing: FramePacing, minimumIntervalMs: number): FramePacing {
    switch (pacing.kind) {
        case "interval":
            return pacing.intervalMs >= minimumIntervalMs ? pacing : intervalPacing(minimumIntervalMs);
        case "uncapped":
            return intervalPacing(minimumIntervalMs);
        case "display":
            return displayPacing(Math.max(pacing.capIntervalMs ?? NO_MINIMUM_INTERVAL_MS, minimumIntervalMs));
    }
}
