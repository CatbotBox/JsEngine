export const FULL_COVERAGE = 255;

export interface GlyphSource {
    coverage(codePoint: number, widthPx: number, heightPx: number): Uint8Array;
}
