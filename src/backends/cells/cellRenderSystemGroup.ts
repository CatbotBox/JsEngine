import {SystemGroup} from "../../engine/core";
import {Camera} from "../../engine/rendering/camera";
import {TextColor} from "../../engine/rendering/textColor";
import {CellCameraSizingSystem} from "./cellCameraSizingSystem";
import {CellGrid} from "./cellGrid";
import type {ScreenBuffer} from "./cellGrid";
import {CellRenderSettings} from "./cellRenderSettings";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {cameraComponentsOf, RENDER_CAMERA_OVERRIDE_ERROR, RenderCameraOverride, renderCameraComponents, renderTargetCamera, RenderTargetCameras} from "../../engine/rendering/renderCameraOverride";
import {CellPresenterResource, CellRenderTargets} from "./cellPresenterResource";
import type {CellRenderTarget} from "./cellPresenterResource";
import type {CellPresenter, CellRepaint} from "./cellPresenter";

const CAMERA_SPEC = {camera: Camera, screenSize: ScreenSize};
const PRIORITY_AFTER_CAMERA_SIZING = 100;
const ERROR_TEXT_COLUMN = 0;
const ERROR_TEXT_DEPTH = Number.NEGATIVE_INFINITY;
const NO_WALKS = 0;
const SINGLE_CAMERA = 1;

interface MutableBackgroundStyle {
    glyph: number;
    foreground: TextColor;
    background: TextColor;
}

interface CellTargetState {
    readonly grid: CellGrid;
    repaint: CellRepaint;
}

function multipleCamerasError(cameraCount: number): string {
    return "ERROR: MULTIPLE CAMERA ENTITIES FOUND (" + cameraCount + ")";
}

