import {Component} from "../../engine/core";
import {BLACK_RGB} from "../../engine/rendering/packedRgb";

const DEFAULT_PIXELS_PER_SCREEN_UNIT_X = 8;
const MIN_PIXELS_PER_SCREEN_UNIT_X = 1;

export class PixelRenderSettings extends Component {
    public static readonly DEFAULT_BACKGROUND_COLOR = BLACK_RGB;
    public static readonly DEFAULT_PIXELS_PER_SCREEN_UNIT_X = DEFAULT_PIXELS_PER_SCREEN_UNIT_X;

    public backgroundColor: number = BLACK_RGB;
    public pixelsPerScreenUnitX: number = DEFAULT_PIXELS_PER_SCREEN_UNIT_X;

    public wholePixelsPerScreenUnitX(): number {
        const requested = this.pixelsPerScreenUnitX;
        return Number.isFinite(requested) && requested >= MIN_PIXELS_PER_SCREEN_UNIT_X ? Math.floor(requested) : MIN_PIXELS_PER_SCREEN_UNIT_X;
    }
}

export function pixelsPerScreenUnitXOf(settings: PixelRenderSettings | undefined): number {
    return settings === undefined ? DEFAULT_PIXELS_PER_SCREEN_UNIT_X : settings.wholePixelsPerScreenUnitX();
}

export function backgroundColorOf(settings: PixelRenderSettings | undefined): number {
    return settings === undefined ? PixelRenderSettings.DEFAULT_BACKGROUND_COLOR : settings.backgroundColor;
}
