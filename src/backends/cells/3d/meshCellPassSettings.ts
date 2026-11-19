import {Component} from "../../../engine/core";
import type {MeshRasterizerConfig} from "../../../engine/rendering/3d/software";
import type {MeshRenderSettings} from "../../../engine/rendering/3d/meshRenderSettings";
import {resolveRasterWorkerCount} from "../../../engine/rendering/3d/software/rasterWorkerCount";
import type {RasterWorkerCount, RasterWorkerHost} from "../../../engine/rendering/3d/software/rasterWorkerCount";
import {BLACK_RGB, SIX_BITS_PER_CHANNEL_MASK} from "../../../engine/rendering/packedRgb";

export type {RasterWorkerHost} from "../../../engine/rendering/3d/software/rasterWorkerCount";

const DEFAULT_SUPERSAMPLE_X = 2;
const DEFAULT_SUPERSAMPLE_Y = 4;
const DEFAULT_THREAD_TRIANGLE_THRESHOLD = 2048;
const DEFAULT_THREAD_AREA_THRESHOLD_CELLS = 50_000;
const DEFAULT_LOD_TRIANGLES_PER_CELL = 32;

export class MeshCellPassSettings extends Component {
    public maxDepthFade: number = Number.POSITIVE_INFINITY;
    public colorQuantMask: number = SIX_BITS_PER_CHANNEL_MASK;
    public backgroundColor: number = BLACK_RGB;
    public workerCount: RasterWorkerCount = "auto";
    public threadTriangleThreshold: number = DEFAULT_THREAD_TRIANGLE_THRESHOLD;
    public threadAreaThreshold: number = DEFAULT_THREAD_AREA_THRESHOLD_CELLS;
    public halfBlockCells: boolean = true;
    public lodTrianglesPerCell: number = DEFAULT_LOD_TRIANGLES_PER_CELL;

    public resolvedWorkerCount(host: RasterWorkerHost): number {
        return resolveRasterWorkerCount(this.workerCount, host);
    }

    public toRasterizerConfig(host: RasterWorkerHost, meshes: MeshRenderSettings): MeshRasterizerConfig {
        const supersampleX = meshes.supersampleX ?? DEFAULT_SUPERSAMPLE_X;
        return {
            maxDepthFade: this.maxDepthFade,
            colorQuantMask: this.colorQuantMask,
            supersample: supersampleX,
            supersampleX,
            supersampleY: meshes.supersampleY ?? DEFAULT_SUPERSAMPLE_Y,
            workerCount: this.resolvedWorkerCount(host),
            threadTriangleThreshold: this.threadTriangleThreshold,
            threadAreaThreshold: this.threadAreaThreshold,
            textures: meshes.textures,
            halfBlock: this.halfBlockCells,
        };
    }
}
