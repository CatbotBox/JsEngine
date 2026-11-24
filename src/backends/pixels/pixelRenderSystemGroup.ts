import {SystemGroup} from "../../engine/core";
import type {PresentationBacklog} from "../../engine/platform/platform";
import {Camera} from "../../engine/rendering/camera";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {cameraComponentsOf, RENDER_CAMERA_OVERRIDE_ERROR, RenderCameraOverride, renderCameraComponents, renderTargetCamera, RenderTargetCameras} from "../../engine/rendering/renderCameraOverride";
import {TextColor} from "../../engine/rendering/textColor";
import {PixelCameraSizingSystem} from "./pixelCameraSizingSystem";
import {OPAQUE_ALPHA, PixelFramebuffer, TRANSPARENT_ALPHA} from "./pixelFramebuffer";
import type {PixelPresenter} from "./pixelPresenter";
import {PixelPresenterResource, PixelRenderTargets} from "./pixelPresenterResource";
import type {PixelRenderTarget} from "./pixelPresenterResource";
import {backgroundColorOf, PixelRenderSettings, pixelsPerScreenUnitXOf} from "./pixelRenderSettings";
import {PixelTextRasterizer} from "./pixelTextRasterizer";

const CAMERA_SPEC = {camera: Camera, screenSize: ScreenSize};
const PRIORITY_AFTER_CAMERA_SIZING = 100;
const ERROR_TEXT_LEFT_PX = 0;
const ERROR_TEXT_DEPTH = Number.NEGATIVE_INFINITY;
const NO_WALKS = 0;
const SINGLE_CAMERA = 1;

interface PixelTargetState {
    readonly framebuffer: PixelFramebuffer;
    readonly presenterResource: PixelPresenterResource;
}

function reportsPresentation(presenter: PixelPresenter): presenter is PixelPresenter & PresentationBacklog {
    return presenter.backlogged !== undefined && presenter.onPresented !== undefined;
}

function multipleCamerasError(cameraCount: number): string {
    return "ERROR: MULTIPLE CAMERA ENTITIES FOUND (" + cameraCount + ")";
}

