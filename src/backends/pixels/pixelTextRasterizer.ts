import {TRANSPARENT_GLYPH} from "../../engine/rendering/textSprite";
import type {BlittableText} from "../../engine/rendering/textSprite";
import {TextColor} from "../../engine/rendering/textColor";
import {DEFAULT_TEXT_BACKGROUND_RGB, DEFAULT_TEXT_FOREGROUND_RGB, resolveTextColorRgb} from "../../engine/rendering/textColorPalette";
import {ASCII_PIXEL_FONT} from "../../engine/rendering/text/asciiPixelFont";
import {isGlyphColumnLit} from "../../engine/rendering/text/pixelFont";
import type {PixelFont} from "../../engine/rendering/text/pixelFont";
import type {PixelFramebuffer} from "./pixelFramebuffer";

const NO_BACKGROUND = -1;

export class PixelTextRasterizer {
    public constructor(private readonly font: PixelFont = ASCII_PIXEL_FONT) {
    }

    public drawText(framebuffer: PixelFramebuffer, text: BlittableText, originXPx: number, originYPx: number, depth: number): void {
        const unitWidthPx = framebuffer.pixelsPerScreenUnitX, unitHeightPx = framebuffer.pixelsPerScreenUnitY;
        const widthPx = framebuffer.widthPx, heightPx = framebuffer.heightPx;
        for (let row = 0; row < text.sizeY; row++) {
            const boxYPx = originYPx + row * unitHeightPx;
            if (boxYPx >= heightPx) return;
            if (boxYPx + unitHeightPx <= 0) continue;
            const cells = text.rowAt(row);
            const glyphs = cells.glyphs, foregrounds = cells.foregrounds, backgrounds = cells.backgrounds;
            for (let column = 0; column < cells.width; column++) {
                const boxXPx = originXPx + column * unitWidthPx;
                if (boxXPx >= widthPx) break;
                const glyph = glyphs[column];
                if (glyph === TRANSPARENT_GLYPH || boxXPx + unitWidthPx <= 0) continue;
                this.drawGlyph(framebuffer, glyph, boxXPx, boxYPx, depth, foregroundRgbOf(foregrounds[column]), backgroundRgbOf(backgrounds[column]));
            }
        }
    }

    public drawString(
        framebuffer: PixelFramebuffer, text: string, originXPx: number, originYPx: number, depth: number,
        foreground: TextColor, background: TextColor,
    ): void {
        const foregroundRgb = foregroundRgbOf(foreground), backgroundRgb = backgroundRgbOf(background);
        let boxXPx = originXPx;
        for (const character of text) {
            if (boxXPx >= framebuffer.widthPx) return;
            this.drawGlyph(framebuffer, character.codePointAt(0)!, boxXPx, originYPx, depth, foregroundRgb, backgroundRgb);
            boxXPx += framebuffer.pixelsPerScreenUnitX;
        }
    }

    private drawGlyph(
        framebuffer: PixelFramebuffer, codePoint: number, boxXPx: number, boxYPx: number, depth: number,
        foregroundRgb: number, backgroundRgb: number,
    ): void {
        const unitWidthPx = framebuffer.pixelsPerScreenUnitX, unitHeightPx = framebuffer.pixelsPerScreenUnitY;
        const widthPx = framebuffer.widthPx;
        const left = Math.max(0, boxXPx), right = Math.min(widthPx, boxXPx + unitWidthPx);
        const top = Math.max(0, boxYPx), bottom = Math.min(framebuffer.heightPx, boxYPx + unitHeightPx);
        if (left >= right || top >= bottom) return;

        const font = this.font;
        const glyphWidthPx = font.glyphWidthPx, glyphHeightPx = font.glyphHeightPx;
        const drawsBackground = backgroundRgb !== NO_BACKGROUND;
        for (let y = top; y < bottom; y++) {
            const rowBits = font.glyphRowBits(codePoint, Math.floor((y - boxYPx) * glyphHeightPx / unitHeightPx));
            const rowIndex = y * widthPx;
            for (let x = left; x < right; x++) {
                const lit = isGlyphColumnLit(rowBits, Math.floor((x - boxXPx) * glyphWidthPx / unitWidthPx));
                if (lit) framebuffer.writeRgb(rowIndex + x, depth, foregroundRgb);
                else if (drawsBackground) framebuffer.writeRgb(rowIndex + x, depth, backgroundRgb);
            }
        }
    }
}

function foregroundRgbOf(color: TextColor): number {
    return resolveTextColorRgb(color, DEFAULT_TEXT_FOREGROUND_RGB);
}

function backgroundRgbOf(color: TextColor): number {
    return TextColor.isDefault(color) ? NO_BACKGROUND : resolveTextColorRgb(color, DEFAULT_TEXT_BACKGROUND_RGB);
}
