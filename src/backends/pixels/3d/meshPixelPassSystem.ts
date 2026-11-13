import {System} from "../../../engine/core";
import {Camera} from "../../../engine/rendering/camera";
import {LocalToWorld} from "../../../engine/translation";
import {RenderMesh} from "../../../engine/rendering/3d/renderMesh";
import {WorldSpaceRenderBounds} from "../../../engine/rendering/worldSpaceRenderBounds";
import {FieldOfView} from "../../../engine/rendering/3d/fieldOfView";
import {MeshSceneDrawer} from "../../../engine/rendering/3d/software/meshSceneDrawer";
import {RenderMeshBoundsSystem} from "../../../engine/rendering/3d/renderMeshBoundsSystem";
import {SceneLights} from "../../../engine/rendering/3d/lighting/sceneLights";
import {SceneLightsGatherSystem} from "../../../engine/rendering/3d/lighting/sceneLightsGatherSystem";
import {PixelFramebuffer} from "../pixelFramebuffer";
import {PixelRenderSystemGroup} from "../pixelRenderSystemGroup";
import {MeshPixelPassSettings} from "./meshPixelPassSettings";
import {PixelResolveTarget} from "./pixelResolveTarget";

const SQUARE_PIXEL_HEIGHT_PER_WIDTH = 1;

export class MeshPixelPassSystem extends System {
    private _settingsQuery = this.createEntityQuery([MeshPixelPassSettings]);
    private _cameraQuery = this.createEntityQuery([Camera, LocalToWorld, FieldOfView]);
    private _alwaysRenderQuery = this.createEntityQuery([RenderMesh, LocalToWorld], [WorldSpaceRenderBounds]);
    private _selectiveRenderQuery = this.createEntityQuery([RenderMesh, LocalToWorld, WorldSpaceRenderBounds]);

    private _drawer!: MeshSceneDrawer;
    private _resolveTarget = new PixelResolveTarget();

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
        return PixelRenderSystemGroup;
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
        const settings = this._settingsQuery.getSingleton({settings: MeshPixelPassSettings}).settings;
        const cameraEntity = this._cameraQuery.getSingleton({
            camera: Camera,
            localToWorld: LocalToWorld,
            fov: FieldOfView,
        });

        const framebuffer = this.world.resources.tryGet(PixelFramebuffer);
        if (!framebuffer) return;

        const framebufferPixelsPerRasterPixel = settings.resolvedFramebufferPixelsPerRasterPixel(framebuffer.widthPx, framebuffer.heightPx);
        this._resolveTarget.begin(framebuffer, framebufferPixelsPerRasterPixel);
        this._drawer.draw({
            target: this._resolveTarget,
            width: Math.ceil(framebuffer.widthPx / framebufferPixelsPerRasterPixel),
            height: Math.ceil(framebuffer.heightPx / framebufferPixelsPerRasterPixel),
            rasterPixelHeightPerWidth: SQUARE_PIXEL_HEIGHT_PER_WIDTH,
            cameraMatrix: cameraEntity.localToWorld.matrix,
            fieldOfViewRadians: cameraEntity.fov.radians,
            rasterizerConfig: settings.toRasterizerConfig(this.world.platform),
            lod: settings.lod,
            lodTrianglesPerRasterPixel: settings.lodTrianglesPerPixel,
            lodBias: settings.lodBias,
            sceneLights: this.world.resources.tryGet(SceneLights),
        });
    }

    override onDestroy(): void {
        this._drawer.dispose();
    }
}
