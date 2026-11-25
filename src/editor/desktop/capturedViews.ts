export const BITMAP_BYTES_PER_PIXEL = 4;

export interface CapturedRect {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

export interface CapturedSize {
    readonly width: number;
    readonly height: number;
}

interface PixelSpan {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

const RED = 0, GREEN = 1, BLUE = 2;
const RED_SHIFT = 16, GREEN_SHIFT = 8;
const NO_PIXELS = 0;
const NO_COUNT = 0;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const UNSIGNED = 0;

export function bitmapWidthPx(byteLength: number, size: CapturedSize): number {
    const pixels = byteLength / BITMAP_BYTES_PER_PIXEL;
    if (size.width <= 0 || size.height <= 0 || pixels <= 0) return NO_PIXELS;
    return Math.round(Math.sqrt(pixels * size.width / size.height));
}

function rgbAt(bitmap: Uint8Array, offset: number): number {
    return (bitmap[offset + RED] << RED_SHIFT) | (bitmap[offset + GREEN] << GREEN_SHIFT) | bitmap[offset + BLUE];
}

function spanOf(bitmap: Uint8Array, widthPx: number, rect: CapturedRect): PixelSpan | undefined {
    if (widthPx <= 0) return undefined;
    const heightPx = Math.floor(bitmap.length / BITMAP_BYTES_PER_PIXEL / widthPx);
    const left = Math.max(0, Math.round(rect.left)), top = Math.max(0, Math.round(rect.top));
    const right = Math.min(widthPx, Math.round(rect.left + rect.width)), bottom = Math.min(heightPx, Math.round(rect.top + rect.height));
    return right > left && bottom > top ? {left, top, right, bottom} : undefined;
}

export function drawnPixelsIn(bitmap: Uint8Array, widthPx: number, rect: CapturedRect): number {
    const span = spanOf(bitmap, widthPx, rect);
    if (span === undefined) return NO_PIXELS;
    const counts = new Map<number, number>();
    for (let y = span.top; y < span.bottom; y++) {
        for (let x = span.left; x < span.right; x++) {
            const rgb = rgbAt(bitmap, (y * widthPx + x) * BITMAP_BYTES_PER_PIXEL);
            counts.set(rgb, (counts.get(rgb) ?? NO_COUNT) + 1);
        }
    }
    let total = NO_COUNT, dominant = NO_COUNT;
    for (const count of counts.values()) {
        total += count;
        dominant = Math.max(dominant, count);
    }
    return total - dominant;
}

export function scaledRect(rect: CapturedRect, pxPerCssPx: number): CapturedRect {
    return {left: rect.left * pxPerCssPx, top: rect.top * pxPerCssPx, width: rect.width * pxPerCssPx, height: rect.height * pxPerCssPx};
}

export function pixelHashIn(bitmap: Uint8Array, widthPx: number, rect: CapturedRect): number {
    const span = spanOf(bitmap, widthPx, rect);
    if (span === undefined) return FNV_OFFSET_BASIS;
    let hash = FNV_OFFSET_BASIS;
    for (let y = span.top; y < span.bottom; y++) {
        for (let x = span.left; x < span.right; x++) {
            hash = Math.imul(hash ^ rgbAt(bitmap, (y * widthPx + x) * BITMAP_BYTES_PER_PIXEL), FNV_PRIME) >>> UNSIGNED;
        }
    }
    return hash;
}
