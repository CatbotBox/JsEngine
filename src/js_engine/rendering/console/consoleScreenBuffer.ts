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
const KIND_RGB_SPLIT = 3;  // two packed colors: top half as foreground, bottom half as background, upper-half-block glyph

const UPPER_HALF_BLOCK = "▀";

/** The minimum a blit source must provide: a grid of pre-rendered glyphs. */
export interface BlittableImage {
    readonly pixels: readonly (readonly (string | undefined)[])[];
}

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
    private rgbTop = new Int32Array(0);
    private text: (string | undefined)[] = [];

    private backgroundFull = "";
    private backgroundGlyph = " ";

    // Escape sequences for packed colors are memoized; depth-faded scenes reuse
    // a small palette of colors frame after frame.
    private static escapeCache = new Map<number, string>();
    private static foregroundEscapeCache = new Map<number, string>();

    public get cellWidth(): number {
        return this.width;
    }

    public get cellHeight(): number {
        return this.height;
    }

    /** Packed 0xRRGGBB of a solid cell drawn by the 3D pass (a half-block cell whose halves match counts), else undefined. */
    public rgbAt(x: number, y: number): number | undefined {
        const idx = y * this.width + x;
        const kind = this.kind[idx];
        if (kind === KIND_RGB) return this.rgb[idx];
        if (kind === KIND_RGB_SPLIT && this.rgbTop[idx] === this.rgb[idx]) return this.rgb[idx];
        return undefined;
    }

    /** [top, bottom] packed colors of a half-block cell whose halves differ, else undefined. */
    public splitRgbAt(x: number, y: number): [number, number] | undefined {
        const idx = y * this.width + x;
        if (this.kind[idx] !== KIND_RGB_SPLIT || this.rgbTop[idx] === this.rgb[idx]) return undefined;
        return [this.rgbTop[idx], this.rgb[idx]];
    }

    /**
     * (Re)initialize the cell grid with the given background char. Buffers are
     * only reallocated when the screen size actually changes.
     */
    public beginFrame({screenSize}: { screenSize: ScreenSize }, backgroundChar: string) {
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
        this.rgbTop = new Int32Array(cellCount);
        this.text = new Array(cellCount);
    }

    /**
     * Blit ANSI-decorated image lines at a destination top-left in SCREEN space.
     * Clipped automatically to the current buffer.
     */
    //depth refers to distance from camera
    /**
     * Blit ANSI-decorated image lines at a destination top-left in SCREEN space.
     * Clipped automatically to the current buffer.
     *
     * Takes only what it reads — a pixel grid — rather than a whole ConsoleImage,
     * so a DeepReadonly component from a read-only query row satisfies it without
     * a cast. depth is distance from the camera.
     */
    public blit(image: BlittableImage, dstX: number, dstY: number, depth: number) {
        const width = this.width, height = this.height;
        if (width === 0 || height === 0) return;
        const pixels = image.pixels;

        const rowStart = dstY < 0 ? -dstY : 0;
        const rowEnd = Math.min(pixels.length, height - dstY);
        const depths = this.depth, kinds = this.kind, texts = this.text;

        for (let row = rowStart; row < rowEnd; row++) {
            const rowPixels = pixels[row];
            const colStart = dstX < 0 ? -dstX : 0;
            const colEnd = Math.min(rowPixels.length, width - dstX);
            const lineIndex = (dstY + row) * width + dstX;
            for (let col = colStart; col < colEnd; col++) {
                const pixel = rowPixels[col];
                if (pixel === undefined) continue;
                const idx = lineIndex + col;
                if (depths[idx] < depth) continue;
                depths[idx] = depth;
                kinds[idx] = KIND_TEXT;
                texts[idx] = pixel;
            }
        }
    }

    //depth refers to distance from camera
    public setPixel(pixel: string, x: number, y: number, depth: number) {
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

    /**
     * Depth-composite two half-cell layers (top and bottom rows of each cell) into
     * half-block cells. A half the layers never touched shows backgroundColor.
     */
    public mergeRgbSplitLayer(depthTop: Float32Array, colorTop: Int32Array, depthBottom: Float32Array, colorBottom: Int32Array, backgroundColor: number): void {
        const cellCount = this.width * this.height;
        const depth = this.depth;
        const kind = this.kind;
        const rgb = this.rgb;
        const rgbTop = this.rgbTop;
        for (let i = 0; i < cellCount; i++) {
            const dTop = depthTop[i], dBottom = depthBottom[i];
            const cellDepth = dTop < dBottom ? dTop : dBottom;
            if (cellDepth < depth[i]) {
                depth[i] = cellDepth;
                kind[i] = KIND_RGB_SPLIT;
                rgbTop[i] = dTop < Number.POSITIVE_INFINITY ? colorTop[i] : backgroundColor;
                rgb[i] = dBottom < Number.POSITIVE_INFINITY ? colorBottom[i] : backgroundColor;
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

    private static foregroundEscapeFor(color: number): string {
        let escape = ScreenBuffer.foregroundEscapeCache.get(color);
        if (escape === undefined) {
            if (ScreenBuffer.foregroundEscapeCache.size > 8192) ScreenBuffer.foregroundEscapeCache.clear();
            escape = `\x1b[38;2;${(color >> 16) & 255};${(color >> 8) & 255};${color & 255}m`;
            ScreenBuffer.foregroundEscapeCache.set(color, escape);
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
        const {width, kind, rgb, rgbTop, text, backgroundFull, backgroundGlyph} = this;

        const STATE_UNKNOWN = 0, STATE_BACKGROUND = 1, STATE_RGB = 2, STATE_SPLIT = 3;

        for (let y = 0; y < this.height; y++) {
            let row = "";
            let state = STATE_UNKNOWN;
            let currentColor = -1;
            let currentTop = -1;
            const rowIndex = y * width;

            for (let x = 0; x < width; x++) {
                const idx = rowIndex + x;
                let cellKind = kind[idx];
                // A split cell whose halves match is just a solid cell; keeping it on
                // the cheaper path also keeps runs of flat color unbroken.
                if (cellKind === KIND_RGB_SPLIT && rgbTop[idx] === rgb[idx]) cellKind = KIND_RGB;

                if (cellKind === KIND_BACKGROUND) {
                    if (state === STATE_BACKGROUND) {
                        row += backgroundGlyph;
                    } else {
                        row += backgroundFull;
                        state = STATE_BACKGROUND;
                    }
                } else if (cellKind === KIND_RGB) {
                    const color = rgb[idx];
                    if ((state === STATE_RGB || state === STATE_SPLIT) && color === currentColor) {
                        row += " ";
                    } else {
                        row += ScreenBuffer.escapeFor(color) + " ";
                        currentColor = color;
                    }
                    state = STATE_RGB;
                } else if (cellKind === KIND_RGB_SPLIT) {
                    const top = rgbTop[idx], bottom = rgb[idx];
                    if (!(state === STATE_SPLIT && top === currentTop)) {
                        row += ScreenBuffer.foregroundEscapeFor(top);
                        currentTop = top;
                    }
                    if (!((state === STATE_RGB || state === STATE_SPLIT) && bottom === currentColor)) {
                        row += ScreenBuffer.escapeFor(bottom);
                        currentColor = bottom;
                    }
                    row += UPPER_HALF_BLOCK;
                    state = STATE_SPLIT;
                } else {
                    // Text cells are self-contained (reset ... reset), see
                    // ConsoleImage.splitIntoGlyphsInto — but they leave the terminal
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
