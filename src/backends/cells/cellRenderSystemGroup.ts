import {SystemGroup} from "../../engine/core";
import {Camera} from "../../engine/rendering/camera";
import {consoleOverride} from "../../engine/debugging";
import {originalConsole as display} from "../../engine/debugging/originalConsole";
import {CellCameraSizingSystem} from "./cellCameraSizingSystem";
import {Ansi} from "./ansiEncoding";
import {CellGrid} from "./cellGrid";
import {CellRenderSettings} from "./cellRenderSettings";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {CellSurfaceResource} from "./cellSurfaceResource";

const PRIORITY_AFTER_CAMERA_SIZING = 100;
const CURSOR_HOME = "\x1b[H";
const ERASE_BELOW_CURSOR = "\x1b[J";
const AUTOWRAP_OFF = "\x1b[?7l";
const AUTOWRAP_ON = "\x1b[?7h";
const CRLF = "\r\n";

export class CellRenderSystemGroup extends SystemGroup {

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize]);
    private _settingsQuery = this.createEntityQuery([CellRenderSettings]);

    private _prevRows: string[] = [];
    private _prevWidth = -1;
    private _forceRedraw = true;

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
        display.clear();
    }

    onUpdate() {
        const surface = CellSurfaceResource.surfaceOf(this.world);
        if (surface.backlogged?.() === true) {
            this._forceRedraw = true;
            return;
        }
        const dualScreenBuffer = this.world.resources.getOrCreate(CellGrid);
        const screenBuffer = dualScreenBuffer.screenBuffer;
        try {
            const cameraEntity = this._cameraQuery.getSingleton({
                camera: Camera,
                screenSize: ScreenSize,
            });

            const settings = this._settingsQuery.tryGetSingleton({settings: CellRenderSettings});
            const backgroundChar = settings?.settings.backgroundChar ?? CellRenderSettings.DEFAULT_BACKGROUND_CHAR;
            screenBuffer.beginFrame(cameraEntity, backgroundChar);
        } catch (error) {
            const camCount = this._cameraQuery.entityCount();
            surface.write(CURSOR_HOME);
            if (camCount == 0) {
                surface.write("ERROR: NO CAMERA ENTITIES FOUND");
            } else if (camCount > 1) {
                surface.write("ERROR: MULTIPLE CAMERA ENTITIES FOUND (" + camCount + ")");
            } else {
                surface.write("ERROR: UNEXPECTED ERROR HAPPENED WITH CAMERA SYSTEM");
                surface.write(String(error));
            }

            surface.write(ERASE_BELOW_CURSOR);
            this._forceRedraw = true;
        }

        super.onUpdate()

        const rows = screenBuffer.flushRows();
        const prevRows = this._prevRows;
        const fullRedraw = this._forceRedraw
            || rows.length !== prevRows.length
            || screenBuffer.cellWidth !== this._prevWidth;

        let out = "";
        if (fullRedraw) {
            out = CURSOR_HOME + rows.join(CRLF) + CRLF + ERASE_BELOW_CURSOR;
        } else {
            for (let y = 0; y < rows.length; y++) {
                if (rows[y] !== prevRows[y]) {
                    out += `\x1b[${y + 1};1H` + rows[y];
                }
            }
        }

        if (out.length > 0) {
            surface.write(out);
        }

        this._prevRows = rows;
        this._prevWidth = screenBuffer.cellWidth;
        this._forceRedraw = false;
        dualScreenBuffer.swapBuffer();

    }

    override onEnable(): void {
        super.onEnable();
        const surface = CellSurfaceResource.surfaceOf(this.world);
        consoleOverride.removeConsoleEventListener(display)
        surface.write(Ansi.modes.altScreenEnter);
        surface.write(Ansi.cursor.hide);
        surface.write(AUTOWRAP_OFF);
        this._forceRedraw = true;
        this.update();
    }

    override onDisable(): void {
        consoleOverride.addConsoleEventListener(display)
        const surface = CellSurfaceResource.surfaceOf(this.world);
        surface.write(AUTOWRAP_ON);
        surface.write(Ansi.cursor.show);
        surface.write(Ansi.modes.altScreenExit);
        super.onDisable();
    }
}
