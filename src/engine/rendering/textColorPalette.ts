import {TextColor} from "./textColor";
import {RED_SHIFT, GREEN_SHIFT} from "./packedRgb";

export const DEFAULT_TEXT_FOREGROUND_RGB = 0xE5E5E5;
export const DEFAULT_TEXT_BACKGROUND_RGB = 0x000000;

const STANDARD_COLORS_RGB: readonly number[] = [
    0x000000, 0xCD0000, 0x00CD00, 0xCDCD00, 0x0000EE, 0xCD00CD, 0x00CDCD, 0xE5E5E5,
    0x7F7F7F, 0xFF0000, 0x00FF00, 0xFFFF00, 0x5C5CFF, 0xFF00FF, 0x00FFFF, 0xFFFFFF,
];
const COLOR_CUBE_FIRST_INDEX = 16;
const COLOR_CUBE_LEVELS: readonly number[] = [0x00, 0x5F, 0x87, 0xAF, 0xD7, 0xFF];
const COLOR_CUBE_SIDE = COLOR_CUBE_LEVELS.length;
const GREY_RAMP_FIRST_INDEX = 232;
const GREY_RAMP_FIRST_LEVEL = 0x08;
const GREY_RAMP_LEVEL_STEP = 10;
const PALETTE_SIZE = 256;

function packRgb(red: number, green: number, blue: number): number {
    return (red << RED_SHIFT) | (green << GREEN_SHIFT) | blue;
}

function buildPalette(): number[] {
    const palette = new Array<number>(PALETTE_SIZE);
    for (let index = 0; index < STANDARD_COLORS_RGB.length; index++) palette[index] = STANDARD_COLORS_RGB[index];
    for (let red = 0; red < COLOR_CUBE_SIDE; red++) {
        for (let green = 0; green < COLOR_CUBE_SIDE; green++) {
            for (let blue = 0; blue < COLOR_CUBE_SIDE; blue++) {
                const index = COLOR_CUBE_FIRST_INDEX + (red * COLOR_CUBE_SIDE + green) * COLOR_CUBE_SIDE + blue;
                palette[index] = packRgb(COLOR_CUBE_LEVELS[red], COLOR_CUBE_LEVELS[green], COLOR_CUBE_LEVELS[blue]);
            }
        }
    }
    for (let index = GREY_RAMP_FIRST_INDEX; index < PALETTE_SIZE; index++) {
        const level = GREY_RAMP_FIRST_LEVEL + (index - GREY_RAMP_FIRST_INDEX) * GREY_RAMP_LEVEL_STEP;
        palette[index] = packRgb(level, level, level);
    }
    return palette;
}

export const TEXT_COLOR_PALETTE_RGB: readonly number[] = Object.freeze(buildPalette());

export function paletteRgb(index: number): number {
    return TEXT_COLOR_PALETTE_RGB[index];
}

export function resolveTextColorRgb(color: TextColor, defaultRgb: number): number {
    if (TextColor.isRgb(color)) return TextColor.rgbOf(color);
    if (TextColor.isPalette(color)) return TEXT_COLOR_PALETTE_RGB[TextColor.paletteIndexOf(color)];
    return defaultRgb;
}
