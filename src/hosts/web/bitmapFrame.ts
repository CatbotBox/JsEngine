export interface BitmapFrame {
    readonly bitmap: ImageBitmap;
    readonly pixelsPerScreenUnitX: number;
    readonly pixelsPerScreenUnitY: number;
}

function isImageBitmap(value: unknown): value is ImageBitmap {
    return typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap;
}

function isPixelScale(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isBitmapFrame(value: unknown): value is BitmapFrame {
    if (typeof value !== "object" || value === null) return false;
    const frame = value as Partial<Record<keyof BitmapFrame, unknown>>;
    return isImageBitmap(frame.bitmap) && isPixelScale(frame.pixelsPerScreenUnitX) && isPixelScale(frame.pixelsPerScreenUnitY);
}

export function bitmapFrameTransfers(frame: BitmapFrame): ImageBitmap[] {
    return [frame.bitmap];
}

export function discardBitmapFrame(frame: BitmapFrame): void {
    frame.bitmap.close();
}
