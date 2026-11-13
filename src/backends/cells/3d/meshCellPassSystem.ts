import {System} from "../../../engine/core";
import {Camera} from "../../../engine/rendering/camera";
import {CellGrid} from "../cellGrid";
import {LocalToWorld} from "../../../engine/translation";
import {ScreenSize} from "../../../engine/rendering/screenSize";
import {CellRenderSystemGroup} from "../cellRenderSystemGroup";
import {RenderMesh} from "../../../engine/rendering/3d/renderMesh";
import {WorldSpaceRenderBounds} from "../../../engine/rendering/worldSpaceRenderBounds";
import {FieldOfView} from "../../../engine/rendering/3d/fieldOfView";
import {CellAspectRatio} from "../cellAspectRatio";
import {MeshSceneDrawer} from "../../../engine/rendering/3d/software/meshSceneDrawer";
import {CellResolveTarget} from "./cellResolveTarget";
import {MeshCellPassSettings} from "./meshCellPassSettings";
import {RenderMeshBoundsSystem} from "../../../engine/rendering/3d/renderMeshBoundsSystem";
import {SceneLights} from "../../../engine/rendering/3d/lighting/sceneLights";
import {SceneLightsGatherSystem} from "../../../engine/rendering/3d/lighting/sceneLightsGatherSystem";

export class MeshCellPassSystem extends System {
    private _settingsQuery = this.createEntityQuery([MeshCellPassSettings]);
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize, LocalToWorld, FieldOfView, CellAspectRatio]);
    private _alwaysRenderQuery = this.createEntityQuery([RenderMesh, LocalToWorld], [WorldSpaceRenderBounds]);
    private _selectiveRenderQuery = this.createEntityQuery([RenderMesh, LocalToWorld, WorldSpaceRenderBounds]);

    private _drawer!: MeshSceneDrawer;
    private _resolveTarget = new CellResolveTarget();

    public get trianglesDrawn(): number {
        return this._drawer?.trianglesDrawn ?? 0;
    }

    public get lodLevelCounts(): Int32Array {
        return this._drawer.lodLevelCounts;
    }

    public get rasterWorkers(): number {
        return this._drawer?.rasterWorkers ?? 0;
    }

    override systemGroup() {
        return CellRenderSystemGroup;
    }

    override priority(): number {
        return 0;
    }

    protected onCreate() {
        this._drawer = new MeshSceneDrawer({
            meshesWithoutBounds: this._alwaysRenderQuery,
            meshesWithBounds: this._selectiveRenderQuery,
        }, this.world.platform.workers);
        this.requireAllForUpdate(this._settingsQuery);
        this.requireAllForUpdate(this._cameraQuery);
        this.requireAnyForUpdate(this._alwaysRenderQuery);
        this.requireAnyForUpdate(this._selectiveRenderQuery);
        this.world.ensureSystemExists(RenderMeshBoundsSystem);
        this.world.ensureSystemExists(SceneLightsGatherSystem);
    }

    override update(): void {
        this._drawer.resetStats();
        super.update();
    }

    onUpdate() {
        const settings = this._settingsQuery.getSingleton({settings: MeshCellPassSettings}).settings;
        const cameraEntity = this._cameraQuery.getSingleton({
            camera: Camera,
            screenSize: ScreenSize,
            cellAspectRatio: CellAspectRatio,
            localToWorld: LocalToWorld,
            fov: FieldOfView,
        });

        const dualScreenBuffer = this.world.resources.tryGet(CellGrid);
        if (!dualScreenBuffer) return;

        this._resolveTarget.begin(dualScreenBuffer.screenBuffer, settings);
        this._drawer.draw({
            target: this._resolveTarget,
            width: cameraEntity.screenSize.x | 0,
            height: cameraEntity.screenSize.y | 0,
            rasterPixelHeightPerWidth: cameraEntity.cellAspectRatio.value,
            cameraMatrix: cameraEntity.localToWorld.matrix,
            fieldOfViewRadians: cameraEntity.fov.radians,
            rasterizerConfig: settings.toRasterizerConfig(this.world.platform),
            lod: settings.lod,
            lodTrianglesPerRasterPixel: settings.lodTrianglesPerCell,
            lodBias: settings.lodBias,
            sceneLights: this.world.resources.tryGet(SceneLights),
        });
    }

    override onDestroy(): void {
        this._drawer.dispose();
    }
}
