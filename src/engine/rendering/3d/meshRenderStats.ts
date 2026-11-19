import {Resource} from "../../core";

export const TRACKED_LOD_LEVELS = 8;

const NOTHING_DRAWN = 0;
const NO_RASTER_WORKERS = 0;
const NO_WALKS = 0;

export interface RenderWalkCounter {
    readonly walkCount: number;
}

export interface MeshDrawCounts {
    readonly trianglesDrawn: number;
    readonly lodLevelCounts: Int32Array;
    readonly rasterWorkers: number;
}

export class MeshRenderStats extends Resource implements MeshDrawCounts {
    private readonly _lodLevelCounts = new Int32Array(TRACKED_LOD_LEVELS);
    private _trianglesDrawn = NOTHING_DRAWN;
    private _rasterWorkers = NO_RASTER_WORKERS;
    private _walks: RenderWalkCounter | undefined;
    private _recordedWalk = NO_WALKS;

    public get trianglesDrawn(): number {
        this.dropStaleCounts();
        return this._trianglesDrawn;
    }

    public get lodLevelCounts(): Int32Array {
        this.dropStaleCounts();
        return this._lodLevelCounts;
    }

    public get rasterWorkers(): number {
        return this._rasterWorkers;
    }

    public record(walks: RenderWalkCounter | undefined, drawn: MeshDrawCounts): void {
        this._walks = walks;
        this._recordedWalk = walks?.walkCount ?? NO_WALKS;
        this._trianglesDrawn = drawn.trianglesDrawn;
        this._lodLevelCounts.fill(NOTHING_DRAWN);
        this._lodLevelCounts.set(drawn.lodLevelCounts.subarray(0, TRACKED_LOD_LEVELS));
        this._rasterWorkers = drawn.rasterWorkers;
    }

    private dropStaleCounts(): void {
        if (this._walks === undefined || this._walks.walkCount === this._recordedWalk) return;
        this._trianglesDrawn = NOTHING_DRAWN;
        this._lodLevelCounts.fill(NOTHING_DRAWN);
    }
}
