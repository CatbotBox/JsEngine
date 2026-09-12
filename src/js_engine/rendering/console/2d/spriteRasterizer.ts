import {ScreenBuffer} from "../consoleScreenBuffer";

export interface SpriteRasterizerConfig {
    /** Depth at which pixels fade fully to black (matches the 3D kernel's fade). */
    maxDepthFade: number;
    /** ANDed onto packed colors; dropping low bits lengthens ANSI color runs. */
    colorQuantMask: number;
    /** Packed 0xRRGGBB that translucent pixels blend toward (default black). */
    backgroundColor: number;
    /**
     * Keep the two pixel rows per cell separate and emit them as an
     * upper-half-block glyph (foreground + background colors), doubling vertical
     * resolution. Off, the rows are averaged into one solid cell.
     */
    halfBlock: boolean;
}

/** The minimum a sprite blit needs: an RGBA pixel grid (a SpriteImage satisfies this). */
export interface BlittableSpriteImage {
    readonly sizeX: number;
    readonly sizeY: number;
    /** Row-major RGBA, 4 bytes per pixel, top row first. */
    readonly rgba: Uint8Array;
}

function clampToByte(value: number): number {
    return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
}

/**
 * Frame-scoped pixel compositor for the console 2D sprite pass. Sprites blit
 * into two cell-resolution depth+color layers — one per vertical half of each
 * cell — then depth-composite into the ScreenBuffer through the same half-block
 * split path the 3D rasterizer uses, so 2D sprites and 3D meshes occlude each
 * other correctly in the shared buffer. Zero per-frame allocation in steady
 * state; buffers grow on demand and are reused.
 */
export class SpriteRasterizer {
    private depthTop = new Float32Array(0);
    private colorTop = new Int32Array(0);
    private depthBottom = new Float32Array(0);
    private colorBottom = new Int32Array(0);
    // Scratch for the non-half-block resolve.
    private resolveDepth = new Float32Array(0);
    private resolveColor = new Int32Array(0);

    private screenBuffer!: ScreenBuffer;
    private config!: SpriteRasterizerConfig;
    private width = 0;
    private height = 0;

    public beginFrame(screenBuffer: ScreenBuffer, width: number, height: number, config: SpriteRasterizerConfig): void {
        this.screenBuffer = screenBuffer;
        this.config = config;
        this.width = width;
        this.height = height;

        const cellCount = width * height;
        if (this.depthTop.length < cellCount) {
            this.depthTop = new Float32Array(cellCount);
            this.colorTop = new Int32Array(cellCount);
            this.depthBottom = new Float32Array(cellCount);
            this.colorBottom = new Int32Array(cellCount);
        }
        this.depthTop.fill(Number.POSITIVE_INFINITY, 0, cellCount);
        this.depthBottom.fill(Number.POSITIVE_INFINITY, 0, cellCount);
    }

