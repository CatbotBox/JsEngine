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

// Cell representations, chosen per cell each frame.
const KIND_BACKGROUND = 0; // background char (run-length encoded at flush)
const KIND_RGB = 1;        // packed 0xRRGGBB background color + space (3D raster output)
const KIND_TEXT = 2;       // arbitrary self-contained ANSI string (2D sprites / HUD glyphs)

/**
 * A cell grid holding depth + cell contents in flat typed arrays instead of
 * per-cell ANSI strings. 3D output lives as packed RGB ints and only becomes
 * ANSI text at flush time, where identical adjacent colors share one escape
 * sequence (run-length), shrinking both CPU time and bytes written to the TTY.
 */
export class ScreenBuffer {
    private width = 0;
    private height = 0;
    private depth = new Float32Array(0);
    private kind = new Uint8Array(0);
    private rgb = new Int32Array(0);
    private text: (string | undefined)[] = [];

    private backgroundFull = "";
    private backgroundGlyph = " ";

    // Escape sequences for packed colors are memoized; depth-faded scenes reuse
    // a small palette of colors frame after frame.
    private static escapeCache = new Map<number, string>();

    public get cellWidth(): number {
        return this.width;
    }

    public get cellHeight(): number {
        return this.height;
    }

    /**
     * (Re)initialize the cell grid with the given background char. Buffers are
     * only reallocated when the screen size actually changes.
     */
    public render({screenSize}: { screenSize: ScreenSize }, backgroundChar: string) {
        this.resize(Math.max(0, screenSize.x | 0), Math.max(0, screenSize.y | 0));

        if (backgroundChar !== this.backgroundFull) {
            this.backgroundFull = backgroundChar;
            const glyph = Ansi.strip(backgroundChar);
            // A background with no visible glyph can't be run-length encoded;
            // fall back to repeating the full string (old behavior).
            this.backgroundGlyph = glyph.length > 0 ? glyph : backgroundChar;
        }

        const cellCount = this.width * this.height;
        this.depth.fill(Number.POSITIVE_INFINITY, 0, cellCount);
        this.kind.fill(KIND_BACKGROUND, 0, cellCount);
    }

    public renderDebug({screenSize}: { screenSize: ScreenSize }) {
        this.resize(Math.max(0, screenSize.x | 0), Math.max(0, screenSize.y | 0));
        const cellCount = this.width * this.height;
        this.depth.fill(Number.POSITIVE_INFINITY, 0, cellCount);
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const idx = y * this.width + x;
                this.kind[idx] = KIND_TEXT;
                this.text[idx] = String((x + y) % 10);
            }
        }
    }

    private resize(width: number, height: number): void {
        if (width === this.width && height === this.height) return;
        this.width = width;
        this.height = height;
        const cellCount = width * height;
        this.depth = new Float32Array(cellCount);
        this.kind = new Uint8Array(cellCount);
        this.rgb = new Int32Array(cellCount);
        this.text = new Array(cellCount);
    }

    /**
     * Blit ANSI-decorated image lines at a destination top-left in SCREEN space.
     * Clipped automatically to the current buffer.
     */
    //depth refers to distance from camera
    public blit(image: ConsoleImage, dstX: number, dstY: number, depth: number) {
        const pixels = image.pixels;
        if (this.width === 0 || this.height === 0) return;

        for (let row = 0; row < pixels.length; row++) {
            const y = dstY + row;
            if (y < 0 || y >= this.height) continue;
            const rowPixels = pixels[row];
            for (let col = 0; col < rowPixels.length; col++) {
                const x = dstX + col;
                if (x < 0 || x >= this.width) continue;
                const pixel = rowPixels[col];
                if (pixel === undefined) continue;
                this.setPixels(pixel, x, y, depth);
            }
        }
    }

    //depth refers to distance from camera
    public setPixels(pixel: string, x: number, y: number, depth: number) {
        const idx = y * this.width + x;
        if (this.depth[idx] < depth) return;
        this.depth[idx] = depth;
        this.kind[idx] = KIND_TEXT;
        this.text[idx] = pixel;
    }

    /**
     * Depth-composite a rasterized RGB layer (flat row-major, same dimensions)
     * into this buffer. Cells the layer never touched keep depth +Infinity and
     * are skipped by the comparison.
     */
    public mergeRgbLayer(depthLayer: Float32Array, colorLayer: Int32Array): void {
        const cellCount = this.width * this.height;
        const depth = this.depth;
        const kind = this.kind;
        const rgb = this.rgb;
        // Strict comparison: untouched layer cells stay +Infinity and must not
        // beat +Infinity background cells.
        for (let i = 0; i < cellCount; i++) {
            const d = depthLayer[i];
            if (d < depth[i]) {
                depth[i] = d;
                kind[i] = KIND_RGB;
                rgb[i] = colorLayer[i];
            }
        }
    }

    private static escapeFor(color: number): string {
        let escape = ScreenBuffer.escapeCache.get(color);
        if (escape === undefined) {
            if (ScreenBuffer.escapeCache.size > 8192) ScreenBuffer.escapeCache.clear();
            escape = `\x1b[48;2;${(color >> 16) & 255};${(color >> 8) & 255};${color & 255}m`;
            ScreenBuffer.escapeCache.set(color, escape);
        }
        return escape;
    }

    /**
     * Build one self-contained ANSI string per row (each starts by asserting its
     * own colors and ends with a reset), so callers can write any subset of rows
     * in any order — the basis for damage-tracked terminal output.
     */
    public flushRows(): string[] {
        const rows: string[] = new Array(this.height);
        const {width, kind, rgb, text, backgroundFull, backgroundGlyph} = this;

        const STATE_UNKNOWN = 0, STATE_BACKGROUND = 1, STATE_RGB = 2;

        for (let y = 0; y < this.height; y++) {
            let row = "";
            let state = STATE_UNKNOWN;
            let currentColor = -1;
            const rowIndex = y * width;

            for (let x = 0; x < width; x++) {
                const idx = rowIndex + x;
                const cellKind = kind[idx];
                if (cellKind === KIND_BACKGROUND) {
                    if (state === STATE_BACKGROUND) {
                        row += backgroundGlyph;
                    } else {
                        row += backgroundFull;
                        state = STATE_BACKGROUND;
                    }
                } else if (cellKind === KIND_RGB) {
                    const color = rgb[idx];
                    if (state === STATE_RGB && color === currentColor) {
                        row += " ";
                    } else {
                        row += ScreenBuffer.escapeFor(color) + " ";
                        state = STATE_RGB;
                        currentColor = color;
                    }
                } else {
                    // Text cells are self-contained (reset ... reset), see
                    // ConsoleImage.splitIntoGlyphs — but they leave the terminal
                    // in a reset state, so re-assert colors afterwards.
                    row += text[idx];
                    state = STATE_UNKNOWN;
                }
            }
            rows[y] = row + Ansi.control.reset;
        }
        return rows;
    }

    /**
     * Finalize the current cells to a full screen string.
     */
    public flush(): string {
        return this.flushRows().join("\n");
    }
}
