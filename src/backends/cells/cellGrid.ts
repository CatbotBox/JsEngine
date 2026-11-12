import {Ansi} from "./ansiEncoding";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {TextSprite} from "../../engine/rendering/textSprite";

import {Resource} from "../../engine/core";

export class CellGrid extends Resource {
    private _dualScreenBuffer: [ScreenBuffer, ScreenBuffer] = [new ScreenBuffer(), new ScreenBuffer()];
    private _bufferIndex: 0 | 1 = 0;

    public get screenBuffer(): ScreenBuffer {
        return this._dualScreenBuffer[this._bufferIndex];
    }

    public swapBuffer(): void {
        this._bufferIndex = this._bufferIndex === 1 ? 0 : 1;
    }
}

const KIND_BACKGROUND = 0;
const KIND_RGB = 1;
const KIND_TEXT = 2;
const KIND_RGB_SPLIT = 3;

const UPPER_HALF_BLOCK = "▀";
const LOWER_HALF_BLOCK = "▄";
const NO_COLOR = -1;
const DEFAULT_BACKGROUND_ESCAPE = "\x1b[49m";

const COLOR_UNKNOWN = -1;
const COLOR_CONSOLE_BACKGROUND = -2;

const MAX_CACHED_ESCAPES = 8192;
const DECIMAL_DIGITS = 10;

