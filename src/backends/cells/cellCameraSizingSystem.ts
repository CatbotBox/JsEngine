import {System} from "../../engine/core";
import type {Entity} from "../../engine/core";
import {Camera} from "../../engine/rendering/camera";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {cameraComponentsOf, RenderCameraOverride, renderCameraComponents, renderCameraEntity, renderTargetCamera} from "../../engine/rendering/renderCameraOverride";
import {CellPresenterResource, CellRenderTargets} from "./cellPresenterResource";
import type {CellRenderTarget} from "./cellPresenterResource";
import type {CellPresenterSize} from "./cellPresenter";

const NO_RESERVED_ROWS = 0;
const SCREEN_SIZE_SPEC = {screenSize: ScreenSize};

export interface CellFrameSize {
    readonly x: number;
    readonly y: number;
}

interface TargetSizing {
    stale: boolean;
    sizedCamera: Entity | undefined;
    readonly stopWatchingResize: () => void;
}

export class CellCameraSizingSystem extends System {
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize])
    private _sizeStale: boolean = true;
    private _sizedCamera: Entity | undefined;
    private _stopWatchingResize: (() => void) | undefined;
    private readonly _targetSizings = new Map<CellRenderTarget, TargetSizing>();

    public static frameSizeFor({columns, rows, reservedRows = NO_RESERVED_ROWS}: CellPresenterSize): CellFrameSize {
        return {x: columns, y: rows - reservedRows};
    }

    override systemGroup() {
        return RenderingSystemGroup;
    }

    protected onCreate() {
        this.requireQueryOrResourceForUpdate(this._cameraQuery, RenderCameraOverride, CellRenderTargets)
        this._stopWatchingResize = CellPresenterResource.presenterOf(this.world).onResize(() => {
            this._sizeStale = true;
        });
    }

    protected onDestroy() {
        this._stopWatchingResize?.();
        this._stopWatchingResize = undefined;
        this.forgetTargets();
    }

    onUpdate() {
        const targets = CellRenderTargets.targetsOf(this.world);
        if (targets.length > 0) {
            this.sizeTargets(targets);
            return;
        }
        if (this.forgetTargets()) return;
        const camera = renderCameraEntity(this.world, this._cameraQuery);
        if (!this._sizeStale && (camera === undefined || camera === this._sizedCamera)) return;
        this._sizeStale = false;
        this._sizedCamera = camera;
        this.refreshSize();
    }

    onEnable(): void {
        this._sizeStale = true;
        for (const sizing of this._targetSizings.values()) sizing.stale = true;
    }

    private sizeTargets(targets: readonly CellRenderTarget[]): void {
        this.forgetRemovedTargets(targets);
        for (const target of targets) {
            const sizing = this.targetSizing(target);
            const camera = renderTargetCamera(target.camera, this._cameraQuery);
            if (camera === undefined || (!sizing.stale && camera === sizing.sizedCamera)) continue;
            const {x, y} = CellCameraSizingSystem.frameSizeFor(target.presenter.size());
            const screenSize = cameraComponentsOf(this.world, camera, SCREEN_SIZE_SPEC)?.screenSize;
            if (x <= 0 || y <= 0 || screenSize === undefined) continue;
            sizing.stale = false;
            sizing.sizedCamera = camera;
            if (screenSize.x === x && screenSize.y === y) continue;
            screenSize.x = x;
            screenSize.y = y;
        }
    }

    private targetSizing(target: CellRenderTarget): TargetSizing {
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

    private forgetRemovedTargets(targets: readonly CellRenderTarget[]): void {
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

    public refreshSize() {
        const {x, y} = CellCameraSizingSystem.frameSizeFor(CellPresenterResource.presenterOf(this.world).size());

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
