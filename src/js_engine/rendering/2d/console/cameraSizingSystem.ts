import {System} from "../../../core";
import {Camera} from "../../camera";
import {Size2d} from "../size2d";
import {ConsoleRenderingSystem} from "./consoleRenderingSystem";
import {RenderingSystemGroup} from "../../RenderingSystemGroup";

export class CameraSizingSystem extends System {
  private _cameraQuery = this.createEntityQuery([Camera, Size2d])
  private _renderingSystem: ConsoleRenderingSystem = undefined!

  override systemGroup() {
    return RenderingSystemGroup;
  }

  protected onCreate() {
    this.requireAnyForUpdate(this._cameraQuery)
    this._renderingSystem = this.world.getOrCreateSystem(ConsoleRenderingSystem);
    if (process.stdout.isTTY) {
      process.stdout.on('resize', () => {
        const cameraEntity = this._cameraQuery.getSingleton({consoleSize: Size2d})
        cameraEntity.consoleSize.x = process.stdout.columns;
        cameraEntity.consoleSize.y = process.stdout.rows - 1; // leave one row for the prompt
        console.log("Resize: " + JSON.stringify(cameraEntity.consoleSize, null, 2));
      });
    }
  }

  onUpdate() {
    // if (!this._cameraQuery.hasEntity()) {
    //   if (this._renderingSystem.enabled) this._renderingSystem.enabled = false;
    //   return;
    // }
    // if (!this._renderingSystem.enabled) this._renderingSystem.enabled = true;
    const cameraEntity = this._cameraQuery.getSingleton({
      consoleSize: Size2d
    });


    const consoleSize = cameraEntity.consoleSize;
    if (consoleSize.x === 0 || consoleSize.y === 0) {
      this.refreshSize();
      return;
    }

  }

  public refreshSize() {
    const defaultSize = {columns: 24, rows: 80};
    const cameraEntity = this._cameraQuery.getSingleton({consoleSize: Size2d})

    if (process.stdout && process.stdout.isTTY) {
      cameraEntity.consoleSize.x = process.stdout.columns;
      cameraEntity.consoleSize.y = process.stdout.rows - 1; // leave one row for the prompt
      return
    }
    if (process.stderr && process.stderr.isTTY) {
      cameraEntity.consoleSize.x = process.stderr.columns;
      cameraEntity.consoleSize.y = process.stderr.rows - 1; // leave one row for the prompt
      return
    }

    // last-resort: typical env vars on Unix-like systems
    const cols = Number(process.env.COLUMNS);
    const rows = Number(process.env.LINES || process.env.ROWS);
    cameraEntity.consoleSize.x = Number.isFinite(cols) ? cols : defaultSize.columns;
    cameraEntity.consoleSize.y = (Number.isFinite(rows) ? rows : defaultSize.rows) - 1; // leave one row for the prompt

    console.log("Resize: " + JSON.stringify(cameraEntity.consoleSize, null, 2));
  }
}