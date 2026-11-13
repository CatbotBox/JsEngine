import {TextColor} from "../../engine/rendering/textColor";

export const CellKind = {
    Background: 0,
    Rgb: 1,
    Text: 2,
    RgbSplit: 3,
} as const;

export type CellKind = typeof CellKind[keyof typeof CellKind];

export const NO_COLOR = -1;

const MAX_CODE_POINT = 0x10FFFF;

export interface CellBackgroundStyle {
    readonly glyph: number;
    readonly foreground: TextColor;
    readonly background: TextColor;
}

export interface CellFrame {
    readonly width: number;
    readonly height: number;
    readonly kind: Uint8Array;
    readonly glyph: Uint32Array;
    readonly foreground: Uint32Array;
    readonly background: Uint32Array;
    readonly rgb: Int32Array;
    readonly rgbTop: Int32Array;
    readonly backgroundStyle: CellBackgroundStyle;
}

export function cellFrameBuffers(frame: CellFrame): ArrayBuffer[] {
    return [frame.kind, frame.glyph, frame.foreground, frame.background, frame.rgb, frame.rgbTop]
        .map(array => array.buffer as ArrayBuffer);
}

export function copyCellFrame(frame: CellFrame): CellFrame {
    const {glyph, foreground, background} = frame.backgroundStyle;
    return {
        width: frame.width,
        height: frame.height,
        kind: frame.kind.slice(),
        glyph: frame.glyph.slice(),
        foreground: frame.foreground.slice(),
        background: frame.background.slice(),
        rgb: frame.rgb.slice(),
        rgbTop: frame.rgbTop.slice(),
        backgroundStyle: {glyph, foreground, background},
    };
}

function isCellCount(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isGlyph(value: unknown): value is number {
    return isCellCount(value) && value <= MAX_CODE_POINT;
}

export function isCellBackgroundStyle(value: unknown): value is CellBackgroundStyle {
    if (typeof value !== "object" || value === null) return false;
    const style = value as Partial<Record<keyof CellBackgroundStyle, unknown>>;
    return isGlyph(style.glyph) && TextColor.isTextColor(style.foreground) && TextColor.isTextColor(style.background);
}

export function isCellFrame(value: unknown): value is CellFrame {
    if (typeof value !== "object" || value === null) return false;
    const frame = value as Partial<Record<keyof CellFrame, unknown>>;
    if (!isCellCount(frame.width) || !isCellCount(frame.height)) return false;
    const cells = frame.width * frame.height;
    const sized = (array: unknown, type: Function) => array instanceof type && (array as ArrayLike<number>).length === cells;
    return sized(frame.kind, Uint8Array)
        && sized(frame.glyph, Uint32Array)
        && sized(frame.foreground, Uint32Array)
        && sized(frame.background, Uint32Array)
        && sized(frame.rgb, Int32Array)
        && sized(frame.rgbTop, Int32Array)
        && isCellBackgroundStyle(frame.backgroundStyle);
}
