import {TextColor} from "../../../engine/rendering/textColor";
import {TextSprite, TRANSPARENT_GLYPH} from "../../../engine/rendering/textSprite";
import type {TextCellRow} from "../../../engine/rendering/textSprite";

export interface AnsiTextOptions {
    readonly transparentChar: string | undefined;
}

const ESC_CODE_POINT = 0x1b;
const FIRST_ASTRAL_CODE_POINT = 0x10000;
const SURROGATE_PAIR_LENGTH = 2;
const NO_TRANSPARENT_CODE_POINT = -2;
const SGR_SEQUENCE = /\x1b\[([0-9;]*)m/y;
const ANY_ESCAPE_SEQUENCE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|[\s\S])?/y;
const SGR_PARAMETER_SEPARATOR = ";";

const SGR_RESET = 0;
const SGR_FOREGROUND_FIRST = 30;
const SGR_FOREGROUND_LAST = 37;
const SGR_EXTENDED_FOREGROUND = 38;
const SGR_DEFAULT_FOREGROUND = 39;
const SGR_BACKGROUND_FIRST = 40;
const SGR_BACKGROUND_LAST = 47;
const SGR_EXTENDED_BACKGROUND = 48;
const SGR_DEFAULT_BACKGROUND = 49;
const SGR_BRIGHT_FOREGROUND_FIRST = 90;
const SGR_BRIGHT_FOREGROUND_LAST = 97;
const SGR_BRIGHT_BACKGROUND_FIRST = 100;
const SGR_BRIGHT_BACKGROUND_LAST = 107;
const SGR_EXTENDED_PALETTE_MODE = 5;
const SGR_EXTENDED_RGB_MODE = 2;
const PALETTE_ARGUMENTS = 1;
const RGB_ARGUMENTS = 3;
const MAX_COLOR_ARGUMENT = 255;
const STANDARD_PALETTE_COLORS = 8;
const SUPPORTED_SGR = "0, 30-37, 39, 40-47, 49, 90-97, 100-107, 38;5;n, 48;5;n, 38;2;r;g;b, 48;2;r;g;b";

interface SgrState {
    foreground: TextColor;
    background: TextColor;
}

class AnsiTextRow implements TextCellRow {
    public readonly glyphs: number[] = [];
    public readonly foregrounds: TextColor[] = [];
    public readonly backgrounds: TextColor[] = [];

    public get width(): number {
        return this.glyphs.length;
    }
}

function unsupported(sequence: string, line: number, reason: string): Error {
    return new Error(`Unsupported ANSI sequence ${JSON.stringify(sequence)} on line ${line + 1} of TextSprite text: ${reason}`
        + `; only SGR colours are supported (${SUPPORTED_SGR})`);
}

function transparentCodePointOf(transparentChar: string | undefined): number {
    if (transparentChar === undefined) return NO_TRANSPARENT_CODE_POINT;
    const codePoint = transparentChar.codePointAt(0);
    const units = codePoint !== undefined && codePoint >= FIRST_ASTRAL_CODE_POINT ? SURROGATE_PAIR_LENGTH : 1;
    if (codePoint === undefined || units !== transparentChar.length) return NO_TRANSPARENT_CODE_POINT;
    return codePoint;
}

function colorArgument(codes: readonly number[], index: number, sequence: string, line: number): number {
    const value = codes[index];
    if (value === undefined || value > MAX_COLOR_ARGUMENT) {
        throw unsupported(sequence, line, `colour argument ${value ?? "missing"} is not in [0, ${MAX_COLOR_ARGUMENT}]`);
    }
    return value;
}

function extendedColor(codes: readonly number[], modeIndex: number, sequence: string, line: number): [TextColor, number] {
    const mode = codes[modeIndex];
    if (mode === SGR_EXTENDED_PALETTE_MODE) {
        return [TextColor.palette(colorArgument(codes, modeIndex + 1, sequence, line)), modeIndex + PALETTE_ARGUMENTS];
    }
    if (mode === SGR_EXTENDED_RGB_MODE) {
        const red = colorArgument(codes, modeIndex + 1, sequence, line);
        const green = colorArgument(codes, modeIndex + 2, sequence, line);
        const blue = colorArgument(codes, modeIndex + 3, sequence, line);
        return [TextColor.rgb(red, green, blue), modeIndex + RGB_ARGUMENTS];
    }
    throw unsupported(sequence, line, `extended colour mode ${mode ?? "missing"}`);
}

