import {SystemGroup} from "../../engine/core";
import {Camera} from "../../engine/rendering/camera";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {TextColor} from "../../engine/rendering/textColor";
import {PixelCameraSizingSystem} from "./pixelCameraSizingSystem";
import {PixelFramebuffer} from "./pixelFramebuffer";
import {PixelPresenterResource} from "./pixelPresenterResource";
import {backgroundColorOf, PixelRenderSettings, pixelsPerScreenUnitXOf} from "./pixelRenderSettings";
import {PixelTextRasterizer} from "./pixelTextRasterizer";

const PRIORITY_AFTER_CAMERA_SIZING = 100;
const ERROR_TEXT_LEFT_PX = 0;
const ERROR_TEXT_DEPTH = Number.NEGATIVE_INFINITY;

export class PixelRenderSystemGroup extends SystemGroup {

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize]);
    private _settingsQuery = this.createEntityQuery([PixelRenderSettings]);
    private _errorText = new PixelTextRasterizer();

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return PRIORITY_AFTER_CAMERA_SIZING;
    }

    protected onCreate() {
        this.requireAllForUpdate(this._cameraQuery);
        this.world.ensureSystemExists(PixelCameraSizingSystem);
    }

    public onDestroy() {
        PixelPresenterResource.presenterOf(this.world).dispose?.();
    }

    onUpdate() {
        const presenter = PixelPresenterResource.presenterOf(this.world);
        if (presenter.backlogged?.() === true) return;
        const framebuffer = this.world.resources.getOrCreate(PixelFramebuffer);
        const settings = this._settingsQuery.tryGetSingleton({settings: PixelRenderSettings})?.settings;
        framebuffer.beginFrame(presenter.size(), backgroundColorOf(settings), pixelsPerScreenUnitXOf(settings));

        const cameraError = this.cameraError();
        if (cameraError === undefined) super.onUpdate();
        else this.drawCameraError(framebuffer, cameraError);
        presenter.present(framebuffer.toPixelFrame());
    }

    private cameraError(): string[] | undefined {
        try {
            this._cameraQuery.getSingleton({camera: Camera, screenSize: ScreenSize});
            return undefined;
        } catch (error) {
            const cameraCount = this._cameraQuery.enabledEntityCount();
            if (cameraCount == 0) return ["ERROR: NO CAMERA ENTITIES FOUND"];
            if (cameraCount > 1) return ["ERROR: MULTIPLE CAMERA ENTITIES FOUND (" + cameraCount + ")"];
            return ["ERROR: UNEXPECTED ERROR HAPPENED WITH CAMERA SYSTEM", String(error)];
        }
    }

    private drawCameraError(framebuffer: PixelFramebuffer, lines: readonly string[]): void {
        lines.forEach((line, row) => {
            this._errorText.drawString(framebuffer, line, ERROR_TEXT_LEFT_PX, row * framebuffer.pixelsPerScreenUnitY, ERROR_TEXT_DEPTH, TextColor.DEFAULT, TextColor.DEFAULT);
        });
    }

    override onEnable(): void {
        super.onEnable();
        PixelPresenterResource.presenterOf(this.world).start();
        this.update();
    }

    override onDisable(): void {
        PixelPresenterResource.presenterOf(this.world).stop();
        super.onDisable();
    }
}