export interface BlittableImage {
    readonly pixels: readonly (readonly (string | undefined)[])[];
}

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
    private backgroundEscapes = DEFAULT_BACKGROUND_ESCAPE;

    private static backgroundEscapeCache = new Map<number, string>();
    private static foregroundEscapeCache = new Map<number, string>();

    public get cellWidth(): number {
        return this.width;
    }

    public get cellHeight(): number {
        return this.height;
    }

    public rgbAt(x: number, y: number): number | undefined {
        const idx = y * this.width + x;
        const kind = this.kind[idx];
        if (kind === KIND_RGB) return this.rgb[idx];
        if (kind === KIND_RGB_SPLIT && this.isSolidSplit(idx)) return this.rgb[idx];
        return undefined;
    }

    public splitRgbAt(x: number, y: number): [number | undefined, number | undefined] | undefined {
        const idx = y * this.width + x;
        if (this.kind[idx] !== KIND_RGB_SPLIT || this.isSolidSplit(idx)) return undefined;
        const top = this.rgbTop[idx], bottom = this.rgb[idx];
        return [top === NO_COLOR ? undefined : top, bottom === NO_COLOR ? undefined : bottom];
    }

    private isSolidSplit(idx: number): boolean {
        return this.rgbTop[idx] === this.rgb[idx] && this.rgb[idx] !== NO_COLOR;
    }

    public beginFrame({screenSize}: { screenSize: ScreenSize }, backgroundChar: string) {
        this.resize(Math.max(0, screenSize.x | 0), Math.max(0, screenSize.y | 0));

        if (backgroundChar !== this.backgroundFull) {
            this.backgroundFull = backgroundChar;
            const glyph = Ansi.strip(backgroundChar);
            this.backgroundGlyph = glyph.length > 0 ? glyph : backgroundChar;
            const escapes = glyph.length > 0 ? backgroundChar.replace(glyph, "") : backgroundChar;
            this.backgroundEscapes = escapes.length > 0 ? escapes : DEFAULT_BACKGROUND_ESCAPE;
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
                this.text[idx] = String((x + y) % DECIMAL_DIGITS);
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

    public setPixel(pixel: string, x: number, y: number, depth: number) {
        const idx = y * this.width + x;
        if (this.depth[idx] < depth) return;
        this.depth[idx] = depth;
        this.kind[idx] = KIND_TEXT;
        this.text[idx] = pixel;
    }

    public mergeRgbLayer(depthLayer: Float32Array, colorLayer: Int32Array): void {
        const cellCount = this.width * this.height;
        const depth = this.depth;
        const kind = this.kind;
        const rgb = this.rgb;
        for (let i = 0; i < cellCount; i++) {
            const d = depthLayer[i];
            if (d < depth[i]) {
                depth[i] = d;
                kind[i] = KIND_RGB;
                rgb[i] = colorLayer[i];
            }
        }
    }

    public mergeRgbSplitLayer(depthTop: Float32Array, colorTop: Int32Array, depthBottom: Float32Array, colorBottom: Int32Array): void {
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
                rgbTop[i] = dTop < Number.POSITIVE_INFINITY ? colorTop[i] : NO_COLOR;
                rgb[i] = dBottom < Number.POSITIVE_INFINITY ? colorBottom[i] : NO_COLOR;
            }
        }
    }

    private static backgroundEscapeFor(color: number): string {
        let escape = ScreenBuffer.backgroundEscapeCache.get(color);
        if (escape === undefined) {
            if (ScreenBuffer.backgroundEscapeCache.size > MAX_CACHED_ESCAPES) ScreenBuffer.backgroundEscapeCache.clear();
            escape = `\x1b[48;2;${(color >> 16) & 255};${(color >> 8) & 255};${color & 255}m`;
            ScreenBuffer.backgroundEscapeCache.set(color, escape);
        }
        return escape;
    }

    private static foregroundEscapeFor(color: number): string {
        let escape = ScreenBuffer.foregroundEscapeCache.get(color);
        if (escape === undefined) {
            if (ScreenBuffer.foregroundEscapeCache.size > MAX_CACHED_ESCAPES) ScreenBuffer.foregroundEscapeCache.clear();
            escape = `\x1b[38;2;${(color >> 16) & 255};${(color >> 8) & 255};${color & 255}m`;
            ScreenBuffer.foregroundEscapeCache.set(color, escape);
        }
        return escape;
    }

    public flushRows(): string[] {
        const rows: string[] = new Array(this.height);
        const {width, kind, rgb, rgbTop, text, backgroundFull, backgroundGlyph, backgroundEscapes} = this;

        for (let y = 0; y < this.height; y++) {
            let row = "";
            let foreground = COLOR_UNKNOWN;
            let background = COLOR_UNKNOWN;
            const rowIndex = y * width;

            for (let x = 0; x < width; x++) {
                const idx = rowIndex + x;
                let cellKind = kind[idx];
                if (cellKind === KIND_RGB_SPLIT && this.isSolidSplit(idx)) cellKind = KIND_RGB;

                if (cellKind === KIND_BACKGROUND) {
                    if (background === COLOR_CONSOLE_BACKGROUND && foreground === COLOR_CONSOLE_BACKGROUND) {
                        row += backgroundGlyph;
                    } else {
                        row += backgroundFull;
                        background = COLOR_CONSOLE_BACKGROUND;
                        foreground = COLOR_CONSOLE_BACKGROUND;
                    }
                } else if (cellKind === KIND_RGB) {
                    const color = rgb[idx];
                    if (background !== color) {
                        row += ScreenBuffer.backgroundEscapeFor(color);
                        background = color;
                    }
                    row += " ";
                } else if (cellKind === KIND_RGB_SPLIT) {
                    const top = rgbTop[idx], bottom = rgb[idx];
                    if (top !== NO_COLOR && bottom !== NO_COLOR) {
                        if (foreground !== top) {
                            row += ScreenBuffer.foregroundEscapeFor(top);
                            foreground = top;
                        }
                        if (background !== bottom) {
                            row += ScreenBuffer.backgroundEscapeFor(bottom);
                            background = bottom;
                        }
                        row += UPPER_HALF_BLOCK;
                    } else {
                        if (background !== COLOR_CONSOLE_BACKGROUND) {
                            row += backgroundEscapes;
                            background = COLOR_CONSOLE_BACKGROUND;
                            foreground = COLOR_CONSOLE_BACKGROUND;
                        }
                        const covered = top !== NO_COLOR ? top : bottom;
                        if (foreground !== covered) {
                            row += ScreenBuffer.foregroundEscapeFor(covered);
                            foreground = covered;
                        }
                        row += top !== NO_COLOR ? UPPER_HALF_BLOCK : LOWER_HALF_BLOCK;
                    }
                } else {
                    row += text[idx];
                    foreground = COLOR_UNKNOWN;
                    background = COLOR_UNKNOWN;
                }
            }
            rows[y] = row + Ansi.control.reset;
        }
        return rows;
    }

    public flush(): string {
        return this.flushRows().join("\n");
    }
}
