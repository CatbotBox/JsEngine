import {Component} from "../../../engine/core";
import type {MeshRasterizerConfig} from "../../../engine/rendering/3d/software";
import type {Platform} from "../../../engine/platform/platform";

export type RasterWorkerHost = Pick<Platform, "hardwareConcurrency" | "requestedRasterWorkers">;

const MAX_REQUESTED_WORKERS = 15;
const MAX_AUTO_WORKERS = 7;
const SIX_BITS_PER_CHANNEL = 0xFCFCFC;
const BLACK = 0x000000;
const DEFAULT_SUPERSAMPLE_X = 2;
const DEFAULT_SUPERSAMPLE_Y = 4;
const DEFAULT_THREAD_TRIANGLE_THRESHOLD = 2048;
const DEFAULT_THREAD_AREA_THRESHOLD_CELLS = 50_000;
const DEFAULT_LOD_TRIANGLES_PER_CELL = 32;

export class MeshCellPassSettings extends Component {
    public maxDepthFade: number = Number.POSITIVE_INFINITY;
    public colorQuantMask: number = SIX_BITS_PER_CHANNEL;
    public supersampleX: number = DEFAULT_SUPERSAMPLE_X;
    public supersampleY: number = DEFAULT_SUPERSAMPLE_Y;
    public backgroundColor: number = BLACK;
    public workerCount: number | "auto" = "auto";
    public threadTriangleThreshold: number = DEFAULT_THREAD_TRIANGLE_THRESHOLD;
    public threadAreaThreshold: number = DEFAULT_THREAD_AREA_THRESHOLD_CELLS;
    public textures: boolean = true;
    public halfBlockCells: boolean = true;
    public lod: boolean = true;
    public lodBias: number = 0;
    public lodTrianglesPerCell: number = DEFAULT_LOD_TRIANGLES_PER_CELL;

    public resolvedWorkerCount(host: RasterWorkerHost): number {
        if (this.workerCount !== "auto") return this.workerCount;
        const requested = host.requestedRasterWorkers?.();
        if (requested !== undefined) return Math.max(0, Math.min(MAX_REQUESTED_WORKERS, requested));
        return Math.max(0, Math.min(MAX_AUTO_WORKERS, host.hardwareConcurrency() - 1));
    }

    public toRasterizerConfig(host: RasterWorkerHost): MeshRasterizerConfig {
        return {
            maxDepthFade: this.maxDepthFade,
            colorQuantMask: this.colorQuantMask,
            supersample: this.supersampleX,
            supersampleX: this.supersampleX,
            supersampleY: this.supersampleY,
            workerCount: this.resolvedWorkerCount(host),
            threadTriangleThreshold: this.threadTriangleThreshold,
            threadAreaThreshold: this.threadAreaThreshold,
            textures: this.textures,
            halfBlock: this.halfBlockCells,
        };
    }
}
