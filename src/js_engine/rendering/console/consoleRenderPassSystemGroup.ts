import {SystemGroup} from "../../core";
import {Camera} from "../camera";
import {consoleOverride} from "../../debugging";
import {originalConsole as display} from "../../debugging/originalConsole";
import {ConsoleCameraSizingSystem} from "./consoleCameraSizingSystem";
import {Ansi} from "./ansi";
import {ConsoleScreenBuffer} from "./consoleScreenBuffer";
import {ConsoleRenderSettings} from "./consoleRenderSettings";
import {RenderingSystemGroup} from "../renderingSystemGroup";
import {ScreenSize} from "../screenSize";

const PRIORITY_AFTER_CAMERA_SIZING = 100;
const CURSOR_HOME = "\x1b[H";
const ERASE_BELOW_CURSOR = "\x1b[J";
const AUTOWRAP_OFF = "\x1b[?7l";
const AUTOWRAP_ON = "\x1b[?7h";
const CRLF = "\r\n";

export class ConsoleRenderPassSystemGroup extends SystemGroup {

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize]);
    private _settingsQuery = this.createEntityQuery([ConsoleRenderSettings]);

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
        this.world.ensureSystemExists(ConsoleCameraSizingSystem);
    }

    public onDestroy() {
        display.clear();
    }

    onUpdate() {
        if (this.world.platform.output.backlogged?.() === true) {
            this._forceRedraw = true;
            return;
        }
        const dualScreenBuffer = this.world.resources.getOrCreate(ConsoleScreenBuffer);
        const screenBuffer = dualScreenBuffer.screenBuffer;
        try {
            const cameraEntity = this._cameraQuery.getSingleton({
                camera: Camera,
                screenSize: ScreenSize,
            });

            const settings = this._settingsQuery.tryGetSingleton({settings: ConsoleRenderSettings});
            const backgroundChar = settings?.settings.backgroundChar ?? ConsoleRenderSettings.DEFAULT_BACKGROUND_CHAR;
            screenBuffer.beginFrame(cameraEntity, backgroundChar);
        } catch (error) {
            const output = this.world.platform.output;
            const camCount = this._cameraQuery.entityCount();
            output.write(CURSOR_HOME);
            if (camCount == 0) {
                output.write("ERROR: NO CAMERA ENTITIES FOUND");
            } else if (camCount > 1) {
                output.write("ERROR: MULTIPLE CAMERA ENTITIES FOUND (" + camCount + ")");
            } else {
                output.write("ERROR: UNEXPECTED ERROR HAPPENED WITH CAMERA SYSTEM");
                output.write(String(error));
            }

            output.write(ERASE_BELOW_CURSOR);
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
            this.world.platform.output.write(out);
        }

        this._prevRows = rows;
        this._prevWidth = screenBuffer.cellWidth;
        this._forceRedraw = false;
        dualScreenBuffer.swapBuffer();

    }

    override onEnable(): void {
        super.onEnable();
        consoleOverride.removeConsoleEventListener(display)
        const output = this.world.platform.output;
        output.write(Ansi.modes.altScreenEnter);
        output.write(Ansi.cursor.hide);
        output.write(AUTOWRAP_OFF);
        this._forceRedraw = true;
        this.update();
    }

    override onDisable(): void {
        consoleOverride.addConsoleEventListener(display)
        const output = this.world.platform.output;
        output.write(AUTOWRAP_ON);
        output.write(Ansi.cursor.show);
        output.write(Ansi.modes.altScreenExit);
        super.onDisable();
    }
}
