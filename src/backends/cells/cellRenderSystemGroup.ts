import {SystemGroup} from "../../engine/core";
import {Camera} from "../../engine/rendering/camera";
import {TextColor} from "../../engine/rendering/textColor";
import {CellCameraSizingSystem} from "./cellCameraSizingSystem";
import {CellGrid} from "./cellGrid";
import type {ScreenBuffer} from "./cellGrid";
import {CellRenderSettings} from "./cellRenderSettings";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {CellPresenterResource} from "./cellPresenterResource";
import type {CellPresenter, CellRepaint} from "./cellPresenter";

const PRIORITY_AFTER_CAMERA_SIZING = 100;
const ERROR_TEXT_COLUMN = 0;
const ERROR_TEXT_DEPTH = Number.NEGATIVE_INFINITY;

interface MutableBackgroundStyle {
    glyph: number;
    foreground: TextColor;
    background: TextColor;
}

export class CellRenderSystemGroup extends SystemGroup {

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize]);
    private _settingsQuery = this.createEntityQuery([CellRenderSettings]);

    private _repaint: CellRepaint = "full";
    private _backgroundStyle: MutableBackgroundStyle = {...CellRenderSettings.DEFAULT_BACKGROUND_STYLE};

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return PRIORITY_AFTER_CAMERA_SIZING;
    }

    protected onCreate() {
        this.requireAllForUpdate(this._cameraQuery)
        this.world.ensureSystemExists(CellCameraSizingSystem);
    }

    public onDestroy() {
        CellPresenterResource.presenterOf(this.world).dispose?.();
    }

    onUpdate() {
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
            const cameraEntity = this._cameraQuery.getSingleton({
                camera: Camera,
                screenSize: ScreenSize,
            });
            screenBuffer.beginFrame(cameraEntity, backgroundStyle);
            return undefined;
        } catch (error) {
            const cameraCount = this._cameraQuery.enabledEntityCount();
            if (cameraCount == 0) return ["ERROR: NO CAMERA ENTITIES FOUND"];
            if (cameraCount > 1) return ["ERROR: MULTIPLE CAMERA ENTITIES FOUND (" + cameraCount + ")"];
            return ["ERROR: UNEXPECTED ERROR HAPPENED WITH CAMERA SYSTEM", String(error)];
        }
    }

    private drawCameraError(screenBuffer: ScreenBuffer, backgroundStyle: MutableBackgroundStyle, presenter: CellPresenter, lines: readonly string[]): void {
        screenBuffer.beginFrame({screenSize: CellCameraSizingSystem.frameSizeFor(presenter.size())}, backgroundStyle);
        lines.forEach((line, row) => {
            screenBuffer.writeText(line, ERROR_TEXT_COLUMN, row, ERROR_TEXT_DEPTH, TextColor.DEFAULT, TextColor.DEFAULT);
        });
    }

    override onEnable(): void {
        super.onEnable();
        CellPresenterResource.presenterOf(this.world).start();
        this._repaint = "full";
        this.update();
    }

    override onDisable(): void {
        CellPresenterResource.presenterOf(this.world).stop();
        super.onDisable();
    }
}
