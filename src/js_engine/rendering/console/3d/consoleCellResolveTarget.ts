import {ScreenBuffer} from "../consoleScreenBuffer";
import type {RasterTarget, SubsampleLayers} from "../../3d/software";

export interface ConsoleCellResolveConfig {
    /** ANDed onto resolved colors; dropping low bits lengthens ANSI color runs. */
    colorQuantMask: number;
    /** Packed 0xRRGGBB that uncovered subsamples blend toward at silhouettes (default black). */
    backgroundColor?: number;
}

/**
 * Resolves the rasterizer's subsample layers to console cells and
 * depth-composites them into a ScreenBuffer: one sample per cell merges
 * directly, supersampled layers are averaged per cell first, and half-block
 * layers resolve each half separately into split cells.
 */
export class ConsoleCellResolveTarget implements RasterTarget {
    private screenBuffer!: ScreenBuffer;
    private config!: ConsoleCellResolveConfig;

    // Cell-resolution buffers the supersampled layers are resolved into before
    // depth-compositing (unused when supersample == 1).
    private resolveDepth = new Float32Array(0);
    private resolveColor = new Int32Array(0);
    private resolveDepthBottom = new Float32Array(0);
    private resolveColorBottom = new Int32Array(0);

    public begin(screenBuffer: ScreenBuffer, config: ConsoleCellResolveConfig): void {
        this.screenBuffer = screenBuffer;
        this.config = config;
    }

    public composite(layers: SubsampleLayers): void {
        if (layers.supersampleX * layers.rowsPerCell === 1) {
            this.screenBuffer.mergeRgbLayer(layers.depth, layers.color);
            return;
        }
        const cells = layers.width * layers.height;
        if (this.resolveDepth.length < cells) {
            this.resolveDepth = new Float32Array(cells);
            this.resolveColor = new Int32Array(cells);
        }
        if (layers.halfBlock) {
            if (this.resolveDepthBottom.length < cells) {
                this.resolveDepthBottom = new Float32Array(cells);
                this.resolveColorBottom = new Int32Array(cells);
            }
            this.resolveCells(layers, this.resolveDepth, this.resolveColor, 0);
            this.resolveCells(layers, this.resolveDepthBottom, this.resolveColorBottom, layers.supersampleY);
            this.screenBuffer.mergeRgbSplitLayer(this.resolveDepth, this.resolveColor, this.resolveDepthBottom, this.resolveColorBottom);
        } else {
            this.resolveCells(layers, this.resolveDepth, this.resolveColor, 0);
            this.screenBuffer.mergeRgbLayer(this.resolveDepth, this.resolveColor);
        }
    }

    /**
     * Collapse supersampleX × supersampleY subsamples per cell (starting at the
     * given subsample row within each cell) down to cell resolution: a cell's
     * color is the average of its subsamples with uncovered ones taking the
     * background color (so silhouette edges blend toward the terminal
     * background), its depth the closest covered subsample. Cells with no
     * covered subsample stay +Infinity so the merge skips them.
     */
    private resolveCells(layers: SubsampleLayers, outDepth: Float32Array, outColor: Int32Array, firstRow: number): void {
        const {width, height, supersampleX: sx, supersampleY: sy, rowsPerCell, rasterWidth} = layers;
        const ssArea = sx * sy;
        const srcDepth = layers.depth;
        const srcColor = layers.color;
        const quantMask = this.config.colorQuantMask & 0xFFFFFF;
        const background = (this.config.backgroundColor ?? 0) & 0xFFFFFF;
        const bgR = (background >> 16) & 255, bgG = (background >> 8) & 255, bgB = background & 255;

        for (let cy = 0; cy < height; cy++) {
            const rowBase = (cy * rowsPerCell + firstRow) * rasterWidth;
            const outBase = cy * width;
            for (let cx = 0; cx < width; cx++) {
                let minDepth = Number.POSITIVE_INFINITY;
                let r = 0, g = 0, b = 0, covered = 0;
                const cellBase = rowBase + cx * sx;
                for (let row = 0; row < sy; row++) {
                    let si = cellBase + row * rasterWidth;
                    for (let column = 0; column < sx; column++, si++) {
                        const d = srcDepth[si];
                        if (d < Number.POSITIVE_INFINITY) {
                            covered++;
                            if (d < minDepth) minDepth = d;
                            const c = srcColor[si];
                            r += (c >> 16) & 255;
                            g += (c >> 8) & 255;
                            b += c & 255;
                        }
                    }
                }
                if (covered === 0) {
                    outDepth[outBase + cx] = Number.POSITIVE_INFINITY;
                    continue;
                }
                const uncovered = ssArea - covered;
                r += bgR * uncovered;
                g += bgG * uncovered;
                b += bgB * uncovered;
                outDepth[outBase + cx] = minDepth;
                outColor[outBase + cx] = ((Math.round(r / ssArea) << 16) | (Math.round(g / ssArea) << 8) | Math.round(b / ssArea)) & quantMask;
            }
        }
    }
}