export class CellRenderSystemGroup extends SystemGroup {

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize]);
    private _settingsQuery = this.createEntityQuery([CellRenderSettings]);

    private _repaint: CellRepaint = "full";
    private _backgroundStyle: MutableBackgroundStyle = {...CellRenderSettings.DEFAULT_BACKGROUND_STYLE};
    private _walkCount = NO_WALKS;
    private readonly _targetCameras = new RenderTargetCameras();
    private readonly _targetStates = new Map<CellRenderTarget, CellTargetState>();

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
        this.requireQueryOrResourceForUpdate(this._cameraQuery, RenderCameraOverride, CellRenderTargets)
        this.world.ensureSystemExists(CellCameraSizingSystem);
    }

    public onDestroy() {
        this._targetCameras.release(this.world);
        CellPresenterResource.presenterOf(this.world).dispose?.();
    }

    onUpdate() {
        const targets = CellRenderTargets.targetsOf(this.world);
        if (targets.length > 0) {
            this.renderTargets(targets);
            return;
        }
        this.leaveTargets();
        const presenter = CellPresenterResource.presenterOf(this.world);
        if (presenter.backlogged?.() === true) {
            this._repaint = "full";
            return;
        }
        const grid = this.world.resources.getOrCreate(CellGrid);
        const screenBuffer = grid.screenBuffer;
        const backgroundStyle = this.refreshBackgroundStyle();

        const cameraError = this.beginCameraFrame(screenBuffer, backgroundStyle);
        if (cameraError === undefined) {
            this._walkCount++;
            super.onUpdate();
            presenter.present(screenBuffer.toCellFrame(), this._repaint);
        } else {
            this.drawCameraError(screenBuffer, backgroundStyle, presenter, cameraError);
            presenter.present(screenBuffer.toCellFrame(), "full");
        }
        this._repaint = "changes";
        grid.swapBuffer();
    }

    private refreshBackgroundStyle(): MutableBackgroundStyle {
        const style = this._backgroundStyle;
        const settings = this._settingsQuery.tryGetSingleton({settings: CellRenderSettings})?.settings;
        if (settings === undefined) {
            const fallback = CellRenderSettings.DEFAULT_BACKGROUND_STYLE;
            style.glyph = fallback.glyph;
            style.foreground = fallback.foreground;
            style.background = fallback.background;
        } else {
            style.glyph = settings.backgroundGlyphCodePoint();
            style.foreground = settings.backgroundGlyphColor;
            style.background = settings.backgroundColor;
        }
        return style;
    }

    private beginCameraFrame(screenBuffer: ScreenBuffer, backgroundStyle: MutableBackgroundStyle): string[] | undefined {
        try {
            const cameraEntity = renderCameraComponents(this.world, this._cameraQuery, CAMERA_SPEC);
            if (cameraEntity === undefined) return [RENDER_CAMERA_OVERRIDE_ERROR];
            screenBuffer.beginFrame(cameraEntity, backgroundStyle);
            return undefined;
        } catch (error) {
            const cameraCount = this._cameraQuery.enabledEntityCount();
            if (cameraCount == 0) return ["ERROR: NO CAMERA ENTITIES FOUND"];
            if (cameraCount > 1) return [multipleCamerasError(cameraCount)];
            return ["ERROR: UNEXPECTED ERROR HAPPENED WITH CAMERA SYSTEM", String(error)];
        }
    }

    private renderTargets(targets: readonly CellRenderTarget[]): void {
        this.forgetRemovedTargets(targets);
        const backgroundStyle = this.refreshBackgroundStyle();
        const resources = this.world.resources;
        const hostGrid = resources.tryGet(CellGrid);
        try {
            for (const target of targets) this.renderTarget(target, backgroundStyle);
        } finally {
            if (hostGrid !== undefined) resources.insert(hostGrid);
        }
    }

    private renderTarget(target: CellRenderTarget, backgroundStyle: MutableBackgroundStyle): void {
        const state = this.targetState(target);
        const presenter = target.presenter;
        const size = CellCameraSizingSystem.frameSizeFor(presenter.size());
        if (presenter.backlogged?.() === true || size.x <= 0 || size.y <= 0) {
            state.repaint = "full";
            return;
        }
        const camera = renderTargetCamera(target.camera, this._cameraQuery);
        const cameraCount = target.camera === undefined ? this._cameraQuery.enabledEntityCount() : SINGLE_CAMERA;
        const components = camera === undefined ? undefined : cameraComponentsOf(this.world, camera, CAMERA_SPEC);
        if (components === undefined && cameraCount <= SINGLE_CAMERA) return;
        const grid = state.grid;
        this.world.resources.insert(grid);
        const screenBuffer = grid.screenBuffer;
        if (components !== undefined) {
            screenBuffer.beginFrame(components, backgroundStyle);
            this._targetCameras.lend(this.world, camera!);
            this._walkCount++;
            super.onUpdate();
            presenter.present(screenBuffer.toCellFrame(), state.repaint);
        } else {
            this.drawCameraError(screenBuffer, backgroundStyle, presenter, [multipleCamerasError(cameraCount)]);
            presenter.present(screenBuffer.toCellFrame(), "full");
        }
        state.repaint = "changes";
        grid.swapBuffer();
    }

    private targetState(target: CellRenderTarget): CellTargetState {
        let state = this._targetStates.get(target);
        if (state === undefined) {
            state = {grid: new CellGrid(), repaint: "full"};
            this._targetStates.set(target, state);
        }
        return state;
    }

    private forgetRemovedTargets(targets: readonly CellRenderTarget[]): void {
        for (const target of this._targetStates.keys()) if (!targets.includes(target)) this._targetStates.delete(target);
    }

    private leaveTargets(): void {
        this._targetCameras.release(this.world);
        if (this._targetStates.size === 0) return;
        this._targetStates.clear();
        this._repaint = "full";
    }

    private drawCameraError(screenBuffer: ScreenBuffer, backgroundStyle: MutableBackgroundStyle, presenter: CellPresenter, lines: readonly string[]): void {
        screenBuffer.beginFrame({screenSize: CellCameraSizingSystem.frameSizeFor(presenter.size())}, backgroundStyle);
        lines.forEach((line, row) => {
            screenBuffer.writeText(line, ERROR_TEXT_COLUMN, row, ERROR_TEXT_DEPTH, TextColor.DEFAULT, TextColor.DEFAULT);
        });
    }

    override onEnable(): void {
        this.world.renderers.add("cpu");
        super.onEnable();
        CellPresenterResource.presenterOf(this.world).start();
        this._repaint = "full";
        this.update();
    }

    override onDisable(): void {
        this.leaveTargets();
        CellPresenterResource.presenterOf(this.world).stop();
        super.onDisable();
        this.world.renderers.remove("cpu");
    }
}
