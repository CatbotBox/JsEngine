import {Resource} from "../../engine/core";
import {TextColor} from "../../engine/rendering/textColor";
import {TRANSPARENT_GLYPH} from "../../engine/rendering/textSprite";
import type {BlittableText} from "../../engine/rendering/textSprite";
import {CellKind, NO_COLOR} from "./cellFrame";
import type {CellBackgroundStyle, CellFrame} from "./cellFrame";

export type {BlittableText} from "../../engine/rendering/textSprite";

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

const DECIMAL_DIGITS = 10;
const DIGIT_ZERO_CODE_POINT = 0x30;
const SPACE_CODE_POINT = 0x20;

export interface CellGridSize {
    readonly screenSize: {readonly x: number, readonly y: number};
}

export class ScreenBuffer {
    private width = 0;
    private height = 0;
    private depth = new Float32Array(0);
    private kind = new Uint8Array(0);
    private rgb = new Int32Array(0);
    private rgbTop = new Int32Array(0);
    private glyph = new Uint32Array(0);
    private foreground = new Uint32Array(0);
    private background = new Uint32Array(0);

    private backgroundGlyph = SPACE_CODE_POINT;
    private backgroundForeground: TextColor = TextColor.DEFAULT;
    private backgroundBackground: TextColor = TextColor.DEFAULT;

    public get cellWidth(): number {
        return this.width;
    }

    public get cellHeight(): number {
        return this.height;
    }

    public rgbAt(x: number, y: number): number | undefined {
        const idx = y * this.width + x;
        const kind = this.kind[idx];
        if (kind === CellKind.Rgb) return this.rgb[idx];
        if (kind === CellKind.RgbSplit && this.isSolidSplit(idx)) return this.rgb[idx];
        return undefined;
    }

    public splitRgbAt(x: number, y: number): [number | undefined, number | undefined] | undefined {
        const idx = y * this.width + x;
        if (this.kind[idx] !== CellKind.RgbSplit || this.isSolidSplit(idx)) return undefined;
        const top = this.rgbTop[idx], bottom = this.rgb[idx];
        return [top === NO_COLOR ? undefined : top, bottom === NO_COLOR ? undefined : bottom];
    }

    public glyphAt(x: number, y: number): number | undefined {
        const idx = y * this.width + x;
        return this.kind[idx] === CellKind.Text ? this.glyph[idx] : undefined;
    }

    private isSolidSplit(idx: number): boolean {
        return this.rgbTop[idx] === this.rgb[idx] && this.rgb[idx] !== NO_COLOR;
    }

    public beginFrame({screenSize}: CellGridSize, backgroundStyle: CellBackgroundStyle) {
        this.resize(Math.max(0, screenSize.x | 0), Math.max(0, screenSize.y | 0));

        this.backgroundGlyph = backgroundStyle.glyph;
        this.backgroundForeground = backgroundStyle.foreground;
        this.backgroundBackground = backgroundStyle.background;

        const cellCount = this.width * this.height;
        this.depth.fill(Number.POSITIVE_INFINITY, 0, cellCount);
        this.kind.fill(CellKind.Background, 0, cellCount);
    }

    public renderDebug({screenSize}: CellGridSize) {
        this.resize(Math.max(0, screenSize.x | 0), Math.max(0, screenSize.y | 0));
        const cellCount = this.width * this.height;
        this.depth.fill(Number.POSITIVE_INFINITY, 0, cellCount);
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const idx = y * this.width + x;
                this.kind[idx] = CellKind.Text;
                this.glyph[idx] = DIGIT_ZERO_CODE_POINT + (x + y) % DECIMAL_DIGITS;
                this.foreground[idx] = TextColor.DEFAULT;
                this.background[idx] = TextColor.DEFAULT;
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
        this.glyph = new Uint32Array(cellCount);
        this.foreground = new Uint32Array(cellCount);
        this.background = new Uint32Array(cellCount);
    }

    public blit(image: BlittableText, dstX: number, dstY: number, depth: number) {
        const width = this.width, height = this.height;
        if (width === 0 || height === 0) return;

        const rowStart = dstY < 0 ? -dstY : 0;
        const rowEnd = Math.min(image.sizeY, height - dstY);
        const depths = this.depth, kinds = this.kind;
        const glyphs = this.glyph, foregrounds = this.foreground, backgrounds = this.background;

        for (let row = rowStart; row < rowEnd; row++) {
            const cells = image.rowAt(row);
            const cellGlyphs = cells.glyphs, cellForegrounds = cells.foregrounds, cellBackgrounds = cells.backgrounds;
            const colStart = dstX < 0 ? -dstX : 0;
            const colEnd = Math.min(cells.width, width - dstX);
            const lineIndex = (dstY + row) * width + dstX;
            for (let col = colStart; col < colEnd; col++) {
                const cellGlyph = cellGlyphs[col];
                if (cellGlyph === TRANSPARENT_GLYPH) continue;
                const idx = lineIndex + col;
                if (depths[idx] < depth) continue;
                depths[idx] = depth;
                kinds[idx] = CellKind.Text;
                glyphs[idx] = cellGlyph;
                foregrounds[idx] = cellForegrounds[col];
                backgrounds[idx] = cellBackgrounds[col];
            }
        }
    }

    public setText(x: number, y: number, depth: number, glyph: number, foreground: TextColor, background: TextColor) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
        const idx = y * this.width + x;
        if (this.depth[idx] < depth) return;
        this.depth[idx] = depth;
        this.kind[idx] = CellKind.Text;
        this.glyph[idx] = glyph;
        this.foreground[idx] = foreground;
        this.background[idx] = background;
    }

    public writeText(text: string, x: number, y: number, depth: number, foreground: TextColor, background: TextColor) {
        let column = x;
        for (const character of text) {
            this.setText(column, y, depth, character.codePointAt(0)!, foreground, background);
            column++;
        }
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
                kind[i] = CellKind.Rgb;
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
                kind[i] = CellKind.RgbSplit;
                rgbTop[i] = dTop < Number.POSITIVE_INFINITY ? colorTop[i] : NO_COLOR;
                rgb[i] = dBottom < Number.POSITIVE_INFINITY ? colorBottom[i] : NO_COLOR;
            }
        }
    }

    public toCellFrame(): CellFrame {
        const cellCount = this.width * this.height;
        const kind = this.kind;
        for (let i = 0; i < cellCount; i++) {
            if (kind[i] === CellKind.RgbSplit && this.isSolidSplit(i)) kind[i] = CellKind.Rgb;
        }
        return {
            width: this.width,
            height: this.height,
            kind,
            glyph: this.glyph,
            foreground: this.foreground,
            background: this.background,
            rgb: this.rgb,
            rgbTop: this.rgbTop,
            backgroundStyle: {
                glyph: this.backgroundGlyph,
                foreground: this.backgroundForeground,
                background: this.backgroundBackground,
            },
        };
    }
}
