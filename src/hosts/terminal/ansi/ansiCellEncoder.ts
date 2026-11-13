import {CellKind, NO_COLOR} from "../../../backends/cells/cellFrame";
import type {CellBackgroundStyle, CellFrame} from "../../../backends/cells/cellFrame";
import {TextColor} from "../../../engine/rendering/textColor";
import {Ansi} from "./ansiEncoding";
import {RED_SHIFT, GREEN_SHIFT, CHANNEL_MASK} from "../../../engine/rendering/packedRgb";

const UPPER_HALF_BLOCK = "▀";
const LOWER_HALF_BLOCK = "▄";
const RGB_CELL_GLYPH = " ";
const RESET = Ansi.control.reset;
const DEFAULT_BACKGROUND_ESCAPE = "\x1b[49m";

const COLOR_UNKNOWN = -1;
const COLOR_CONSOLE_BACKGROUND = -2;
const STYLE_NOT_ENCODED = -1;

const MAX_CACHED_ESCAPES = 8192;
const STANDARD_PALETTE_COLORS = 8;
const BRIGHT_PALETTE_END = 16;

const FIRST_PRINTABLE_CODE_POINT = 0x20;
const DELETE_CODE_POINT = 0x7F;
const FIRST_CODE_POINT_AFTER_C1_CONTROLS = 0xA0;
const MAX_CODE_POINT = 0x10FFFF;
const REPLACEMENT_CHARACTER = "�";

interface SgrColorCodes {
    readonly standard: number;
    readonly bright: number;
    readonly extended: number;
    readonly reset: number;
}

const FOREGROUND_SGR: SgrColorCodes = {standard: 30, bright: 90, extended: 38, reset: 39};
const BACKGROUND_SGR: SgrColorCodes = {standard: 40, bright: 100, extended: 48, reset: 49};
const EXTENDED_PALETTE_MODE = 5;
const EXTENDED_RGB_MODE = 2;

function rgbChannels(rgb: number): string {
    return `${(rgb >> RED_SHIFT) & CHANNEL_MASK};${(rgb >> GREEN_SHIFT) & CHANNEL_MASK};${rgb & CHANNEL_MASK}`;
}

function textColorEscape(color: TextColor, codes: SgrColorCodes): string {
    if (TextColor.isPalette(color)) {
        const index = TextColor.paletteIndexOf(color);
        if (index < STANDARD_PALETTE_COLORS) return `\x1b[${codes.standard + index}m`;
        if (index < BRIGHT_PALETTE_END) return `\x1b[${codes.bright + index - STANDARD_PALETTE_COLORS}m`;
        return `\x1b[${codes.extended};${EXTENDED_PALETTE_MODE};${index}m`;
    }
    if (TextColor.isRgb(color)) return `\x1b[${codes.extended};${EXTENDED_RGB_MODE};${rgbChannels(TextColor.rgbOf(color))}m`;
    return `\x1b[${codes.reset}m`;
}

function backgroundStyleEscape(color: TextColor, codes: SgrColorCodes): string {
    return TextColor.isDefault(color) ? "" : textColorEscape(color, codes);
}

export function glyphText(codePoint: number): string {
    if (codePoint < FIRST_PRINTABLE_CODE_POINT
        || (codePoint >= DELETE_CODE_POINT && codePoint < FIRST_CODE_POINT_AFTER_C1_CONTROLS)
        || codePoint > MAX_CODE_POINT) {
        return REPLACEMENT_CHARACTER;
    }
    return String.fromCodePoint(codePoint);
}

class EscapeCache {
    private readonly escapes = new Map<number, string>();

    public constructor(private readonly build: (color: number) => string) {
    }

    public get(color: number): string {
        let escape = this.escapes.get(color);
        if (escape === undefined) {
            if (this.escapes.size > MAX_CACHED_ESCAPES) this.escapes.clear();
            escape = this.build(color);
            this.escapes.set(color, escape);
        }
        return escape;
    }
}

export class AnsiCellEncoder {
    private static readonly rgbBackgroundEscapes = new EscapeCache(color => `\x1b[48;2;${rgbChannels(color)}m`);
    private static readonly rgbForegroundEscapes = new EscapeCache(color => `\x1b[38;2;${rgbChannels(color)}m`);
    private static readonly textForegroundEscapes = new EscapeCache(color => textColorEscape(color as TextColor, FOREGROUND_SGR));
    private static readonly textBackgroundEscapes = new EscapeCache(color => textColorEscape(color as TextColor, BACKGROUND_SGR));

