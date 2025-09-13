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
import {ConsoleImage} from "./components";
import {ScreenBuffer} from "./screenBuffer";
import {RenderingSystemGroup} from "../../RenderingSystemGroup";

export class ConsoleRenderingSystem extends System {

  private _cameraQuery = this.createEntityQuery([Camera, Size2d, Position2d, Bounds2d])
  private _objectQuery = this.createEntityQuery([ConsoleImage, Position2d, Bounds2d], [HudElement])
  private _hudObjectQuery = this.createEntityQuery([ConsoleImage , HudElement])
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
    this.enabled = false;
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

    // Only consider on-screen objects
    const imageEntities = this._objectQuery
      .stream({bounds: Bounds2d, img: ConsoleImage})
      .collect()
      .filter(({bounds}) => cameraBounds.intersects(bounds));

    // Prepare current buffer
    const cur = this._dualScreenBuffer[this._bufferIndex];
    const prev = this._dualScreenBuffer[this._bufferIndex ^ 1];

    cur.render(cameraEntity, this._backgroundChar);

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

    const frame = cur.flush();

    if (frame === prev.screenBuffer) {
      // identical frame, skip render
      return;
    }

    display.clear();
    display.log(frame);

    // swap buffers
    this._bufferIndex = this._bufferIndex === 1 ? 0 : 1;
  }

  override onEnable() {
    console.log("Entering Alt Mode")
    consoleOverride.removeConsoleEventListener(display)
    process.stdout.write(Ansi.modes.altScreenEnter); // alt buffer + save cursor
    this.update();
  }

  override onDisable() {
    console.log("Exiting Alt Mode")
    consoleOverride.addConsoleEventListener(display)
    process.stdout.write(Ansi.modes.altScreenExit); // back to main + restore cursor
  }
}
