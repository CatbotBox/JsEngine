import {SystemGroup} from "../../core";
import {Camera} from "../camera";
import {consoleOverride} from "../../debugging/consoleOverride";
import {originalConsole as display} from "../../debugging/originalConsole";
import {ConsoleCameraSizingSystem} from "./consoleCameraSizingSystem";
import {Ansi} from "./ansi";
import {ConsoleScreenBuffer} from "./consoleScreenBuffer";
import {RenderingSystemGroup} from "../renderingSystemGroup";
import {ScreenSize} from "../screenSize";

export class ConsoleRenderPassSystemGroup extends SystemGroup {

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize]);

    private _backgroundChar: string = Ansi.colors.bg.black + Ansi.colors.fg.black + " ";
    private _prevScreen: string = ""

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return 100; // after camera sizing
    }

    set backgroundChar(value: string) {
        this._backgroundChar = value;
    }

    protected onCreate() {
        this.requireAllForUpdate(this._cameraQuery) // always require a camera
        this.world.ensureSystemExists(ConsoleCameraSizingSystem);
    }

    public onDestroy() {
        display.clear();
    }

    onUpdate() {
        const dualScreenBuffer = this.world.resources.getOrCreate(ConsoleScreenBuffer);
        const screenBuffer = dualScreenBuffer.screenBuffer;
        try {
            const cameraEntity = this._cameraQuery.getSingleton({
                camera: Camera,
                screenSize: ScreenSize,
            });

            // Prepare current buffer

            screenBuffer.render(cameraEntity, this._backgroundChar);
        } catch (error) {
            const camCount = this._cameraQuery.entityCount();
            process.stdout.write("\x1b[H");   // cursor to 1,1 (home)
            if (camCount == 0) {
                process.stdout.write("ERROR: NO CAMERA ENTITIES FOUND");
            } else if (camCount > 1) {
                process.stdout.write("ERROR: MULTIPLE CAMERA ENTITIES FOUND (" + camCount + ")");
            } else {
                process.stdout.write("ERROR: UNEXPECTED ERROR HAPPENED WITH CAMERA SYSTEM");
                process.stdout.write(String(error));
            }

            process.stdout.write("\x1b[J");   // clear to end of screen (handles shorter frames)
        }


        super.onUpdate()

        const frame = screenBuffer.flush();

        if (frame === this._prevScreen) {
            // identical frame, skip render
            return;
        }

        process.stdout.write("\x1b[H");   // cursor to 1,1 (home)
        process.stdout.write(frame);      // write the full frame
        process.stdout.write("\x1b[J");   // clear to end of screen (handles shorter frames)

        this._prevScreen = frame;
        // swap buffers
        dualScreenBuffer.swapBuffer();

    }


    override onEnable(): void {
        console.log("Entering Alt Mode")
        super.onEnable();
        consoleOverride.removeConsoleEventListener(display)
        process.stdout.write(Ansi.modes.altScreenEnter); // alt buffer + save cursor
        process.stdout.write(Ansi.cursor.hide);
        process.stdout.write("\x1b[?7l");    // disable autowrap
        this.update();
    }

    override onDisable(): void {
        consoleOverride.addConsoleEventListener(display)
        process.stdout.write("\x1b[?7h");    // re-enable autowrap
        process.stdout.write(Ansi.cursor.show);
        process.stdout.write(Ansi.modes.altScreenExit); // back to main + restore cursor
        super.onDisable();
        console.log("Exiting Alt Mode")
    }
}
