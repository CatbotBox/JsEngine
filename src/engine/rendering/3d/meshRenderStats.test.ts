import {describe, expect, test} from "../../testing/harness";
import {MeshRenderStats, TRACKED_LOD_LEVELS} from "./meshRenderStats";
import type {MeshDrawCounts} from "./meshRenderStats";

const TRIANGLES = 120;
const WORKERS = 3;
const LOD_COUNTS = [4, 2, 1];

class Walks {
    public walkCount = 1;
}

function drawn(trianglesDrawn: number, lodCounts: readonly number[], rasterWorkers: number): MeshDrawCounts {
    const lodLevelCounts = new Int32Array(TRACKED_LOD_LEVELS);
    lodLevelCounts.set(lodCounts);
    return {trianglesDrawn, lodLevelCounts, rasterWorkers};
}

describe("MeshRenderStats", () => {
    test("reads zero before any pass records", () => {
        const stats = new MeshRenderStats();
        expect([stats.trianglesDrawn, stats.rasterWorkers, Array.from(stats.lodLevelCounts)]).toEqual([0, 0, new Array(TRACKED_LOD_LEVELS).fill(0)]);
    });

    test("keeps a copy of what the pass drew, which reads zero once its render group walks again without a new record", () => {
        const walks = new Walks();
        const stats = new MeshRenderStats();
        const counts = drawn(TRIANGLES, LOD_COUNTS, WORKERS);
        stats.record(walks, counts);
        counts.lodLevelCounts.fill(0);
        expect([stats.trianglesDrawn, stats.rasterWorkers, Array.from(stats.lodLevelCounts.subarray(0, LOD_COUNTS.length))]).toEqual([TRIANGLES, WORKERS, LOD_COUNTS]);

        walks.walkCount++;
        expect([stats.trianglesDrawn, stats.rasterWorkers, Array.from(stats.lodLevelCounts.subarray(0, LOD_COUNTS.length))]).toEqual([0, WORKERS, [0, 0, 0]]);

        stats.record(walks, drawn(TRIANGLES, LOD_COUNTS, WORKERS));
        expect(stats.trianglesDrawn).toBe(TRIANGLES);
    });

    test("without a render group the record never goes stale", () => {
        const stats = new MeshRenderStats();
        stats.record(undefined, drawn(TRIANGLES, LOD_COUNTS, WORKERS));
        expect(stats.trianglesDrawn).toBe(TRIANGLES);
    });
});
