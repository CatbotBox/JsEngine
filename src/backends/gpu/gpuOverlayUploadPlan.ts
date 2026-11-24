import {RGBA_BYTES_PER_PIXEL} from "../pixels/pixelFrame";

export const WRITE_CALL_COST_BYTES = 16 * 1024;
export const PARTIAL_UPLOAD_MAX_FRACTION = 0.5;

const RECT_FIELDS = 4;
const LEFT = 0, TOP = 1, WIDTH = 2, HEIGHT = 3;
const FIRST_COLUMN = 0, END_COLUMN = 1, FIRST_ROW = 2, END_ROW = 3;
const INITIAL_RECT_CAPACITY = 16;
const RECT_GROWTH_FACTOR = 2;
const CLEAN = 0;

export class GpuOverlayUploadPlan {
    private _rects = new Int32Array(INITIAL_RECT_CAPACITY * RECT_FIELDS);
    private _tileRects = new Int32Array(INITIAL_RECT_CAPACITY * RECT_FIELDS);
    private _rectCount = 0;
    private _uploadBytes = 0;
    private _openRects = new Int32Array(0);
    private _nextOpenRects = new Int32Array(0);

    public get rectCount(): number {
        return this._rectCount;
    }

    public get uploadBytes(): number {
        return this._uploadBytes;
    }

    public rectLeft(rect: number): number {
        return this._rects[rect * RECT_FIELDS + LEFT];
    }

    public rectTop(rect: number): number {
        return this._rects[rect * RECT_FIELDS + TOP];
    }

    public rectWidth(rect: number): number {
        return this._rects[rect * RECT_FIELDS + WIDTH];
    }

    public rectHeight(rect: number): number {
        return this._rects[rect * RECT_FIELDS + HEIGHT];
    }

    public plan(dirty: Uint8Array, columns: number, rows: number, tileSizePx: number, widthPx: number, heightPx: number): boolean {
        this.collectTileRects(dirty, columns, rows, tileSizePx);
        let uploadBytes = 0;
        for (let rect = 0; rect < this._rectCount; rect++) {
            const field = rect * RECT_FIELDS;
            const left = this._tileRects[field + FIRST_COLUMN] * tileSizePx, top = this._tileRects[field + FIRST_ROW] * tileSizePx;
            const width = Math.min(widthPx, this._tileRects[field + END_COLUMN] * tileSizePx) - left;
            const height = Math.min(heightPx, this._tileRects[field + END_ROW] * tileSizePx) - top;
            this._rects[field + LEFT] = left;
            this._rects[field + TOP] = top;
            this._rects[field + WIDTH] = width;
            this._rects[field + HEIGHT] = height;
            uploadBytes += width * height * RGBA_BYTES_PER_PIXEL;
        }
        this._uploadBytes = uploadBytes;
        const wholeFrameBytes = widthPx * heightPx * RGBA_BYTES_PER_PIXEL;
        return uploadBytes + this._rectCount * WRITE_CALL_COST_BYTES < wholeFrameBytes * PARTIAL_UPLOAD_MAX_FRACTION;
    }

    private collectTileRects(dirty: Uint8Array, columns: number, rows: number, tileSizePx: number): void {
        if (this._openRects.length < columns) {
            this._openRects = new Int32Array(columns);
            this._nextOpenRects = new Int32Array(columns);
        }
        const gapTileCost = tileSizePx * tileSizePx * RGBA_BYTES_PER_PIXEL;
        this._rectCount = 0;
        let openCount = 0;
        for (let row = 0; row < rows; row++) {
            const rowStart = row * columns;
            let nextOpenCount = 0;
            let open = 0;
            let column = 0;
            for (;;) {
                while (column < columns && dirty[rowStart + column] === CLEAN) column++;
                if (column === columns) break;
                const runStart = column;
                let runEnd = column;
                for (;;) {
                    while (runEnd < columns && dirty[rowStart + runEnd] !== CLEAN) runEnd++;
                    let next = runEnd;
                    while (next < columns && dirty[rowStart + next] === CLEAN) next++;
                    if (next === columns || (next - runEnd) * gapTileCost > WRITE_CALL_COST_BYTES) break;
                    runEnd = next;
                }
                column = runEnd;
                while (open < openCount && this._tileRects[this._openRects[open] * RECT_FIELDS + FIRST_COLUMN] < runStart) open++;
                const continued = open < openCount
                    && this._tileRects[this._openRects[open] * RECT_FIELDS + FIRST_COLUMN] === runStart
                    && this._tileRects[this._openRects[open] * RECT_FIELDS + END_COLUMN] === runEnd;
                const rect = continued ? this._openRects[open++] : this.addTileRect(runStart, runEnd, row);
                this._tileRects[rect * RECT_FIELDS + END_ROW] = row + 1;
                this._nextOpenRects[nextOpenCount++] = rect;
            }
            const finished = this._openRects;
            this._openRects = this._nextOpenRects;
            this._nextOpenRects = finished;
            openCount = nextOpenCount;
        }
    }

    private addTileRect(firstColumn: number, endColumn: number, row: number): number {
        const rect = this._rectCount++;
        if (this._rectCount * RECT_FIELDS > this._tileRects.length) this.growRects();
        const tile = rect * RECT_FIELDS;
        this._tileRects[tile + FIRST_COLUMN] = firstColumn;
        this._tileRects[tile + END_COLUMN] = endColumn;
        this._tileRects[tile + FIRST_ROW] = row;
        return rect;
    }

    private growRects(): void {
        const tileRects = new Int32Array(this._tileRects.length * RECT_GROWTH_FACTOR);
        tileRects.set(this._tileRects);
        this._tileRects = tileRects;
        this._rects = new Int32Array(tileRects.length);
    }
}
