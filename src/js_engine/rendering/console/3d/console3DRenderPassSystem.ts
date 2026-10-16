import {DeepReadonly} from "../../../util/tokenUtils";
import {FaceCulling} from "../../3d/faceCulling";
import {System} from "../../../core";
import {Camera} from "../../camera";
import {ConsoleScreenBuffer, ScreenBuffer} from "../consoleScreenBuffer";
import {LocalToWorld} from "../../../translation";
import {ScreenSize} from "../../screenSize";
import {ConsoleRenderPassSystemGroup} from "../consoleRenderPassSystemGroup";
import {Mesh} from "../../3d/mesh";
import {asFloat32Array, fromFloat32Array, Vec16} from "../../../math/types/vec";
import {RenderMesh} from "../../3d/renderMesh";
import {WorldSpaceRenderBounds} from "../../worldSpaceRenderBounds";
import {FieldOfView} from "../../3d/fieldOfView";
import {ConsoleCellRatio} from "../../consoleCellRatio";
import {MeshRasterizer, NEAR_PLANE_Z} from "../../3d/software";
import {ConsoleCellResolveTarget} from "./consoleCellResolveTarget";
import {Console3DRenderSettings} from "./console3DRenderSettings";
import {RenderMeshBoundsSystem} from "../../3d/renderMeshBoundsSystem";
import {ViewSpaceMesh} from "../../3d/viewSpaceMesh";
import {SceneLights} from "../../3d/lighting/sceneLights";
import {SceneLightsGatherSystem} from "../../3d/lighting/sceneLightsGatherSystem";
import {VertexLighting} from "../../3d/lighting/vertexLighting";
import {selectLodLevel} from "../../3d/meshLod";

const TRACKED_LOD_LEVELS = 8;

/**
 * Draws every RenderMesh through MeshRasterizer. Runs only while a singleton
 * Console3DRenderSettings entity exists; that entity is the configuration.
 */
