import {describe, expect, test} from "../../engine/testing/harness";
import {DRAWN_TILE_SIZE_PX, PixelDrawnTiles} from "./pixelDrawnTiles";
import {PixelFramebuffer, TRANSPARENT_ALPHA} from "./pixelFramebuffer";

const WIDTH_PX = 3 * DRAWN_TILE_SIZE_PX + 5;
const HEIGHT_PX = 2 * DRAWN_TILE_SIZE_PX;
const COLUMNS = 4, ROWS = 2;
const BACKGROUND_PIXEL = 0x11223344;
const OTHER_BACKGROUND_PIXEL = 0x55667788;
const BACKGROUND_RGB = 0x102030;
const PIXELS_PER_UNIT = 8;

function drawnTileList(tiles: PixelDrawnTiles): number[] {
    return [...tiles.drawn.keys()].filter(tile => tiles.drawn[tile] !== 0);
}

describe("PixelDrawnTiles", () => {
    test("covers the frame with whole tiles, the last column and row clipped by the frame", () => {
        const tiles = new PixelDrawnTiles();
        tiles.begin(WIDTH_PX, HEIGHT_PX, BACKGROUND_PIXEL);
        expect([tiles.tileSizePx, tiles.columns, tiles.rows, tiles.drawn.length, tiles.backgroundPixel]).toEqual([DRAWN_TILE_SIZE_PX, COLUMNS, ROWS, COLUMNS * ROWS, BACKGROUND_PIXEL]);
        expect(drawnTileList(tiles)).toEqual([]);
    });

    test("marks every tile a pixel rectangle touches, clamped to the frame", () => {
        const tiles = new PixelDrawnTiles();
        tiles.begin(WIDTH_PX, HEIGHT_PX, BACKGROUND_PIXEL);
        tiles.mark(DRAWN_TILE_SIZE_PX - 1, 0, DRAWN_TILE_SIZE_PX + 1, 1);
        expect(drawnTileList(tiles)).toEqual([0, 1]);
        tiles.mark(WIDTH_PX - 1, HEIGHT_PX - 1, WIDTH_PX + 100, HEIGHT_PX + 100);
        expect(drawnTileList(tiles)).toEqual([0, 1, COLUMNS * ROWS - 1]);
        tiles.mark(-50, DRAWN_TILE_SIZE_PX, -1, HEIGHT_PX);
        tiles.mark(2 * DRAWN_TILE_SIZE_PX, 0, 2 * DRAWN_TILE_SIZE_PX, HEIGHT_PX);
        expect(drawnTileList(tiles)).toEqual([0, 1, COLUMNS * ROWS - 1]);
    });

    test("the next frame starts with nothing drawn and its own background, and markAll covers everything", () => {
        const tiles = new PixelDrawnTiles();
        tiles.begin(WIDTH_PX, HEIGHT_PX, BACKGROUND_PIXEL);
        tiles.markAll();
        expect(drawnTileList(tiles).length).toBe(COLUMNS * ROWS);
        const drawn = tiles.drawn;
        tiles.begin(WIDTH_PX, HEIGHT_PX, OTHER_BACKGROUND_PIXEL);
        expect([tiles.drawn, drawnTileList(tiles), tiles.backgroundPixel]).toEqual([drawn, [], OTHER_BACKGROUND_PIXEL]);
    });
});

describe("PixelFramebuffer drawn tiles", () => {
    test("each frame hands its drawn tiles and background pixel to the presenter", () => {
        const framebuffer = new PixelFramebuffer();
        framebuffer.beginFrame({widthPx: WIDTH_PX, heightPx: HEIGHT_PX}, BACKGROUND_RGB, PIXELS_PER_UNIT, TRANSPARENT_ALPHA);
        framebuffer.markDrawn(0, 0, 1, 1);
        const frame = framebuffer.toPixelFrame();
        expect(frame.drawnTiles).toBe(framebuffer.drawnTiles);
        expect(drawnTileList(framebuffer.drawnTiles)).toEqual([0]);
        expect(frame.drawnTiles!.backgroundPixel).toBe(framebuffer.pixels[WIDTH_PX - 1] | 0);
        framebuffer.beginFrame({widthPx: WIDTH_PX, heightPx: HEIGHT_PX}, BACKGROUND_RGB, PIXELS_PER_UNIT, TRANSPARENT_ALPHA);
        expect(drawnTileList(framebuffer.drawnTiles)).toEqual([]);
    });
});
