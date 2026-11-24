import {describe, expect, test} from "../../engine/testing/harness";
import {RGBA_BYTES_PER_PIXEL} from "../pixels/pixelFrame";
import {GpuOverlayUploadPlan, WRITE_CALL_COST_BYTES} from "./gpuOverlayUploadPlan";

const TILE_PX = 16;
const COLUMNS = 80, ROWS = 45;
const WIDTH_PX = COLUMNS * TILE_PX, HEIGHT_PX = ROWS * TILE_PX;
const CLIPPED_WIDTH_PX = WIDTH_PX - 5;
const TILE_BYTES = TILE_PX * TILE_PX * RGBA_BYTES_PER_PIXEL;
const MERGED_GAP_TILES = Math.floor(WRITE_CALL_COST_BYTES / TILE_BYTES);
const DIRTY = 1;

type Rect = [left: number, top: number, width: number, height: number];

function dirtyTiles(...ranges: readonly [firstColumn: number, endColumn: number, firstRow: number, endRow: number][]): Uint8Array {
    const dirty = new Uint8Array(COLUMNS * ROWS);
    for (const [firstColumn, endColumn, firstRow, endRow] of ranges) {
        for (let row = firstRow; row < endRow; row++) dirty.fill(DIRTY, row * COLUMNS + firstColumn, row * COLUMNS + endColumn);
    }
    return dirty;
}

function rectsOf(plan: GpuOverlayUploadPlan): Rect[] {
    const rects: Rect[] = [];
    for (let rect = 0; rect < plan.rectCount; rect++) rects.push([plan.rectLeft(rect), plan.rectTop(rect), plan.rectWidth(rect), plan.rectHeight(rect)]);
    return rects;
}

function planned(dirty: Uint8Array, widthPx: number = WIDTH_PX): {readonly partial: boolean, readonly rects: Rect[], readonly bytes: number} {
    const plan = new GpuOverlayUploadPlan();
    const partial = plan.plan(dirty, COLUMNS, ROWS, TILE_PX, widthPx, HEIGHT_PX);
    return {partial, rects: rectsOf(plan), bytes: plan.uploadBytes};
}

describe("GpuOverlayUploadPlan", () => {
    test("nothing dirty uploads nothing", () => {
        expect(planned(dirtyTiles())).toEqual({partial: true, rects: [], bytes: 0});
    });

    test("separate corners stay separate rectangles, and rows with the same extent merge into one", () => {
        const {partial, rects, bytes} = planned(dirtyTiles([0, 20, 0, 3], [70, 80, 42, 45]), CLIPPED_WIDTH_PX);
        expect(partial).toBe(true);
        expect(rects).toEqual([[0, 0, 20 * TILE_PX, 3 * TILE_PX], [70 * TILE_PX, 42 * TILE_PX, CLIPPED_WIDTH_PX - 70 * TILE_PX, 3 * TILE_PX]]);
        expect(bytes).toBe((20 * 3 * TILE_PX * TILE_PX + (CLIPPED_WIDTH_PX - 70 * TILE_PX) * 3 * TILE_PX) * RGBA_BYTES_PER_PIXEL);
    });

    test("a gap cheaper than another write call is uploaded with its neighbours, a wider one splits them", () => {
        expect(planned(dirtyTiles([0, 2, 0, 1], [2 + MERGED_GAP_TILES, 3 + MERGED_GAP_TILES, 0, 1])).rects)
            .toEqual([[0, 0, (3 + MERGED_GAP_TILES) * TILE_PX, TILE_PX]]);
        expect(planned(dirtyTiles([0, 2, 0, 1], [3 + MERGED_GAP_TILES, 4 + MERGED_GAP_TILES, 0, 1])).rects)
            .toEqual([[0, 0, 2 * TILE_PX, TILE_PX], [(3 + MERGED_GAP_TILES) * TILE_PX, 0, TILE_PX, TILE_PX]]);
    });

    test("rows whose extents differ start new rectangles", () => {
        expect(planned(dirtyTiles([0, 4, 0, 2], [0, 5, 2, 3], [0, 4, 3, 4])).rects).toEqual([
            [0, 0, 4 * TILE_PX, 2 * TILE_PX],
            [0, 2 * TILE_PX, 5 * TILE_PX, TILE_PX],
            [0, 3 * TILE_PX, 4 * TILE_PX, TILE_PX],
        ]);
    });

    test("a mostly dirty overlay is cheaper to upload whole", () => {
        expect(planned(dirtyTiles([0, COLUMNS, 0, ROWS - 1])).partial).toBe(false);
        expect(planned(dirtyTiles([0, COLUMNS, 0, ROWS / 3])).partial).toBe(true);
    });
});