function applySgr(parameters: string, sequence: string, line: number, state: SgrState): void {
    const codes = parameters.length === 0 ? [SGR_RESET] : parameters.split(SGR_PARAMETER_SEPARATOR).map(Number);
    for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        if (code === SGR_RESET) {
            state.foreground = TextColor.DEFAULT;
            state.background = TextColor.DEFAULT;
        } else if (code >= SGR_FOREGROUND_FIRST && code <= SGR_FOREGROUND_LAST) {
            state.foreground = TextColor.palette(code - SGR_FOREGROUND_FIRST);
        } else if (code >= SGR_BRIGHT_FOREGROUND_FIRST && code <= SGR_BRIGHT_FOREGROUND_LAST) {
            state.foreground = TextColor.palette(code - SGR_BRIGHT_FOREGROUND_FIRST + STANDARD_PALETTE_COLORS);
        } else if (code === SGR_DEFAULT_FOREGROUND) {
            state.foreground = TextColor.DEFAULT;
        } else if (code >= SGR_BACKGROUND_FIRST && code <= SGR_BACKGROUND_LAST) {
            state.background = TextColor.palette(code - SGR_BACKGROUND_FIRST);
        } else if (code >= SGR_BRIGHT_BACKGROUND_FIRST && code <= SGR_BRIGHT_BACKGROUND_LAST) {
            state.background = TextColor.palette(code - SGR_BRIGHT_BACKGROUND_FIRST + STANDARD_PALETTE_COLORS);
        } else if (code === SGR_DEFAULT_BACKGROUND) {
            state.background = TextColor.DEFAULT;
        } else if (code === SGR_EXTENDED_FOREGROUND) {
            const [color, last] = extendedColor(codes, i + 1, sequence, line);
            state.foreground = color;
            i = last;
        } else if (code === SGR_EXTENDED_BACKGROUND) {
            const [color, last] = extendedColor(codes, i + 1, sequence, line);
            state.background = color;
            i = last;
        } else {
            throw unsupported(sequence, line, `SGR code ${code}`);
        }
    }
}

function escapeAt(text: string, index: number): string {
    ANY_ESCAPE_SEQUENCE.lastIndex = index;
    return ANY_ESCAPE_SEQUENCE.exec(text)?.[0] ?? text.slice(index);
}

export function ansiTextRows(lines: readonly string[], options: AnsiTextOptions): TextCellRow[] {
    const transparent = transparentCodePointOf(options.transparentChar);
    return lines.map((text, line) => {
        const row = new AnsiTextRow();
        const state: SgrState = {foreground: TextColor.DEFAULT, background: TextColor.DEFAULT};
        let i = 0;
        while (i < text.length) {
            const codePoint = text.codePointAt(i)!;
            if (codePoint === ESC_CODE_POINT) {
                SGR_SEQUENCE.lastIndex = i;
                const sgr = SGR_SEQUENCE.exec(text);
                if (sgr === null) throw unsupported(escapeAt(text, i), line, "not an SGR sequence");
                applySgr(sgr[1], sgr[0], line, state);
                i += sgr[0].length;
                continue;
            }
            i += codePoint >= FIRST_ASTRAL_CODE_POINT ? SURROGATE_PAIR_LENGTH : 1;
            row.glyphs.push(codePoint === transparent ? TRANSPARENT_GLYPH : codePoint);
            row.foregrounds.push(state.foreground);
            row.backgrounds.push(state.background);
        }
        return row;
    });
}

export function ansiTextSprite(lines: readonly string[], options: AnsiTextOptions): TextSprite {
    const sprite = new TextSprite();
    sprite.transparentChar = options.transparentChar;
    sprite.setStyledRows(ansiTextRows(lines, options));
    return sprite;
}
