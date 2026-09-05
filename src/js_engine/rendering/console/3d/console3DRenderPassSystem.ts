import {DeepReadonly} from "../../../util/tokenUtils";
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
import {MeshRasterizer} from "./meshRasterizer";
import {Console3DRenderSettings} from "./console3DRenderSettings";
import {RenderMeshBoundsSystem} from "../../3d/renderMeshBoundsSystem";
import {ViewSpaceMesh} from "../../3d/viewSpaceMesh";
import {SceneLights} from "../../3d/lighting/sceneLights";
import {SceneLightsGatherSystem} from "../../3d/lighting/sceneLightsGatherSystem";
import {VertexLighting} from "../../3d/lighting/vertexLighting";

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
    private _modelViewScratch = new Float32Array(16);
    private _normalMatrixScratch = new Float32Array(9);
    private _viewSpaceMesh = new ViewSpaceMesh();
    private _vertexLighting = new VertexLighting();

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
        rasterizer.beginFrame(dualScreenBuffer.screenBuffer, width, height, settings.toRasterizerConfig());

        const sceneLights = this.world.resources.tryGet(SceneLights);
        const lit = sceneLights !== undefined && sceneLights.hasAnyLight;
        if (lit) this._vertexLighting.beginFrame(sceneLights, invertedCameraMatrix);

        this._alwaysRenderQuery.stream({
            read: {renderMesh: RenderMesh, localToWorld: LocalToWorld},
        }).consume(({renderMesh, localToWorld}) => {
            if (renderMesh.mesh === undefined) return;
            this.drawMesh(renderMesh.mesh, renderMesh.color, localToWorld, invertedCameraMatrix, focalLength, cellRatio, lit);
        });

        // Entities carrying WorldSpaceRenderBounds get a cheap conservative
        // frustum test before their triangles are even touched.
        this._selectiveRenderQuery.stream({
            read: {renderMesh: RenderMesh, localToWorld: LocalToWorld, bounds: WorldSpaceRenderBounds},
        }).consume(({renderMesh, localToWorld, bounds}) => {
            if (renderMesh.mesh === undefined) return;
            if (!Console3DRenderPassSystem.boundsMayBeVisible(bounds, invertedCameraMatrix, focalLength, cellRatio, width, height)) return;
            this.drawMesh(renderMesh.mesh, renderMesh.color, localToWorld, invertedCameraMatrix, focalLength, cellRatio, lit);
        });

        rasterizer.endFrame();
    }

    private drawMesh(
        mesh: DeepReadonly<Mesh>, color: number, localToWorld: DeepReadonly<LocalToWorld>, invertedCameraMatrix: Vec16,
        focalLength: number | undefined, cellRatio: number, lit: boolean,
    ): void {
        const modelView = fromFloat32Array<16>(this._modelViewScratch);
        LocalToWorld.mul(invertedCameraMatrix, localToWorld.matrix, modelView);
        const normalMatrix = lit ? LocalToWorld.normalMatrix3(modelView, this._normalMatrixScratch) : null;
        const viewMesh = this._viewSpaceMesh.transformFrom(mesh, this._modelViewScratch, normalMatrix);
        const vertexRgb = lit ? this._vertexLighting.shade(viewMesh, color) : null;
        this._rasterizer.addViewSpaceMesh(mesh, viewMesh, focalLength, cellRatio, color, vertexRgb);
    }

    /**
     * Conservative visibility test for a world-space AABB: transform its 8
     * corners into view space; cull only when all of them are behind the near
     * plane, or the whole projected extent falls outside the screen.
     */
    private static boundsMayBeVisible(
        bounds: DeepReadonly<WorldSpaceRenderBounds>,
        invertedCameraMatrix: Vec16,
        focalLength: number | undefined,
        cellRatio: number,
        width: number,
        height: number,
    ): boolean {
        const m = asFloat32Array(invertedCameraMatrix);
        const NEAR = 0.1;
        const halfW = width / 2, halfH = height / 2;

        let anyInFront = false;
        let anyDepthUncertain = false;
        let minX = Number.POSITIVE_INFINITY, maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;

        for (let corner = 0; corner < 8; corner++) {
            const x = (corner & 1) === 0 ? bounds.xMin : bounds.xMax;
            const y = (corner & 2) === 0 ? bounds.yMin : bounds.yMax;
            const z = (corner & 4) === 0 ? bounds.zMin : bounds.zMax;

            const vx = m[0] * x + m[4] * y + m[8] * z + m[12];
            const vy = m[1] * x + m[5] * y + m[9] * z + m[13];
            const vz = m[2] * x + m[6] * y + m[10] * z + m[14];

            if (vz < NEAR) {
                // A corner behind the camera makes the projected extent
                // unbounded — don't try to screen-cull in that case.
                anyDepthUncertain = true;
                continue;
            }
            anyInFront = true;

            const ppu = focalLength !== undefined ? focalLength / vz : 1;
            const sx = halfW + vx * ppu * cellRatio;
            const sy = halfH - vy * ppu; // Y-up view space → Y-down screen rows, as in emitTriangle
            if (sx < minX) minX = sx;
            if (sx > maxX) maxX = sx;
            if (sy < minY) minY = sy;
            if (sy > maxY) maxY = sy;
        }

        if (!anyInFront) return false;
        if (anyDepthUncertain) return true;
        return maxX > 0 && minX < width && maxY > 0 && minY < height;
    }

    override onDestroy(): void {
        this._rasterizer.dispose();
    }


}
