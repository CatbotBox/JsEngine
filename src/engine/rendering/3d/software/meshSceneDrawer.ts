import {DeepReadonly} from "../../../util/tokenUtils";
import {FaceCulling} from "../faceCulling";
import type {EntityQuery} from "../../../core";
import {LocalToWorld} from "../../../translation";
import {Mesh} from "../mesh";
import {fromFloat32Array, ReadonlyVec16, Vec16} from "../../../math/types/vec";
import {RenderMesh} from "../renderMesh";
import {WorldSpaceRenderBounds} from "../../worldSpaceRenderBounds";
import {ViewSpaceMesh} from "../viewSpaceMesh";
import type {SceneLights} from "../lighting/sceneLights";
import {VertexLighting} from "../lighting/vertexLighting";
import {selectLodLevel} from "../meshLod";
import {ScreenProjectedBounds} from "../screenProjectedBounds";
import {MAT4_FLOATS} from "../../../math/mat4Layout";
import type {WorkerFactory} from "../../../platform";
import {MeshRasterizer} from "./meshRasterizer";
import type {MeshRasterizerConfig} from "./meshRasterizer";
import type {RasterTarget} from "./rasterTarget";

const TRACKED_LOD_LEVELS = 8;
const MAT3_FLOATS = 9;

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
    private readonly _projectedBounds = new ScreenProjectedBounds();

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
        const projectedBounds = this._projectedBounds;
        projectedBounds.begin(invertedCameraMatrix, focalLength, cellRatio, width, height);

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
            if (!projectedBounds.project(bounds.xMin, bounds.yMin, bounds.zMin, bounds.xMax, bounds.yMax, bounds.zMax)) return;
            let level = 0;
            if (lodEnabled && mesh.lods.length > 1) {
                level = selectLodLevel(mesh.lods, projectedBounds.width, projectedBounds.height, frame.lodTrianglesPerRasterPixel, frame.lodBias);
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
        const shading = lit ? this._vertexLighting.shade(viewMesh, color) : null;
        this._rasterizer.addViewSpaceMesh(mesh, viewMesh, focalLength, cellRatio, color, shading, faceCulling);
    }
}
