import {Component, System} from "../../core";
import {directConsoleAccess} from "../../debugging/console";

export class Position2d extends Component {
  public x: number = 0;
  public y: number = 0;
}

export class Size2 extends Component {
  public x: number = 0;
  public y: number = 0;
}

export class Bounds extends Component {
  public xMin: number = 0;
  public yMin: number = 0;
  public xMax: number = 0;
  public yMax: number = 0;

  public intersects(other: Bounds): boolean {
    return !(
      other.xMin > this.xMax || other.xMax < this.xMin ||
      other.yMin > this.yMax || other.yMax < this.yMin
    );
  }

  // Use PositionAnchor/PositionOffset so the types line up with your components
  public recalculate(input: {
    position: Position2d,
    size: Size2
    anchor?: PositionAnchor,
    offset?: PositionOffset,
  }): void {
    const {position, size, anchor, offset,} = input
    // base position after offset
    const px = position.x + (offset?.x || 0);
    const py = position.y + (offset?.y || 0);

    // parse anchor -> fractional anchor (0=left/top, 0.5=center/middle, 1=right/bottom)
    const [v, h] = anchor?.anchorPosition.split('-') as [
        'top' | 'middle' | 'bottom',
        'left' | 'center' | 'right'
    ] || ["top", "bottom"];

    const ax = h === 'left' ? 0 : h === 'center' ? 0.5 : 1;    // horizontal anchor
    const ay = v === 'top' ? 0 : v === 'middle' ? 0.5 : 1;     // vertical anchor

    // compute top-left corner from anchor; handle negative sizes robustly
    const x0 = px - ax * size.x;
    const y0 = py - ay * size.y;
    const x1 = x0 + size.x;
    const y1 = y0 + size.y;

    this.xMin = Math.min(x0, x1);
    this.xMax = Math.max(x0, x1);
    this.yMin = Math.min(y0, y1);
    this.yMax = Math.max(y0, y1);
  }
}

export class BoundsComputeSystem extends System {
  _query = this.createEntityQuery([Position2d, Size2, Bounds])

  onUpdate() {
    this._query.stream({
      position: Position2d,
      anchor: PositionAnchor,
      offset: PositionOffset,
      size: Size2,
      bounds: Bounds,
    }).forEach(({bounds, ...others}) => {
      bounds.recalculate(others);
    })
  }
}

export class PositionAnchor extends Component {
  public anchorPosition: `${'top' | 'middle' | 'bottom'}-${'left' | 'center' | 'right'}` = 'top-left';
}

export class PositionOffset extends Component {
  public x: number = 0;
  public y: number = 0;
}

export class Camera extends Component {

}


export class ConsoleRenderingSystem extends System {
  private _cameraQuery = this.createEntityQuery([Camera, Size2, Position2d])

  protected onCreate() {
    this.world.getOrCreateSystem(BoundsComputeSystem);

    if (process.stdout.isTTY) {
      process.stdout.on('resize', () => {
        const cameraEntity = this._cameraQuery.getSingleton({consoleSize: Size2})
        cameraEntity.consoleSize.y = process.stdout.columns;
        cameraEntity.consoleSize.x = process.stdout.rows;
        console.log("Resize: " + JSON.stringify(cameraEntity.consoleSize, null, 2));
      });
    }
  }

  onUpdate() {
    if (!this._cameraQuery.hasEntity()) return;
    const cameraEntity = this._cameraQuery.getSingleton({
      camera: Camera,
      position: Position2d,
      consoleSize: Size2,
    });


    const consoleSize = cameraEntity.consoleSize;
    if (consoleSize.x === 0 || consoleSize.y === 0) {
      this.refreshSize();
      return;
    }
    const screenBuffer: string[] = [];
    for (let y = 0; y < consoleSize.y; y++) {
      const row: string[] = [];
      for (let x = 0; x < consoleSize.x; x++) {
        row.push('0');
      }
      screenBuffer.push(row.join(''));
    }
    directConsoleAccess.clear()
    directConsoleAccess.log(screenBuffer.join('\n'));
    directConsoleAccess.log(JSON.stringify(cameraEntity.position, null, 2));
  }

  public refreshSize() {
    const defaultSize = {columns: 24, rows: 80};
    const cameraEntity = this._cameraQuery.getSingleton({consoleSize: Size2})

    if (process.stdout && process.stdout.isTTY) {
      cameraEntity.consoleSize.y = process.stdout.columns;
      cameraEntity.consoleSize.x = process.stdout.rows;
    }
    if (process.stderr && process.stderr.isTTY) {
      cameraEntity.consoleSize.y = process.stderr.columns;
      cameraEntity.consoleSize.x = process.stderr.rows;
    }

    // last-resort: typical env vars on Unix-like systems
    const cols = Number(process.env.COLUMNS);
    const rows = Number(process.env.LINES || process.env.ROWS);
    cameraEntity.consoleSize.y = Number.isFinite(cols) ? cols : defaultSize.columns;
    cameraEntity.consoleSize.x = Number.isFinite(rows) ? rows : defaultSize.rows;

    console.log("Resize: " + JSON.stringify(cameraEntity.consoleSize, null, 2));
  }
}