    private encodedStyleGlyph: number = STYLE_NOT_ENCODED;
    private encodedStyleForeground: number = STYLE_NOT_ENCODED;
    private encodedStyleBackground: number = STYLE_NOT_ENCODED;
    private backgroundFull = "";
    private backgroundGlyph = RGB_CELL_GLYPH;
    private backgroundEscapes = DEFAULT_BACKGROUND_ESCAPE;

    public encodeRows(frame: CellFrame): string[] {
        this.useBackgroundStyle(frame.backgroundStyle);
        const {width, height, kind, glyph, rgb, rgbTop} = frame;
        const textForegrounds = frame.foreground, textBackgrounds = frame.background;
        const {backgroundFull, backgroundGlyph, backgroundEscapes} = this;
        const rgbBackgroundEscapes = AnsiCellEncoder.rgbBackgroundEscapes;
        const rgbForegroundEscapes = AnsiCellEncoder.rgbForegroundEscapes;
        const textForegroundEscapes = AnsiCellEncoder.textForegroundEscapes;
        const textBackgroundEscapes = AnsiCellEncoder.textBackgroundEscapes;
        const rows: string[] = new Array(height);

        for (let y = 0; y < height; y++) {
            let row = "";
            let foreground = COLOR_UNKNOWN;
            let background = COLOR_UNKNOWN;
            let inTextRun = false;
            let textForeground = TextColor.DEFAULT as number;
            let textBackground = TextColor.DEFAULT as number;
            const rowIndex = y * width;

            for (let x = 0; x < width; x++) {
                const idx = rowIndex + x;
                let cellKind: number = kind[idx];
                if (cellKind === CellKind.RgbSplit && rgbTop[idx] === rgb[idx] && rgb[idx] !== NO_COLOR) cellKind = CellKind.Rgb;
                if (inTextRun && cellKind !== CellKind.Text) {
                    row += RESET;
                    inTextRun = false;
                }

                if (cellKind === CellKind.Background) {
                    if (background === COLOR_CONSOLE_BACKGROUND && foreground === COLOR_CONSOLE_BACKGROUND) {
                        row += backgroundGlyph;
                    } else {
                        row += backgroundFull;
                        background = COLOR_CONSOLE_BACKGROUND;
                        foreground = COLOR_CONSOLE_BACKGROUND;
                    }
                } else if (cellKind === CellKind.Rgb) {
                    const color = rgb[idx];
                    if (background !== color) {
                        row += rgbBackgroundEscapes.get(color);
                        background = color;
                    }
                    row += RGB_CELL_GLYPH;
                } else if (cellKind === CellKind.RgbSplit) {
                    const top = rgbTop[idx], bottom = rgb[idx];
                    if (top !== NO_COLOR && bottom !== NO_COLOR) {
                        if (foreground !== top) {
                            row += rgbForegroundEscapes.get(top);
                            foreground = top;
                        }
                        if (background !== bottom) {
                            row += rgbBackgroundEscapes.get(bottom);
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
                            row += rgbForegroundEscapes.get(covered);
                            foreground = covered;
                        }
                        row += top !== NO_COLOR ? UPPER_HALF_BLOCK : LOWER_HALF_BLOCK;
                    }
                } else {
                    if (!inTextRun) {
                        row += RESET;
                        inTextRun = true;
                        textForeground = TextColor.DEFAULT;
                        textBackground = TextColor.DEFAULT;
                    }
                    const cellForeground = textForegrounds[idx], cellBackground = textBackgrounds[idx];
                    if (cellForeground !== textForeground) {
                        row += textForegroundEscapes.get(cellForeground);
                        textForeground = cellForeground;
                    }
                    if (cellBackground !== textBackground) {
                        row += textBackgroundEscapes.get(cellBackground);
                        textBackground = cellBackground;
                    }
                    row += glyphText(glyph[idx]);
                    foreground = COLOR_UNKNOWN;
                    background = COLOR_UNKNOWN;
                }
            }
            rows[y] = row + RESET;
        }
        return rows;
    }

    private useBackgroundStyle(style: CellBackgroundStyle): void {
        if (style.glyph === this.encodedStyleGlyph
            && style.foreground === this.encodedStyleForeground
            && style.background === this.encodedStyleBackground) {
            return;
        }
        this.encodedStyleGlyph = style.glyph;
        this.encodedStyleForeground = style.foreground;
        this.encodedStyleBackground = style.background;
        const escapes = backgroundStyleEscape(style.background, BACKGROUND_SGR) + backgroundStyleEscape(style.foreground, FOREGROUND_SGR);
        this.backgroundGlyph = glyphText(style.glyph);
        this.backgroundFull = escapes + this.backgroundGlyph;
        this.backgroundEscapes = escapes.length > 0 ? escapes : DEFAULT_BACKGROUND_ESCAPE;
    }
}
