import {System} from "../../../engine/core";
import type {RenderPassKind} from "../../../engine/rendering/renderPasses";
import {Camera} from "../../../engine/rendering/camera";
import {LocalToWorld} from "../../../engine/translation";
import {RenderMesh} from "../../../engine/rendering/3d/renderMesh";
import {WorldSpaceRenderBounds} from "../../../engine/rendering/worldSpaceRenderBounds";
import {FieldOfView} from "../../../engine/rendering/3d/fieldOfView";
import {MeshRenderSettings} from "../../../engine/rendering/3d/meshRenderSettings";
import {MeshRenderStats} from "../../../engine/rendering/3d/meshRenderStats";
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
    public static readonly renderPass: RenderPassKind = "meshes";

    private _settingsQuery = this.createEntityQuery([MeshPixelPassSettings]);
    private _meshSettingsQuery = this.createEntityQuery([MeshRenderSettings]);
    private _cameraQuery = this.createEntityQuery([Camera, LocalToWorld, FieldOfView]);
    private _alwaysRenderQuery = this.createEntityQuery([RenderMesh, LocalToWorld], [WorldSpaceRenderBounds]);
    private _selectiveRenderQuery = this.createEntityQuery([RenderMesh, LocalToWorld, WorldSpaceRenderBounds]);

    private readonly _defaultMeshSettings = new MeshRenderSettings();
    private _drawer!: MeshSceneDrawer;
    private _resolveTarget = new PixelResolveTarget();

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
        this.world.resources.getOrCreate(MeshRenderStats);
        this.requireAllForUpdate(this._settingsQuery);
        this.requireAllForUpdate(this._cameraQuery);
        this.requireAnyForUpdate(this._alwaysRenderQuery);
        this.requireAnyForUpdate(this._selectiveRenderQuery);
        this.world.ensureSystemExists(RenderMeshBoundsSystem);
        this.world.ensureSystemExists(SceneLightsGatherSystem);
    }

    onUpdate() {
        this._drawer.resetStats();
        this.draw();
        this.world.resources.getOrCreate(MeshRenderStats).record(this.world.tryGetSystem(PixelRenderSystemGroup), this._drawer);
    }

    private draw(): void {
        const settings = this._settingsQuery.getSingleton({settings: MeshPixelPassSettings}).settings;
        const meshSettings = this._meshSettingsQuery.tryGetSingleton({settings: MeshRenderSettings})?.settings ?? this._defaultMeshSettings;
        const cameraEntity = this._cameraQuery.getSingleton({
            camera: Camera,
            localToWorld: LocalToWorld,
            fov: FieldOfView,
        });

        const framebuffer = this.world.resources.tryGet(PixelFramebuffer);
        if (!framebuffer) return;

        const framebufferPixelsPerRasterPixel = settings.resolvedFramebufferPixelsPerRasterPixel(framebuffer.widthPx, framebuffer.heightPx, meshSettings);
        this._resolveTarget.begin(framebuffer, framebufferPixelsPerRasterPixel);
        this._drawer.draw({
            target: this._resolveTarget,
            // ceil: a partial block at the right/bottom edge still covers the framebuffer's last pixels (the resolve clips it).
            width: Math.ceil(framebuffer.widthPx / framebufferPixelsPerRasterPixel),
            height: Math.ceil(framebuffer.heightPx / framebufferPixelsPerRasterPixel),
            rasterPixelHeightPerWidth: SQUARE_PIXEL_HEIGHT_PER_WIDTH,
            cameraMatrix: cameraEntity.localToWorld.matrix,
            fieldOfViewRadians: cameraEntity.fov.radians,
            rasterizerConfig: settings.toRasterizerConfig(this.world.platform, meshSettings),
            lod: meshSettings.lod,
            lodTrianglesPerRasterPixel: settings.lodTrianglesPerPixel,
            lodBias: meshSettings.lodBias,
            sceneLights: this.world.resources.tryGet(SceneLights),
        });
    }

    override onDestroy(): void {
        this._drawer.dispose();
    }
}
