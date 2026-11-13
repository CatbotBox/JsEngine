import type {Platform} from "../../../platform";

export type RasterWorkerHost = Pick<Platform, "hardwareConcurrency" | "requestedRasterWorkers">;
export type RasterWorkerCount = number | "auto";

const MAX_REQUESTED_WORKERS = 15;
const MAX_AUTO_WORKERS = 7;

export function resolveRasterWorkerCount(workerCount: RasterWorkerCount, host: RasterWorkerHost): number {
    if (workerCount !== "auto") return workerCount;
    const requested = host.requestedRasterWorkers?.();
    if (requested !== undefined) return Math.max(0, Math.min(MAX_REQUESTED_WORKERS, requested));
    return Math.max(0, Math.min(MAX_AUTO_WORKERS, host.hardwareConcurrency() - 1));
}
