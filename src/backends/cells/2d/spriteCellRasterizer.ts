import {ScreenBuffer} from "../cellGrid";

const CHANNEL_MAX = 255;
const WHITE = 0xFFFFFF;
const HALF_ROWS_PER_CELL = 2;
const RGBA_BYTES_LOG2 = 2;

export interface SpriteCellRasterizerConfig {
    maxDepthFade: number;
    colorQuantMask: number;
    backgroundColor: number;
    halfBlock: boolean;
}

export interface BlittableSpriteImage {
    readonly sizeX: number;
    readonly sizeY: number;
    readonly rgba: Uint8Array;
}

function clampToByte(value: number): number {
    return value <= 0 ? 0 : value >= CHANNEL_MAX ? CHANNEL_MAX : Math.round(value);
}

export class SpriteCellRasterizer {
    private depthTop = new Float32Array(0);
    private colorTop = new Int32Array(0);
    private depthBottom = new Float32Array(0);
    private colorBottom = new Int32Array(0);
    private resolveDepth = new Float32Array(0);
    private resolveColor = new Int32Array(0);

    private screenBuffer!: ScreenBuffer;
    private config!: SpriteCellRasterizerConfig;
    private width = 0;
    private height = 0;

    public beginFrame(screenBuffer: ScreenBuffer, width: number, height: number, config: SpriteCellRasterizerConfig): void {
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

    public blitSprite(image: BlittableSpriteImage, dstX: number, dstHalfRowY: number, depth: number, tint: number = WHITE, opacity: number = 1): void {
        const {width, height, config} = this;
        if (width === 0 || height === 0) return;
        const {sizeX, sizeY, rgba} = image;
        if (opacity <= 0) return;

        const bg = config.backgroundColor;
        const bgR = (bg >> 16) & 255, bgG = (bg >> 8) & 255, bgB = bg & 255;
        let fade = config.maxDepthFade === Number.POSITIVE_INFINITY ? 1 : 1 - depth / config.maxDepthFade;
        if (fade < 0) fade = 0;
        else if (fade > 1) fade = 1;
        const quantMask = config.colorQuantMask;
        const tintR = ((tint >> 16) & 255) / CHANNEL_MAX, tintG = ((tint >> 8) & 255) / CHANNEL_MAX, tintB = (tint & 255) / CHANNEL_MAX;
        const tinted = tint !== WHITE;

        const colStart = dstX < 0 ? -dstX : 0;
        const colEnd = Math.min(sizeX, width - dstX);
        const rowStart = dstHalfRowY < 0 ? -dstHalfRowY : 0;
        const rowEnd = Math.min(sizeY, height * HALF_ROWS_PER_CELL - dstHalfRowY);

        const {depthTop, colorTop, depthBottom, colorBottom} = this;

        for (let py = rowStart; py < rowEnd; py++) {
            const halfRow = dstHalfRowY + py;
            const top = (halfRow & 1) === 0;
            const depths = top ? depthTop : depthBottom;
            const colors = top ? colorTop : colorBottom;
            const cellRowIndex = (halfRow >> 1) * width + dstX;
            const pixelRowIndex = py * sizeX;

            for (let px = colStart; px < colEnd; px++) {
                const p = (pixelRowIndex + px) << RGBA_BYTES_LOG2;
                const alpha = (rgba[p + 3] / CHANNEL_MAX) * opacity;
                if (alpha <= 0) continue;
                const idx = cellRowIndex + px;
                if (depths[idx] < depth) continue;

                let r: number = rgba[p], g: number = rgba[p + 1], b: number = rgba[p + 2];
                if (tinted) {
                    r *= tintR;
                    g *= tintG;
                    b *= tintB;
                }
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

    public endFrame(): void {
        const cellCount = this.width * this.height;
        if (cellCount === 0) return;
        if (this.config.halfBlock) {
            this.screenBuffer.mergeRgbSplitLayer(this.depthTop, this.colorTop, this.depthBottom, this.colorBottom);
            return;
        }

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
