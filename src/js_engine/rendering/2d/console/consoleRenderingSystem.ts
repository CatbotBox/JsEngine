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
  private _objectQuery = this.createEntityQuery([ConsoleImage, Position2d, Bounds2d])
  private _dualScreenBuffer: [ScreenBuffer, ScreenBuffer] = [new ScreenBuffer(), new ScreenBuffer()];
  private _bufferIndex: 0 | 1 = 0;

  private _backgroundChar: string = Ansi.colors.bg.black + Ansi.colors.fg.black + " ";

  override updateGroup() {
    return RenderingSystemGroup;
  }

  override updatePriority(): number {
    return 100; // after camera sizing
  }

  set backgroundChar(value: string) {
    this._backgroundChar = value;
  }

  protected onCreate() {
    this.world.getOrCreateSystem(ConsoleBoundsComputeSystem);
    // remove original console as an output as we using it
    consoleOverride.removeConsoleEventListener(display)
    this.requireForUpdate(this._cameraQuery)
    this.requireForUpdate(this._objectQuery)
    this.world.getOrCreateSystem(CameraSizingSystem);
    this.enabled = false;
  }

  protected onDestroy() {
    display.clear();
  }

  onUpdate() {
    if (!this._cameraQuery.hasEntity()) return;

    const cameraEntity = this._cameraQuery.getSingleton({
      camera: Camera,
      position: Position2d,
      consoleSize: Size2d,
      bounds: Bounds2d,
    });

    const cameraBounds = cameraEntity.bounds;

    // Only consider on-screen objects
    const objectEntities = this._objectQuery
      .stream({bounds: Bounds2d, img: ConsoleImage})
      .collect()
      .filter(({bounds}) => cameraBounds.intersects(bounds));

    // Prepare current buffer
    const cur = this._dualScreenBuffer[this._bufferIndex];
    const prev = this._dualScreenBuffer[this._bufferIndex ^ 1];

    cur.render(cameraEntity, this._backgroundChar);

    // Blit each object's image at its top-left corner relative to camera's top-left
    // Painter's algorithm in stream order; add your own z-index if needed.
    for (const {bounds, img} of objectEntities) {
      // World → screen transform (top-left anchoring)
      const screenX = Math.floor(bounds.xMin - cameraBounds.xMin);
      const screenY = Math.floor(bounds.yMin - cameraBounds.yMin);

      // The image is already sized to its visible width via ConsoleImage.size (ANSI stripped)
      // The blitter will clip to the current screen automatically.
      cur.blit(img.image, screenX, screenY);
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
    process.stdout.write(Ansi.modes.altScreenEnter); // alt buffer + save cursor
  }

  override onDisable() {
    console.log("Exiting Alt Mode")
    process.stdout.write(Ansi.modes.altScreenExit); // back to main + restore cursor
  }
}
