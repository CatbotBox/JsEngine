import {RED_SHIFT, GREEN_SHIFT, CHANNEL_MASK} from "./packedRgb";
export declare enum TextColorBrand {}

export type TextColor = TextColorBrand;

const TAG_SHIFT = 24;
const TAG_DEFAULT = 0;
const TAG_PALETTE = 1;
const TAG_RGB = 2;
const PAYLOAD_MASK = 0xFFFFFF;
const PALETTE_SIZE = 256;

const PALETTE_BASE = TAG_PALETTE << TAG_SHIFT;
const RGB_BASE = TAG_RGB << TAG_SHIFT;

function tagOf(color: TextColor): number {
    return (color as number) >>> TAG_SHIFT;
}

function palette(index: number): TextColor {
    if (!Number.isInteger(index) || index < 0 || index >= PALETTE_SIZE) {
        throw new RangeError(`TextColor.palette: index must be a whole number in [0, ${PALETTE_SIZE - 1}], got ${index}`);
    }
    return (PALETTE_BASE + index) as TextColor;
}

function packedRgb(rgb: number): TextColor {
    return (RGB_BASE + (rgb & PAYLOAD_MASK)) as TextColor;
}

function rgb(red: number, green: number, blue: number): TextColor {
    return packedRgb(((red & CHANNEL_MASK) << RED_SHIFT) | ((green & CHANNEL_MASK) << GREEN_SHIFT) | (blue & CHANNEL_MASK));
}

function isDefault(color: TextColor): boolean {
    return tagOf(color) === TAG_DEFAULT;
}

function isPalette(color: TextColor): boolean {
    return tagOf(color) === TAG_PALETTE;
}

function isRgb(color: TextColor): boolean {
    return tagOf(color) === TAG_RGB;
}

function paletteIndexOf(color: TextColor): number {
    if (!isPalette(color)) throw new TypeError(`TextColor.paletteIndexOf: ${describe(color)} is not a palette colour`);
    return (color as number) & CHANNEL_MASK;
}

function rgbOf(color: TextColor): number {
    if (!isRgb(color)) throw new TypeError(`TextColor.rgbOf: ${describe(color)} is not an RGB colour`);
    return (color as number) & PAYLOAD_MASK;
}

function isTextColor(value: unknown): value is TextColor {
    if (typeof value !== "number" || !Number.isInteger(value)) return false;
    if (value === TAG_DEFAULT) return true;
    if (value >= PALETTE_BASE && value < PALETTE_BASE + PALETTE_SIZE) return true;
    return value >= RGB_BASE && value <= RGB_BASE + PAYLOAD_MASK;
}

function describe(color: TextColor): string {
    if (isDefault(color)) return "the default colour";
    if (isPalette(color)) return `palette colour ${(color as number) & CHANNEL_MASK}`;
    if (isRgb(color)) return `RGB colour #${((color as number) & PAYLOAD_MASK).toString(16).padStart(6, "0")}`;
    return `the invalid colour ${color as number}`;
}

export const TextColor = {
    DEFAULT: 0 as TextColor,
    BLACK: palette(0),
    RED: palette(1),
    GREEN: palette(2),
    YELLOW: palette(3),
    BLUE: palette(4),
    MAGENTA: palette(5),
    CYAN: palette(6),
    WHITE: palette(7),
    BRIGHT_BLACK: palette(8),
    BRIGHT_RED: palette(9),
    BRIGHT_GREEN: palette(10),
    BRIGHT_YELLOW: palette(11),
    BRIGHT_BLUE: palette(12),
    BRIGHT_MAGENTA: palette(13),
    BRIGHT_CYAN: palette(14),
    BRIGHT_WHITE: palette(15),
    palette,
    rgb,
    packedRgb,
    isDefault,
    isPalette,
    isRgb,
    paletteIndexOf,
    rgbOf,
    isTextColor,
    describe,
} as const;
