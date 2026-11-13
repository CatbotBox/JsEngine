import {DeepReadonly} from "../../../util/tokenUtils";
import {FaceCulling} from "../faceCulling";
import type {EntityQuery} from "../../../core";
import {LocalToWorld} from "../../../translation";
import {Mesh} from "../mesh";
import {asFloat32Array, fromFloat32Array, ReadonlyVec16, Vec16} from "../../../math/types/vec";
import {RenderMesh} from "../renderMesh";
import {WorldSpaceRenderBounds} from "../../worldSpaceRenderBounds";
import {ViewSpaceMesh} from "../viewSpaceMesh";
import type {SceneLights} from "../lighting/sceneLights";
import {VertexLighting} from "../lighting/vertexLighting";
import {selectLodLevel} from "../meshLod";
import {MAT4_FLOATS, MAT4_TRANSLATION_X, MAT4_TRANSLATION_Y, MAT4_TRANSLATION_Z} from "../../../math/mat4Layout";
import type {WorkerFactory} from "../../../platform";
import {MeshRasterizer, NEAR_PLANE_Z} from "./meshRasterizer";
import type {MeshRasterizerConfig} from "./meshRasterizer";
import type {RasterTarget} from "./rasterTarget";

const TRACKED_LOD_LEVELS = 8;
const MAT3_FLOATS = 9;
const AABB_CORNERS = 8;

export type StreamableQuery = Pick<EntityQuery, "stream">;

export interface MeshSceneQueries {
    readonly meshesWithoutBounds: StreamableQuery;
    readonly meshesWithBounds: StreamableQuery;
}

export interface MeshSceneFrame {
    readonly target: RasterTarget;
    readonly width: number;
    readonly height: number;
    readonly rasterPixelHeightPerWidth: number;
    readonly cameraMatrix: ReadonlyVec16;
    readonly fieldOfViewRadians: number | undefined;
    readonly rasterizerConfig: MeshRasterizerConfig;
    readonly lod: boolean;
    readonly lodTrianglesPerRasterPixel: number;
    readonly lodBias: number;
    readonly sceneLights: SceneLights | undefined;
}

export class MeshSceneDrawer {
    public trianglesDrawn = 0;
    public readonly lodLevelCounts = new Int32Array(TRACKED_LOD_LEVELS);

    private readonly _rasterizer: MeshRasterizer;
    private readonly _modelViewScratch = new Float32Array(MAT4_FLOATS);
    private readonly _normalMatrixScratch = new Float32Array(MAT3_FLOATS);
    private readonly _viewSpaceMesh = new ViewSpaceMesh();
    private readonly _vertexLighting = new VertexLighting();
    private _projectedWidth = 0;
    private _projectedHeight = 0;

    public constructor(private readonly queries: MeshSceneQueries, workers: WorkerFactory | undefined) {
        this._rasterizer = new MeshRasterizer(workers);
    }

    public get rasterWorkers(): number {
        return this._rasterizer.activeWorkerCount;
    }

    public resetStats(): void {
        this.trianglesDrawn = 0;
        this.lodLevelCounts.fill(0);
    }

    public draw(frame: MeshSceneFrame): void {
        const width = frame.width;
        const height = frame.height;
        const cellRatio = frame.rasterPixelHeightPerWidth;
        const invertedCameraMatrix = LocalToWorld.invertAffine(frame.cameraMatrix);
        const fieldOfViewRadians = frame.fieldOfViewRadians;
        const focalLength = fieldOfViewRadians !== undefined
            ? height / (Math.tan(fieldOfViewRadians / 2) * 2)
            : undefined;

        const rasterizer = this._rasterizer;
        rasterizer.beginFrame(frame.target, width, height, frame.rasterizerConfig);

        const sceneLights = frame.sceneLights;
        const lit = sceneLights !== undefined && sceneLights.hasAnyLight;
        if (lit) this._vertexLighting.beginFrame(sceneLights, invertedCameraMatrix);

        const lodEnabled = frame.lod;

        this.queries.meshesWithoutBounds.stream({
            read: {renderMesh: RenderMesh, localToWorld: LocalToWorld},
        }).consume(({renderMesh, localToWorld}) => {
            const mesh = renderMesh.mesh;
            if (mesh === undefined) return;
            this.countDrawn(mesh, 0);
            this.drawMesh(mesh, renderMesh.color, renderMesh.faceCulling, localToWorld, invertedCameraMatrix, focalLength, cellRatio, lit);
        });

        this.queries.meshesWithBounds.stream({
            read: {renderMesh: RenderMesh, localToWorld: LocalToWorld, bounds: WorldSpaceRenderBounds},
        }).consume(({renderMesh, localToWorld, bounds}) => {
            let mesh = renderMesh.mesh;
            if (mesh === undefined) return;
            if (!this.visibleAfterProjectingBounds(bounds, invertedCameraMatrix, focalLength, cellRatio, width, height)) return;
            let level = 0;
            if (lodEnabled && mesh.lods.length > 1) {
                level = selectLodLevel(mesh.lods, this._projectedWidth, this._projectedHeight, frame.lodTrianglesPerRasterPixel, frame.lodBias);
                mesh = mesh.lods[level];
            }
            this.countDrawn(mesh, level);
            this.drawMesh(mesh, renderMesh.color, renderMesh.faceCulling, localToWorld, invertedCameraMatrix, focalLength, cellRatio, lit);
        });

        rasterizer.endFrame();
    }

