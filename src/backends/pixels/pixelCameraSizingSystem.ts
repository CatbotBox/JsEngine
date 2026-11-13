import {System} from "../../engine/core";
import {Camera} from "../../engine/rendering/camera";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {SCREEN_UNIT_HEIGHT_PER_WIDTH} from "../../engine/rendering/screenUnits";
import {PixelPresenterResource} from "./pixelPresenterResource";
import type {PixelPresenterSize} from "./pixelPresenter";
import {PixelRenderSettings, pixelsPerScreenUnitXOf} from "./pixelRenderSettings";

const NO_SCALE_APPLIED = 0;

export interface PixelScreenSize {
    readonly x: number;
    readonly y: number;
}

export class PixelCameraSizingSystem extends System {
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize]);
    private _settingsQuery = this.createEntityQuery([PixelRenderSettings]);
    private _sizeStale: boolean = true;
    private _appliedPixelsPerScreenUnitX = NO_SCALE_APPLIED;
    private _stopWatchingResize: (() => void) | undefined;

    public static screenSizeFor({widthPx, heightPx}: PixelPresenterSize, pixelsPerScreenUnitX: number): PixelScreenSize {
        return {x: widthPx / pixelsPerScreenUnitX, y: heightPx / (pixelsPerScreenUnitX * SCREEN_UNIT_HEIGHT_PER_WIDTH)};
    }

    override systemGroup() {
        return RenderingSystemGroup;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._cameraQuery);
        this._stopWatchingResize = PixelPresenterResource.presenterOf(this.world).onResize(() => {
            this._sizeStale = true;
        });
    }

    protected onDestroy() {
        this._stopWatchingResize?.();
        this._stopWatchingResize = undefined;
    }

    onUpdate() {
        const pixelsPerScreenUnitX = pixelsPerScreenUnitXOf(this._settingsQuery.tryGetSingleton({settings: PixelRenderSettings})?.settings);
        if (!this._sizeStale && pixelsPerScreenUnitX === this._appliedPixelsPerScreenUnitX) return;
        this._sizeStale = false;
        this._appliedPixelsPerScreenUnitX = pixelsPerScreenUnitX;
        this.refreshSize(pixelsPerScreenUnitX);
    }

    onEnable(): void {
        this._sizeStale = true;
    }

    private refreshSize(pixelsPerScreenUnitX: number) {
        const {x, y} = PixelCameraSizingSystem.screenSizeFor(PixelPresenterResource.presenterOf(this.world).size(), pixelsPerScreenUnitX);
        const screenSize = this._cameraQuery.getSingleton({screenSize: ScreenSize}).screenSize;
        if (screenSize.x === x && screenSize.y === y) return;
        screenSize.x = x;
        screenSize.y = y;
    }
}
