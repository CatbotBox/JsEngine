import {System} from "../../engine/core";
import type {Entity} from "../../engine/core";
import {Camera} from "../../engine/rendering/camera";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {SCREEN_UNIT_HEIGHT_PER_WIDTH} from "../../engine/rendering/screenUnits";
import {cameraComponentsOf, RenderCameraOverride, renderCameraComponents, renderCameraEntity, renderTargetCamera} from "../../engine/rendering/renderCameraOverride";
import {PixelPresenterResource, PixelRenderTargets} from "./pixelPresenterResource";
import type {PixelRenderTarget} from "./pixelPresenterResource";
import type {PixelPresenterSize} from "./pixelPresenter";
import {PixelRenderSettings, pixelsPerScreenUnitXOf} from "./pixelRenderSettings";

const NO_SCALE_APPLIED = 0;
const SCREEN_SIZE_SPEC = {screenSize: ScreenSize};

export interface PixelScreenSize {
    readonly x: number;
    readonly y: number;
}

interface TargetSizing {
    stale: boolean;
    sizedCamera: Entity | undefined;
    readonly stopWatchingResize: () => void;
}

export class PixelCameraSizingSystem extends System {
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize]);
    private _settingsQuery = this.createEntityQuery([PixelRenderSettings]);
    private _sizeStale: boolean = true;
    private _sizedCamera: Entity | undefined;
    private _appliedPixelsPerScreenUnitX = NO_SCALE_APPLIED;
    private _stopWatchingResize: (() => void) | undefined;
    private readonly _targetSizings = new Map<PixelRenderTarget, TargetSizing>();

    public static screenSizeFor({widthPx, heightPx}: PixelPresenterSize, pixelsPerScreenUnitX: number): PixelScreenSize {
        return {x: widthPx / pixelsPerScreenUnitX, y: heightPx / (pixelsPerScreenUnitX * SCREEN_UNIT_HEIGHT_PER_WIDTH)};
    }

    override systemGroup() {
        return RenderingSystemGroup;
    }

    protected onCreate() {
        this.requireQueryOrResourceForUpdate(this._cameraQuery, RenderCameraOverride, PixelRenderTargets);
        this._stopWatchingResize = PixelPresenterResource.presenterOf(this.world).onResize(() => {
            this._sizeStale = true;
        });
    }

    protected onDestroy() {
        this._stopWatchingResize?.();
        this._stopWatchingResize = undefined;
        this.forgetTargets();
    }

    onUpdate() {
        const pixelsPerScreenUnitX = pixelsPerScreenUnitXOf(this._settingsQuery.tryGetSingleton({settings: PixelRenderSettings})?.settings);
        const targets = PixelRenderTargets.targetsOf(this.world);
        if (targets.length > 0) {
            this.sizeTargets(targets, pixelsPerScreenUnitX);
            return;
        }
        if (this.forgetTargets()) return;
        const camera = renderCameraEntity(this.world, this._cameraQuery);
        const sameCamera = camera === undefined || camera === this._sizedCamera;
        if (!this._sizeStale && sameCamera && pixelsPerScreenUnitX === this._appliedPixelsPerScreenUnitX) return;
        this._sizeStale = false;
        this._sizedCamera = camera;
        this._appliedPixelsPerScreenUnitX = pixelsPerScreenUnitX;
        this.refreshSize(pixelsPerScreenUnitX);
    }

    onEnable(): void {
        this._sizeStale = true;
        for (const sizing of this._targetSizings.values()) sizing.stale = true;
    }

    private sizeTargets(targets: readonly PixelRenderTarget[], pixelsPerScreenUnitX: number): void {
        this.forgetRemovedTargets(targets);
        const unitChanged = pixelsPerScreenUnitX !== this._appliedPixelsPerScreenUnitX;
        this._appliedPixelsPerScreenUnitX = pixelsPerScreenUnitX;
        for (const target of targets) {
            const sizing = this.targetSizing(target);
            const camera = renderTargetCamera(target.camera, this._cameraQuery);
            if (camera === undefined || (!sizing.stale && !unitChanged && camera === sizing.sizedCamera)) continue;
            const presented = target.presenter.size();
            const screenSize = cameraComponentsOf(this.world, camera, SCREEN_SIZE_SPEC)?.screenSize;
            if (presented.widthPx <= 0 || presented.heightPx <= 0 || screenSize === undefined) {
                sizing.stale = true;
                continue;
            }
            sizing.stale = false;
            sizing.sizedCamera = camera;
            const {x, y} = PixelCameraSizingSystem.screenSizeFor(presented, pixelsPerScreenUnitX);
            if (screenSize.x === x && screenSize.y === y) continue;
            screenSize.x = x;
            screenSize.y = y;
        }
    }

    private targetSizing(target: PixelRenderTarget): TargetSizing {
        let sizing = this._targetSizings.get(target);
        if (sizing === undefined) {
            const created: TargetSizing = {
                stale: true,
                sizedCamera: undefined,
                stopWatchingResize: target.presenter.onResize(() => {
                    created.stale = true;
                }),
            };
            this._targetSizings.set(target, sizing = created);
        }
        return sizing;
    }

    private forgetRemovedTargets(targets: readonly PixelRenderTarget[]): void {
        for (const [target, sizing] of this._targetSizings) {
            if (targets.includes(target)) continue;
            sizing.stopWatchingResize();
            this._targetSizings.delete(target);
        }
    }

    private forgetTargets(): boolean {
        if (this._targetSizings.size === 0) return false;
        for (const sizing of this._targetSizings.values()) sizing.stopWatchingResize();
        this._targetSizings.clear();
        this._sizeStale = true;
        return true;
    }

    private refreshSize(pixelsPerScreenUnitX: number) {
        const {x, y} = PixelCameraSizingSystem.screenSizeFor(PixelPresenterResource.presenterOf(this.world).size(), pixelsPerScreenUnitX);
        const cameraEntity = renderCameraComponents(this.world, this._cameraQuery, SCREEN_SIZE_SPEC);
        if (cameraEntity === undefined) {
            this._sizeStale = true;
            return;
        }
        const screenSize = cameraEntity.screenSize;
        if (screenSize.x === x && screenSize.y === y) return;
        screenSize.x = x;
        screenSize.y = y;
    }
}
