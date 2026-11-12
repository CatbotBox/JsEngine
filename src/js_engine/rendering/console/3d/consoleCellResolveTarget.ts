import {ScreenBuffer} from "../consoleScreenBuffer";
import type {RasterTarget, SubsampleLayers} from "../../3d/software";

const PACKED_RGB_MASK = 0xFFFFFF;
const BLACK = 0x000000;

export interface ConsoleCellResolveConfig {
    colorQuantMask: number;
    backgroundColor?: number;
}

export class ConsoleCellResolveTarget implements RasterTarget {
    private screenBuffer!: ScreenBuffer;
    private config!: ConsoleCellResolveConfig;

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

    private resolveCells(layers: SubsampleLayers, outDepth: Float32Array, outColor: Int32Array, firstRow: number): void {
        const {width, height, supersampleX: sx, supersampleY: sy, rowsPerCell, rasterWidth} = layers;
        const ssArea = sx * sy;
        const srcDepth = layers.depth;
        const srcColor = layers.color;
        const quantMask = this.config.colorQuantMask & PACKED_RGB_MASK;
        const background = (this.config.backgroundColor ?? BLACK) & PACKED_RGB_MASK;
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
