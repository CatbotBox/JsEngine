import {System} from "../../../core";
import {Camera} from "../../camera";
import {consoleOverride} from "../../../debugging/consoleOverride";
import {originalConsole as display} from "../../../debugging/originalConsole";
import {ConsoleBoundsComputeSystem} from "./consoleBoundsComputeSystem";
import {Size2d} from "../size2d";
import {Position2d} from "../position2d";
import {CameraSizingSystem} from "./cameraSizingSystem";
import {Ansi} from "./ansi";
import {Bounds2d} from "../bounds2d";
import {ConsoleImage, ConsoleImageAnchor, ConsoleImageOffset} from "./components";
import {ScreenBuffer} from "./screenBuffer";
import {RenderingSystemGroup} from "../../RenderingSystemGroup";
import {HudElement} from "../../hudElement";

export class ConsoleRenderingSystem extends System {

    private _cameraQuery = this.createEntityQuery([Camera, Size2d, Position2d, Bounds2d])
    private _objectQuery = this.createEntityQuery([ConsoleImage, Position2d, Bounds2d], [HudElement])
    private _hudObjectQuery = this.createEntityQuery([ConsoleImage, HudElement])
    private _dualScreenBuffer: [ScreenBuffer, ScreenBuffer] = [new ScreenBuffer(), new ScreenBuffer()];
    private _bufferIndex: 0 | 1 = 0;

    private _backgroundChar: string = Ansi.colors.bg.black + Ansi.colors.fg.black + " ";

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
        this.world.getOrCreateSystem(ConsoleBoundsComputeSystem);
        // remove original console as an output as we using it
        this.requireAllForUpdate(this._cameraQuery) // always require a camera
        this.requireAnyForUpdate(this._objectQuery) // and require at least one renderer object
        this.requireAnyForUpdate(this._hudObjectQuery) // or one hud object
        this.world.getOrCreateSystem(CameraSizingSystem);
    }

    protected onDestroy() {
        display.clear();
    }

    onUpdate() {
        const cameraEntity = this._cameraQuery.getSingleton({
            camera: Camera,
            position: Position2d,
            consoleSize: Size2d,
            bounds: Bounds2d,
        });

        const cameraBounds = cameraEntity.bounds;


        // Prepare current buffer
        const cur = this._dualScreenBuffer[this._bufferIndex];
        cur.render(cameraEntity, this._backgroundChar);
        // cur.renderDebug(cameraEntity);

        this.drawObjects(cur, cameraBounds);
        this.drawHud(cur, cameraEntity)

        this.sendFinalFrame(cur)
    }

    private drawObjects(cur: ScreenBuffer, cameraBounds: Bounds2d) {
        const imageEntities = this._objectQuery
            .stream({bounds: Bounds2d, img: ConsoleImage})
            .collect()
            .filter(({bounds}) => cameraBounds.intersects(bounds));

        // Blit each object's image at its top-left corner relative to camera's top-left
        // Painter's algorithm in stream order; add your own z-index if needed.
        // World-space → screen-space transform.
        for (const {bounds, img} of imageEntities) {
            // World → screen transform (top-left anchoring)
            const screenX = Math.floor(bounds.xMin - cameraBounds.xMin);
            const screenY = Math.floor(bounds.yMin - cameraBounds.yMin);

            // The image is already sized to its visible width via ConsoleImage.size (ANSI stripped)
            // The blitter will clip to the current screen automatically.
            cur.blit(img, screenX, screenY);
        }
    }

    private drawHud(cur: ScreenBuffer, cameraEntity: { consoleSize: Size2d }) {
        // Only consider on-screen objects
        const hudEntities = this._hudObjectQuery
            .stream({offset: ConsoleImageOffset, img: ConsoleImage, anchor: ConsoleImageAnchor})
            .collect();

        // HUD elements (screen-space, not world-space)
        // HUD elements (screen-space, not world-space)
        for (const {img, anchor = new ConsoleImageAnchor(), offset = new ConsoleImageOffset()} of hudEntities) {
            // Parse anchor into fractions (0 = left/top, 0.5 = center/middle, 1 = right/bottom)
            const [v, h] = (anchor.anchorPosition).split('-') as
                ['top' | 'middle' | 'bottom', 'left' | 'center' | 'right'];

            const ax = h === 'left' ? 0 : h === 'center' ? 0.5 : 1;   // horizontal anchor
            const ay = v === 'top' ? 0 : v === 'middle' ? 0.5 : 1;   // vertical anchor

            // Screen size & image size
            const screenW = cameraEntity.consoleSize.x | 0;
            const screenH = cameraEntity.consoleSize.y | 0;
            const imgSize = img.size; // uses ANSI-stripped width

            // Place top-left so that the anchor "point" on the image aligns to the same
            // anchor "point" on the screen
            const sx = Math.floor(ax * (screenW - imgSize.x)) + ((offset?.x ?? 0) | 0);
            const sy = Math.floor(ay * (screenH - imgSize.y)) + ((offset?.y ?? 0) | 0);


            // console.log("HUD", anchor.anchorPosition, "->", sx, sy, " screen:", screenW, screenH, " img:", imgSize.x, imgSize.y)
            // Blit directly in screen space (cur = current ScreenBuffer)
            cur.blit(img, sx, sy);
        }
    }

    private sendFinalFrame(cur: ScreenBuffer) {
        const frame = cur.flush();

        const prev = this._dualScreenBuffer[this._bufferIndex ^ 1];
        if (frame === prev.screenBuffer) {
            // identical frame, skip render
            return;
        }

        process.stdout.write("\x1b[H");   // cursor to 1,1 (home)
        process.stdout.write(frame);      // write the full frame
        process.stdout.write("\x1b[J");   // clear to end of screen (handles shorter frames)

        // swap buffers
        this._bufferIndex = this._bufferIndex === 1 ? 0 : 1;
    }


    override onEnable() {
        console.log("Entering Alt Mode")
        consoleOverride.removeConsoleEventListener(display)
        process.stdout.write(Ansi.modes.altScreenEnter); // alt buffer + save cursor
        process.stdout.write(Ansi.cursor.hide);
        process.stdout.write("\x1b[?7l");    // disable autowrap
        this.update();
    }

    override onDisable() {
        console.log("Exiting Alt Mode")
        consoleOverride.addConsoleEventListener(display)
        process.stdout.write("\x1b[?7h");    // re-enable autowrap
        process.stdout.write(Ansi.cursor.show);
        process.stdout.write(Ansi.modes.altScreenExit); // back to main + restore cursor
    }
}