    public dispose(): void {
        this._rasterizer.dispose();
    }

    private countDrawn(mesh: DeepReadonly<Mesh>, level: number): void {
        this.trianglesDrawn += mesh.triangleCount;
        if (level < this.lodLevelCounts.length) this.lodLevelCounts[level]++;
    }

    private drawMesh(
        mesh: DeepReadonly<Mesh>, color: number, faceCulling: FaceCulling, localToWorld: DeepReadonly<LocalToWorld>, invertedCameraMatrix: Vec16,
        focalLength: number | undefined, cellRatio: number, lit: boolean,
    ): void {
        const modelView = fromFloat32Array<16>(this._modelViewScratch);
        LocalToWorld.mul(invertedCameraMatrix, localToWorld.matrix, modelView);
        const normalMatrix = lit ? LocalToWorld.normalMatrix3(modelView, this._normalMatrixScratch) : null;
        const viewMesh = this._viewSpaceMesh.transformFrom(mesh, this._modelViewScratch, normalMatrix);
        const vertexRgb = lit ? this._vertexLighting.shade(viewMesh, color) : null;
        this._rasterizer.addViewSpaceMesh(mesh, viewMesh, focalLength, cellRatio, color, vertexRgb, faceCulling);
    }

    private visibleAfterProjectingBounds(
        bounds: DeepReadonly<WorldSpaceRenderBounds>,
        invertedCameraMatrix: Vec16,
        focalLength: number | undefined,
        cellRatio: number,
        width: number,
        height: number,
    ): boolean {
        const m = asFloat32Array(invertedCameraMatrix);
        const halfW = width / 2, halfH = height / 2;

        let anyInFront = false;
        let anyBehindNearPlane = false;
        let minX = Number.POSITIVE_INFINITY, maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;

        for (let corner = 0; corner < AABB_CORNERS; corner++) {
            const x = (corner & 1) === 0 ? bounds.xMin : bounds.xMax;
            const y = (corner & 2) === 0 ? bounds.yMin : bounds.yMax;
            const z = (corner & 4) === 0 ? bounds.zMin : bounds.zMax;

            const vx = m[0] * x + m[4] * y + m[8] * z + m[MAT4_TRANSLATION_X];
            const vy = m[1] * x + m[5] * y + m[9] * z + m[MAT4_TRANSLATION_Y];
            const vz = m[2] * x + m[6] * y + m[10] * z + m[MAT4_TRANSLATION_Z];

            let depth = vz;
            if (vz < NEAR_PLANE_Z) {
                anyBehindNearPlane = true;
                depth = NEAR_PLANE_Z;
            } else {
                anyInFront = true;
            }

            const ppu = focalLength !== undefined ? focalLength / depth : 1;
            const sx = halfW + vx * ppu * cellRatio;
            const sy = halfH - vy * ppu;
            if (sx < minX) minX = sx;
            if (sx > maxX) maxX = sx;
            if (sy < minY) minY = sy;
            if (sy > maxY) maxY = sy;
        }

        if (!anyInFront) return false;

        const left = minX > 0 ? minX : 0, right = maxX < width ? maxX : width;
        const top = minY > 0 ? minY : 0, bottom = maxY < height ? maxY : height;
        this._projectedWidth = right > left ? right - left : 0;
        this._projectedHeight = bottom > top ? bottom - top : 0;

        if (anyBehindNearPlane) return true;
        return maxX > 0 && minX < width && maxY > 0 && minY < height;
    }
}
