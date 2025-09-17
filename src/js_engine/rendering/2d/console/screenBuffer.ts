import {LocalScale} from "../../../translation/localScale";
import {Ansi} from "./ansi";
import {ConsoleImage} from "./components";

export class ScreenBuffer {
  private width = 0;
  private height = 0;
  private cells: string[][] = [];
  public screenBuffer: string = "";

  /**
   * (Re)initialize the backing 2D cell array with the given background char.
   */
  public render({consoleSize}: { consoleSize: LocalScale }, backgroundChar: string) {
    this.width = Math.max(0, consoleSize.x | 0);
    this.height = Math.max(0, consoleSize.y | 0);
    this.cells = Array.from({length: this.height}, () =>
      Array.from({length: this.width}, () => backgroundChar)
    );
    this.screenBuffer = "";
  }

  public renderDebug({consoleSize}: { consoleSize: LocalScale }) {
    this.width = Math.max(0, consoleSize.x | 0);
    this.height = Math.max(0, consoleSize.y | 0);
    this.cells = Array.from({length: this.height}, (_, height) =>
      Array.from({length: this.width}, (_, width) => String((width + height) % 10))
    );
    this.screenBuffer = "";
  }

  /**
   * Blit ANSI-decorated image lines at a destination top-left in SCREEN space.
   * Clipped automatically to the current buffer.
   */
  public blit(image: ConsoleImage, dstX: number, dstY: number) {
    const pixels = image.pixels;
    if (!this.cells.length) return;

    for (let row = 0; row < pixels.length; row++) {
      const y = dstY + row;
      if (y < 0 || y >= this.height) continue;
      const rowPixels = pixels[row];
      for (let col = 0; col < rowPixels.length; col++) {
        const x = dstX + col;
        if (x < 0 || x >= this.width) continue;
        const pixel = rowPixels[col];
        if (pixel !== undefined) this.cells[y][x] = pixel;
      }
    }
  }

  /**
   * Finalize the current cells to a screen string.
   */
  public flush(): string {
    const lines = this.cells.map(row => row.join(''));
    this.screenBuffer = lines.join('\n') + Ansi.control.reset;
    return this.screenBuffer;
  }
}