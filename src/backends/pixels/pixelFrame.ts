export const RGBA_BYTES_PER_PIXEL = 4;

export interface PixelFrame {
    readonly widthPx: number;
    readonly heightPx: number;
    readonly rgba: Uint8ClampedArray;
    readonly pixelsPerScreenUnitX: number;
    readonly pixelsPerScreenUnitY: number;
}

export function pixelFrameBuffers(frame: PixelFrame): ArrayBuffer[] {
    return [frame.rgba.buffer as ArrayBuffer];
}

export function copyPixelFrame(frame: PixelFrame): PixelFrame {
    return {
        widthPx: frame.widthPx,
        heightPx: frame.heightPx,
        rgba: frame.rgba.slice(),
        pixelsPerScreenUnitX: frame.pixelsPerScreenUnitX,
        pixelsPerScreenUnitY: frame.pixelsPerScreenUnitY,
    };
}

function isPixelCount(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPixelScale(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isPixelFrame(value: unknown): value is PixelFrame {
    if (typeof value !== "object" || value === null) return false;
    const frame = value as Partial<Record<keyof PixelFrame, unknown>>;
    if (!isPixelCount(frame.widthPx) || !isPixelCount(frame.heightPx)) return false;
    if (!isPixelScale(frame.pixelsPerScreenUnitX) || !isPixelScale(frame.pixelsPerScreenUnitY)) return false;
    return frame.rgba instanceof Uint8ClampedArray && frame.rgba.length === frame.widthPx * frame.heightPx * RGBA_BYTES_PER_PIXEL;
}