export class Console3DRenderPassSystem extends System {
    private _settingsQuery = this.createEntityQuery([Console3DRenderSettings]);
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize, LocalToWorld, FieldOfView, ConsoleCellRatio]);
    private _alwaysRenderQuery = this.createEntityQuery([RenderMesh, LocalToWorld], [WorldSpaceRenderBounds]);
    private _selectiveRenderQuery = this.createEntityQuery([RenderMesh, LocalToWorld, WorldSpaceRenderBounds]);

    private _rasterizer = new MeshRasterizer();
    private _resolveTarget = new ConsoleCellResolveTarget();
    private _modelViewScratch = new Float32Array(16);
    private _normalMatrixScratch = new Float32Array(9);
    private _viewSpaceMesh = new ViewSpaceMesh();
    private _vertexLighting = new VertexLighting();
    private _projectedWidth = 0;
    private _projectedHeight = 0;

    /** Triangles handed to the rasterizer this frame, after detail-level selection. */
    public trianglesDrawn = 0;
    /** Meshes drawn this frame per detail level (index = level). */
    public readonly lodLevelCounts = new Int32Array(TRACKED_LOD_LEVELS);

    override systemGroup() {
        return ConsoleRenderPassSystemGroup;
    }

    override priority(): number {
        return 0;
    }

    protected onCreate() {
        this.requireAllForUpdate(this._settingsQuery);
        this.requireAllForUpdate(this._cameraQuery);
        this.requireAnyForUpdate(this._alwaysRenderQuery);
        this.requireAnyForUpdate(this._selectiveRenderQuery);
        this.world.ensureSystemExists(RenderMeshBoundsSystem);
        this.world.ensureSystemExists(SceneLightsGatherSystem);
    }

    /** The frame stats read as zero whenever the pass is disabled or has nothing to draw, not as the last drawn frame. */
    override update(): void {
        this.trianglesDrawn = 0;
        this.lodLevelCounts.fill(0);
        super.update();
    }

    onUpdate() {
        const settings = this._settingsQuery.getSingleton({settings: Console3DRenderSettings}).settings;
        const cameraEntity = this._cameraQuery.getSingleton({
            camera: Camera,
            screenSize: ScreenSize,
            consoleCellRatio: ConsoleCellRatio,
            localToWorld: LocalToWorld,
            fov: FieldOfView,
        });

        const dualScreenBuffer = this.world.resources.tryGet(ConsoleScreenBuffer);
        if (!dualScreenBuffer) return;

        const width = cameraEntity.screenSize.x | 0;
        const height = cameraEntity.screenSize.y | 0;
        const cellRatio = cameraEntity.consoleCellRatio.value;
        const invertedCameraMatrix = LocalToWorld.invertAffine(cameraEntity.localToWorld.matrix);
        const focalLength = cameraEntity.fov !== undefined
            ? height / (Math.tan(cameraEntity.fov.radians / 2) * 2)
            : undefined;

        const rasterizer = this._rasterizer;
        this._resolveTarget.begin(dualScreenBuffer.screenBuffer, settings);
        rasterizer.beginFrame(this._resolveTarget, width, height, settings.toRasterizerConfig());

        const sceneLights = this.world.resources.tryGet(SceneLights);
        const lit = sceneLights !== undefined && sceneLights.hasAnyLight;
        if (lit) this._vertexLighting.beginFrame(sceneLights, invertedCameraMatrix);

        const lodEnabled = settings.lod;

        this._alwaysRenderQuery.stream({
            read: {renderMesh: RenderMesh, localToWorld: LocalToWorld},
        }).consume(({renderMesh, localToWorld}) => {
            const mesh = renderMesh.mesh;
            if (mesh === undefined) return;
            this.countDrawn(mesh, 0);
            this.drawMesh(mesh, renderMesh.color, renderMesh.faceCulling, localToWorld, invertedCameraMatrix, focalLength, cellRatio, lit);
        });

        // Entities carrying WorldSpaceRenderBounds get a cheap conservative
        // frustum test before their triangles are even touched, and their
        // projected size picks the detail level.
        this._selectiveRenderQuery.stream({
            read: {renderMesh: RenderMesh, localToWorld: LocalToWorld, bounds: WorldSpaceRenderBounds},
        }).consume(({renderMesh, localToWorld, bounds}) => {
            let mesh = renderMesh.mesh;
            if (mesh === undefined) return;
            if (!this.projectBounds(bounds, invertedCameraMatrix, focalLength, cellRatio, width, height)) return;
            let level = 0;
            if (lodEnabled && mesh.lods.length > 1) {
                level = selectLodLevel(mesh.lods, this._projectedWidth, this._projectedHeight, settings.lodTrianglesPerCell, settings.lodBias);
                mesh = mesh.lods[level];
            }
            this.countDrawn(mesh, level);
            this.drawMesh(mesh, renderMesh.color, renderMesh.faceCulling, localToWorld, invertedCameraMatrix, focalLength, cellRatio, lit);
        });

        rasterizer.endFrame();
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

    /**
     * Conservative visibility test for a world-space AABB: transform its 8
     * corners into view space; cull only when all of them are behind the near
     * plane, or the whole projected extent falls outside the screen. Leaves the
     * on-screen extent of the projection, in cells, in _projectedWidth/Height;
     * corners behind the near plane project as if on it, which over-estimates.
     */
    private projectBounds(
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

        for (let corner = 0; corner < 8; corner++) {
            const x = (corner & 1) === 0 ? bounds.xMin : bounds.xMax;
            const y = (corner & 2) === 0 ? bounds.yMin : bounds.yMax;
            const z = (corner & 4) === 0 ? bounds.zMin : bounds.zMax;

            const vx = m[0] * x + m[4] * y + m[8] * z + m[12];
            const vy = m[1] * x + m[5] * y + m[9] * z + m[13];
            const vz = m[2] * x + m[6] * y + m[10] * z + m[14];

            let depth = vz;
            if (vz < NEAR_PLANE_Z) {
                anyBehindNearPlane = true;
                depth = NEAR_PLANE_Z;
            } else {
                anyInFront = true;
            }

            const ppu = focalLength !== undefined ? focalLength / depth : 1;
            const sx = halfW + vx * ppu * cellRatio;
            const sy = halfH - vy * ppu; // Y-up view space → Y-down screen rows, as in emitTriangle
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

        // A corner behind the camera makes the true projected extent
        // unbounded, so no screen-cull in that case.
        if (anyBehindNearPlane) return true;
        return maxX > 0 && minX < width && maxY > 0 && minY < height;
    }

    override onDestroy(): void {
        this._rasterizer.dispose();
    }


}