    /**
     * Blit an image with its top-left at cell `dstX`, half-row `dstY` (two
     * half-rows per cell row; even = upper half). Clipped to the frame. `depth`
     * is distance from the camera; nearer pixels win. `tint` and `opacity` are
     * the per-sprite modifiers from the ConsoleSprite component.
     */
    public blitSprite(image: BlittableSpriteImage, dstX: number, dstY: number, depth: number, tint: number = 0xFFFFFF, opacity: number = 1): void {
        const {width, height, config} = this;
        if (width === 0 || height === 0) return;
        const {sizeX, sizeY, rgba} = image;
        if (opacity <= 0) return;

        const bg = config.backgroundColor;
        const bgR = (bg >> 16) & 255, bgG = (bg >> 8) & 255, bgB = bg & 255;
        // Same fade semantics as the 3D raster kernel: multiply toward black.
        let fade = config.maxDepthFade === Number.POSITIVE_INFINITY ? 1 : 1 - depth / config.maxDepthFade;
        if (fade < 0) fade = 0;
        else if (fade > 1) fade = 1;
        const quantMask = config.colorQuantMask;
        const tintR = ((tint >> 16) & 255) / 255, tintG = ((tint >> 8) & 255) / 255, tintB = (tint & 255) / 255;
        const tinted = tint !== 0xFFFFFF;

        const colStart = dstX < 0 ? -dstX : 0;
        const colEnd = Math.min(sizeX, width - dstX);
        const rowStart = dstY < 0 ? -dstY : 0;
        const rowEnd = Math.min(sizeY, height * 2 - dstY);

        const {depthTop, colorTop, depthBottom, colorBottom} = this;

        for (let py = rowStart; py < rowEnd; py++) {
            const halfRow = dstY + py;
            const top = (halfRow & 1) === 0;
            const depths = top ? depthTop : depthBottom;
            const colors = top ? colorTop : colorBottom;
            const cellRowIndex = (halfRow >> 1) * width + dstX;
            const pixelRowIndex = py * sizeX;

            for (let px = colStart; px < colEnd; px++) {
                const p = (pixelRowIndex + px) << 2;
                const alpha = (rgba[p + 3] / 255) * opacity;
                if (alpha <= 0) continue;
                const idx = cellRowIndex + px;
                if (depths[idx] < depth) continue;

                let r: number = rgba[p], g: number = rgba[p + 1], b: number = rgba[p + 2];
                if (tinted) {
                    r *= tintR;
                    g *= tintG;
                    b *= tintB;
                }
                // Translucent pixels blend toward the background color — the same
                // choice the 3D pass makes for uncovered silhouette subsamples,
                // since what's actually behind isn't known at write time.
                if (alpha < 1) {
                    r = bgR + (r - bgR) * alpha;
                    g = bgG + (g - bgG) * alpha;
                    b = bgB + (b - bgB) * alpha;
                }
                if (fade < 1) {
                    r *= fade;
                    g *= fade;
                    b *= fade;
                }

                depths[idx] = depth;
                colors[idx] = ((clampToByte(r) << 16) | (clampToByte(g) << 8) | clampToByte(b)) & quantMask;
            }
        }
    }

    /** Depth-composite the frame's layers into the ScreenBuffer. */
    public endFrame(): void {
        const cellCount = this.width * this.height;
        if (cellCount === 0) return;
        if (this.config.halfBlock) {
            this.screenBuffer.mergeRgbSplitLayer(this.depthTop, this.colorTop, this.depthBottom, this.colorBottom);
            return;
        }

        // No half blocks: collapse the two halves into one solid cell — average
        // the covered halves (an uncovered half contributes backgroundColor,
        // mirroring the 3D resolve) and keep the nearer depth.
        if (this.resolveDepth.length < cellCount) {
            this.resolveDepth = new Float32Array(cellCount);
            this.resolveColor = new Int32Array(cellCount);
        }
        const {depthTop, colorTop, depthBottom, colorBottom, resolveDepth, resolveColor} = this;
        const bg = this.config.backgroundColor;
        const quantMask = this.config.colorQuantMask;
        for (let i = 0; i < cellCount; i++) {
            const dTop = depthTop[i], dBottom = depthBottom[i];
            const topCovered = dTop < Number.POSITIVE_INFINITY;
            const bottomCovered = dBottom < Number.POSITIVE_INFINITY;
            if (!topCovered && !bottomCovered) {
                resolveDepth[i] = Number.POSITIVE_INFINITY;
                continue;
            }
            const a = topCovered ? colorTop[i] : bg;
            const b = bottomCovered ? colorBottom[i] : bg;
            const r = (((a >> 16) & 255) + ((b >> 16) & 255)) >> 1;
            const g = (((a >> 8) & 255) + ((b >> 8) & 255)) >> 1;
            const bl = ((a & 255) + (b & 255)) >> 1;
            resolveDepth[i] = dTop < dBottom ? dTop : dBottom;
            resolveColor[i] = ((r << 16) | (g << 8) | bl) & quantMask;
        }
        this.screenBuffer.mergeRgbLayer(resolveDepth, resolveColor);
    }
}
