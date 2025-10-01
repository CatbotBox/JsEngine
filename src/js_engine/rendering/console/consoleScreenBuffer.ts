import {Ansi} from "./ansi";
import {ScreenSize} from "../screenSize";
import {ConsoleImage} from "./consoleImage";

import {Resource} from "../../core";

export class ConsoleScreenBuffer extends Resource {
    private _dualScreenBuffer: [ScreenBuffer, ScreenBuffer] = [new ScreenBuffer(), new ScreenBuffer()];
    private _bufferIndex: 0 | 1 = 0;

    public get screenBuffer(): ScreenBuffer {
        return this._dualScreenBuffer[this._bufferIndex];
    }

    public swapBuffer(): void {
        this._bufferIndex = this._bufferIndex === 1 ? 0 : 1;
    }
}

class ScreenBuffer {
    private width = 0;
    private height = 0;
    private depthBuffer: number[][] = []
    private cells: string[][] = [];

    /**
     * (Re)initialize the backing 2D cell array with the given background char.
     */
    public render({screenSize}: { screenSize: ScreenSize }, backgroundChar: string) {
        this.width = Math.max(0, screenSize.x | 0);
        this.height = Math.max(0, screenSize.y | 0);
        this.cells = Array.from({length: this.height}, () =>
            Array.from({length: this.width}, () => backgroundChar)
        );
        this.depthBuffer = Array.from({length: this.height}, () =>
            Array.from({length: this.width}, () => Number.NEGATIVE_INFINITY)
        );
    }

    public renderDebug({screenSize}: { screenSize: ScreenSize }) {
        this.width = Math.max(0, screenSize.x | 0);
        this.height = Math.max(0, screenSize.y | 0);
        this.cells = Array.from({length: this.height}, (_, height) =>
            Array.from({length: this.width}, (_, width) => String((width + height) % 10))
        );
    }

    /**
     * Blit ANSI-decorated image lines at a destination top-left in SCREEN space.
     * Clipped automatically to the current buffer.
     */
    public blit(image: ConsoleImage, dstX: number, dstY: number, depth: number) {
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
                if (pixel !== undefined) {
                    const existingDepth = this.depthBuffer[y][x];
                    if (existingDepth > depth) continue;
                    this.depthBuffer[y][x] = depth;
                    this.cells[y][x] = pixel;
                }
            }
        }
    }

    /**
     * Finalize the current cells to a screen string.
     */
    public flush(): string {
        const lines = this.cells.map(row => row.join(''));
        return lines.join('\n') + Ansi.control.reset;
    }
}