import type {PixelFrameDrawnTiles} from "./pixelFrame";

const DRAWN_TILE_SHIFT = 4;
const NOT_DRAWN = 0;
const DRAWN = 1;

export const DRAWN_TILE_SIZE_PX = 1 << DRAWN_TILE_SHIFT;

function tilesSpanning(lengthPx: number): number {
    return (lengthPx + DRAWN_TILE_SIZE_PX - 1) >> DRAWN_TILE_SHIFT;
}

export class PixelDrawnTiles implements PixelFrameDrawnTiles {
    public readonly tileSizePx = DRAWN_TILE_SIZE_PX;
    private _widthPx = 0;
    private _heightPx = 0;
    private _columns = 0;
    private _rows = 0;
    private _drawn = new Uint8Array(0);
    private _backgroundPixel = 0;

    public get columns(): number {
        return this._columns;
    }

    public get rows(): number {
        return this._rows;
    }

    public get drawn(): Uint8Array {
        return this._drawn;
    }

    public get backgroundPixel(): number {
        return this._backgroundPixel;
    }

    public begin(widthPx: number, heightPx: number, backgroundPixel: number): void {
        this._backgroundPixel = backgroundPixel;
        if (widthPx === this._widthPx && heightPx === this._heightPx) {
            this._drawn.fill(NOT_DRAWN);
            return;
        }
        this._widthPx = widthPx;
        this._heightPx = heightPx;
        this._columns = tilesSpanning(widthPx);
        this._rows = tilesSpanning(heightPx);
        this._drawn = new Uint8Array(this._columns * this._rows);
    }

    public mark(leftPx: number, topPx: number, rightPx: number, bottomPx: number): void {
        const left = Math.max(0, Math.floor(leftPx)), right = Math.min(this._widthPx, Math.ceil(rightPx));
        const top = Math.max(0, Math.floor(topPx)), bottom = Math.min(this._heightPx, Math.ceil(bottomPx));
        if (left >= right || top >= bottom) return;
        const columns = this._columns, drawn = this._drawn;
        const firstColumn = left >> DRAWN_TILE_SHIFT, endColumn = ((right - 1) >> DRAWN_TILE_SHIFT) + 1;
        const lastRow = (bottom - 1) >> DRAWN_TILE_SHIFT;
        for (let row = top >> DRAWN_TILE_SHIFT; row <= lastRow; row++) {
            const rowStart = row * columns;
            for (let column = firstColumn; column < endColumn; column++) drawn[rowStart + column] = DRAWN;
        }
    }

    public markAll(): void {
        this._drawn.fill(DRAWN);
    }
}
