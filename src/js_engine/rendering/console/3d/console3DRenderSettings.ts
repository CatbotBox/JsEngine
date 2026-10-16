import {Component} from "../../../core";
import type {MeshRasterizerConfig} from "../../3d/software";
import type {Platform} from "../../../platform/platform";

export type RasterWorkerHost = Pick<Platform, "hardwareConcurrency" | "requestedRasterWorkers">;

const MAX_REQUESTED_WORKERS = 15;
const MAX_AUTO_WORKERS = 7;

/**
 * Singleton configuration for Console3DRenderPassSystem. The pass only runs
 * while exactly one entity carries this component; mutate the fields (through
 * a tracked handle from addTrackedComponent, or any handle) to retune live.
 */
export class Console3DRenderSettings extends Component {
    /**
     * Depth at which objects have faded fully to black (linearly from the camera).
     * Infinity, the default, disables the fade; set it near the far distance to
     * fade objects out before they leave the view.
     */
    public maxDepthFade: number = Number.POSITIVE_INFINITY;
    /**
     * Mask ANDed onto every packed color. Dropping the low 2 bits per channel
     * is visually indistinguishable in a terminal but makes adjacent cells
     * share colors far more often, which shortens the ANSI output. 0xFFFFFF keeps exact colors.
     */
    public colorQuantMask: number = 0xFCFCFC;
    /** Subsamples per cell on each axis; terminal cells are ~2:1 so 2x4 gives square subsamples. 1x1 disables AA. */
    public supersampleX: number = 2;
    public supersampleY: number = 4;
    /** Packed 0xRRGGBB that silhouettes blend toward; match the terminal background. */
    public backgroundColor: number = 0x000000;
    /**
     * Worker threads for rasterization; 0 forces single-threaded. "auto" takes the host's
     * requested count (JSENGINE_RASTER_THREADS under node), else one fewer than its cores, up to 7.
     */
    public workerCount: number | "auto" = "auto";
    /** Batches smaller than both thresholds rasterize on the main thread (thread wake-up isn't free). */
    public threadTriangleThreshold: number = 2048;
    public threadAreaThreshold: number = 50_000;
    /** Sample material textures; off renders every material by its diffuse color. */
    public textures: boolean = true;
    /** Two vertical samples per cell drawn with the upper-half-block glyph (needs a font with U+2580). */
    public halfBlockCells: boolean = true;
    /** Pick a coarser detail level for meshes that project small; off always draws level 0. */
    public lod: boolean = true;
    /** Whole levels added to the computed choice; positive is coarser, negative finer. */
    public lodBias: number = 0;
    /**
     * Triangle budget per screen cell covered by the mesh's projected bounds; the
     * finest level within budget is drawn. Measured in cells, not subsamples, so
     * anti-aliasing and half-block settings never move the choice.
     */
    public lodTrianglesPerCell: number = 32;

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
