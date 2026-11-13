import {PACKED_RGB_MASK} from "../../../engine/rendering/packedRgb";

export {
    paletteRgb,
    resolveTextColorRgb as textColorRgb,
    DEFAULT_TEXT_FOREGROUND_RGB as THEME_FOREGROUND_RGB,
    DEFAULT_TEXT_BACKGROUND_RGB as THEME_BACKGROUND_RGB,
} from "../../../engine/rendering/textColorPalette";

const HEX_RADIX = 16;
const RGB_HEX_DIGITS = 6;
const MAX_CACHED_CSS_COLORS = 4096;

export function cssColor(rgb: number): string {
    return "#" + (rgb & PACKED_RGB_MASK).toString(HEX_RADIX).padStart(RGB_HEX_DIGITS, "0");
}

export class CssColors {
    private readonly colors = new Map<number, string>();

    public get(rgb: number): string {
        let color = this.colors.get(rgb);
        if (color === undefined) {
            if (this.colors.size >= MAX_CACHED_CSS_COLORS) this.colors.clear();
            color = cssColor(rgb);
            this.colors.set(rgb, color);
        }
        return color;
    }
}
