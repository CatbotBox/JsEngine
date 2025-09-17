import {System} from "../../../core";
import {Camera} from "../../camera";
import {consoleOverride} from "../../../debugging/consoleOverride";
import {originalConsole as display} from "../../../debugging/originalConsole";
import {ConsoleBoundsComputeSystem} from "./consoleBoundsComputeSystem";
import {CameraSizingSystem} from "./cameraSizingSystem";
import {Ansi} from "./ansi";
import {RenderBounds} from "../../renderBounds";
import {ConsoleImage, ConsoleImageAnchor, ConsoleImageOffset, ScreenSize} from "./components";
import {ScreenBuffer} from "./screenBuffer";
import {RenderingSystemGroup} from "../../RenderingSystemGroup";
import {HudElement} from "../../hudElement";
import {LocalToWorld} from "../../../translation/localToWorld";

export class ConsoleRenderingSystem extends System {

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize, LocalToWorld]);
    private _objectQuery = this.createEntityQuery([ConsoleImage, RenderBounds], [HudElement])
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
            screenSize: ScreenSize,
            localToWorld: LocalToWorld,
        });
        const cameraBounds = new RenderBounds();
        const position = cameraEntity.localToWorld.position;
        const screenSize = cameraEntity.screenSize;
        const x0 = position[0] - 0.5 * screenSize.x;
        const y0 = position[1] - 0.5 * screenSize.y;
        const x1 = x0 + screenSize.x;
        const y1 = y0 + screenSize.y;

        cameraBounds.xMin = Math.min(x0, x1);
        cameraBounds.xMax = Math.max(x0, x1);
        cameraBounds.yMin = Math.min(y0, y1);
        cameraBounds.yMax = Math.max(y0, y1);
        cameraBounds.zMin = -1000;
        cameraBounds.zMax = 1000;


        // Prepare current buffer
        const cur = this._dualScreenBuffer[this._bufferIndex];
        cur.render(cameraEntity, this._backgroundChar);
        // cur.renderDebug(cameraEntity);

        this.drawObjects(cur, cameraBounds);
        this.drawHud(cur, cameraEntity)

        this.sendFinalFrame(cur)
    }

    private drawObjects(cur: ScreenBuffer, cameraBounds: RenderBounds) {
        const imageEntities = this._objectQuery
            .stream({bounds: RenderBounds, img: ConsoleImage})
            .collect()
            .filter(({bounds}) => RenderBounds.intersects(cameraBounds, bounds));

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

    private drawHud(cur: ScreenBuffer, cameraEntity: { screenSize: ScreenSize }) {
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
            const screenW = cameraEntity.screenSize.x | 0;
            const screenH = cameraEntity.screenSize.y | 0;

            // Place top-left so that the anchor "point" on the image aligns to the same
            // anchor "point" on the screen
            const sx = Math.floor(ax * (screenW - img.sizeX)) + ((offset?.x ?? 0) | 0);
            const sy = Math.floor(ay * (screenH - img.sizeY)) + ((offset?.y ?? 0) | 0);


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