export class PixelRenderSystemGroup extends SystemGroup {

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize]);
    private _settingsQuery = this.createEntityQuery([PixelRenderSettings]);
    private _errorText = new PixelTextRasterizer();
    private _walkCount = NO_WALKS;
    private _presenterBacklog: PresentationBacklog | undefined;
    private readonly _targetCameras = new RenderTargetCameras();
    private readonly _targetStates = new Map<PixelRenderTarget, PixelTargetState>();
    private readonly _targetBacklogs = new Set<PresentationBacklog>();

    public get walkCount(): number {
        return this._walkCount;
    }

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return PRIORITY_AFTER_CAMERA_SIZING;
    }

    protected onCreate() {
        this.requireQueryOrResourceForUpdate(this._cameraQuery, RenderCameraOverride, PixelRenderTargets);
        this.world.ensureSystemExists(PixelCameraSizingSystem);
    }

    public onDestroy() {
        this._targetCameras.release(this.world);
        PixelPresenterResource.presenterOf(this.world).dispose?.();
    }

    onUpdate() {
        const targets = PixelRenderTargets.targetsOf(this.world);
        if (targets.length > 0) {
            this.renderTargets(targets);
            return;
        }
        this.leaveTargets();
        const presenter = PixelPresenterResource.presenterOf(this.world);
        if (presenter.backlogged?.() === true) return;
        const framebuffer = this.world.resources.getOrCreate(PixelFramebuffer);
        const settings = this._settingsQuery.tryGetSingleton({settings: PixelRenderSettings})?.settings;
        const backgroundAlpha = presenter.overlaysScene === true ? TRANSPARENT_ALPHA : OPAQUE_ALPHA;
        framebuffer.beginFrame(presenter.size(), backgroundColorOf(settings), pixelsPerScreenUnitXOf(settings), backgroundAlpha);

        const cameraError = this.cameraError();
        if (cameraError === undefined) {
            this._walkCount++;
            super.onUpdate();
        } else {
            this.drawCameraError(framebuffer, cameraError);
        }
        presenter.present(framebuffer.toPixelFrame());
    }

    private cameraError(): string[] | undefined {
        try {
            const camera = renderCameraComponents(this.world, this._cameraQuery, CAMERA_SPEC);
            return camera === undefined ? [RENDER_CAMERA_OVERRIDE_ERROR] : undefined;
        } catch (error) {
            const cameraCount = this._cameraQuery.enabledEntityCount();
            if (cameraCount == 0) return ["ERROR: NO CAMERA ENTITIES FOUND"];
            if (cameraCount > 1) return [multipleCamerasError(cameraCount)];
            return ["ERROR: UNEXPECTED ERROR HAPPENED WITH CAMERA SYSTEM", String(error)];
        }
    }

    private drawCameraError(framebuffer: PixelFramebuffer, lines: readonly string[]): void {
        lines.forEach((line, row) => {
            this._errorText.drawString(framebuffer, line, ERROR_TEXT_LEFT_PX, row * framebuffer.pixelsPerScreenUnitY, ERROR_TEXT_DEPTH, TextColor.DEFAULT, TextColor.DEFAULT);
        });
    }

    private renderTargets(targets: readonly PixelRenderTarget[]): void {
        this.forgetRemovedTargets(targets);
        this.registerTargetBacklogs(targets);
        const resources = this.world.resources;
        const hostPresenter = resources.tryGet(PixelPresenterResource);
        const hostFramebuffer = resources.tryGet(PixelFramebuffer);
        const settings = this._settingsQuery.tryGetSingleton({settings: PixelRenderSettings})?.settings;
        try {
            for (const target of targets) this.renderTarget(target, settings);
        } finally {
            if (hostPresenter !== undefined) resources.insert(hostPresenter);
            if (hostFramebuffer !== undefined) resources.insert(hostFramebuffer);
        }
    }

    private renderTarget(target: PixelRenderTarget, settings: PixelRenderSettings | undefined): void {
        const presenter = target.presenter;
        const size = presenter.size();
        if (presenter.backlogged?.() === true || size.widthPx <= 0 || size.heightPx <= 0) return;
        const camera = renderTargetCamera(target.camera, this._cameraQuery);
        const cameraCount = target.camera === undefined ? this._cameraQuery.enabledEntityCount() : SINGLE_CAMERA;
        const cameraLive = camera !== undefined && cameraComponentsOf(this.world, camera, CAMERA_SPEC) !== undefined;
        if (!cameraLive && cameraCount <= SINGLE_CAMERA) return;
        const state = this.targetState(target);
        const resources = this.world.resources;
        resources.insert(state.presenterResource);
        resources.insert(state.framebuffer);
        const framebuffer = state.framebuffer;
        const backgroundAlpha = presenter.overlaysScene === true ? TRANSPARENT_ALPHA : OPAQUE_ALPHA;
        framebuffer.beginFrame(size, backgroundColorOf(settings), pixelsPerScreenUnitXOf(settings), backgroundAlpha);
        if (cameraLive) {
            this._targetCameras.lend(this.world, camera!);
            this._walkCount++;
            super.onUpdate();
        } else {
            this.drawCameraError(framebuffer, [multipleCamerasError(cameraCount)]);
        }
        presenter.present(framebuffer.toPixelFrame());
    }

    private targetState(target: PixelRenderTarget): PixelTargetState {
        let state = this._targetStates.get(target);
        if (state === undefined) {
            state = {framebuffer: new PixelFramebuffer(), presenterResource: new PixelPresenterResource(target.presenter)};
            this._targetStates.set(target, state);
        }
        return state;
    }

    private forgetRemovedTargets(targets: readonly PixelRenderTarget[]): void {
        for (const target of this._targetStates.keys()) if (!targets.includes(target)) this._targetStates.delete(target);
    }

    private registerTargetBacklogs(targets: readonly PixelRenderTarget[]): void {
        const backlogs = this.world.presenterBacklogs;
        for (const backlog of this._targetBacklogs) {
            if (targets.some(target => target.presenter === backlog)) continue;
            backlogs.remove(backlog);
            this._targetBacklogs.delete(backlog);
        }
        for (const target of targets) {
            const presenter = target.presenter;
            if (!reportsPresentation(presenter) || presenter === this._presenterBacklog || this._targetBacklogs.has(presenter)) continue;
            backlogs.add(presenter);
            this._targetBacklogs.add(presenter);
        }
    }

    private unregisterTargetBacklogs(): void {
        for (const backlog of this._targetBacklogs) this.world.presenterBacklogs.remove(backlog);
        this._targetBacklogs.clear();
    }

    private leaveTargets(): void {
        this._targetCameras.release(this.world);
        this._targetStates.clear();
        this.unregisterTargetBacklogs();
    }

    override onEnable(): void {
        this.world.renderers.add("cpu");
        super.onEnable();
        const presenter = PixelPresenterResource.presenterOf(this.world);
        presenter.start();
        if (reportsPresentation(presenter)) {
            this._presenterBacklog = presenter;
            this.world.presenterBacklogs.add(presenter);
        }
        this.update();
    }

    override onDisable(): void {
        PixelPresenterResource.presenterOf(this.world).stop();
        if (this._presenterBacklog !== undefined) {
            this.world.presenterBacklogs.remove(this._presenterBacklog);
            this._presenterBacklog = undefined;
        }
        this.leaveTargets();
        super.onDisable();
        this.world.renderers.remove("cpu");
    }
}
