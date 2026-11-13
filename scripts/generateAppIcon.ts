import {mkdirSync, writeFileSync} from "fs";
import {join, relative} from "path";
import {encodePng} from "../src/engine/assets/image/png";
import {nodeDeflate} from "../src/hosts/terminal";
import {encodeIcns, encodeIco, ICNS_PNG_TYPES_BY_SIZE_PX, ICO_MAX_DIMENSION_PX} from "./iconFiles";
import type {PngIconImage} from "./iconFiles";
import {APP_ICON_DIRECTORY, APP_ICON_ICNS_FILE, APP_ICON_ICO_FILE, APP_ICON_PNG_FILE, ROOT} from "./windowBuild";

type Rgb = readonly [number, number, number];

const MOTIF = [
    "................",
    "...r........m...",
    "..rrr..yy..mmm..",
    "...r........m...",
    ".......yy.......",
    ".d.....ww.......",
    "......cwwc....d.",
    ".....ccwwcc.....",
    "....cccwwccc....",
    "....cc.oo.cc....",
    ".......ff.......",
    "...m........r...",
    "..mmm......rrr..",
    "...m........r...",
    "......d.........",
    "................",
];
const MOTIF_CELLS = MOTIF.length;
const EMPTY_CELL = ".";
const MOTIF_COLORS: Readonly<Record<string, Rgb>> = {
    c: [57, 198, 255],
    w: [230, 249, 255],
    y: [255, 224, 102],
    o: [255, 140, 50],
    f: [176, 70, 30],
    r: [255, 77, 106],
    m: [196, 92, 255],
    d: [138, 53, 80],
};
const BACKGROUND_TOP: Rgb = [26, 34, 56];
const BACKGROUND_BOTTOM: Rgb = [11, 15, 28];
const CELL_GRID_LINE: Rgb = [36, 46, 74];

const FILE_SIZES_PX = [16, 32, 48, 64, 128, 256, 512];
const PRIMARY_PNG_SIZE_PX = 512;
const ICNS_SIZES_PX = [...ICNS_PNG_TYPES_BY_SIZE_PX.keys()];
const CORNER_RADIUS_FRACTION = 0.18;
const CORNER_SUBSAMPLES_PER_AXIS = 4;
const MIN_CELL_PX_FOR_GAPS = 8;
const CELL_GAP_FRACTION = 0.1;
const MIN_CELL_PX_FOR_GRID_LINES = 8;
const CELL_PX_PER_GRID_LINE_PX = 24;
const RGBA_CHANNELS = 4;
const RED = 0, GREEN = 1, BLUE = 2, ALPHA = 3;
const OPAQUE_ALPHA = 255;
const HALF = 0.5;

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
    const channel = (index: number): number => Math.round(from[index] + (to[index] - from[index]) * amount);
    return [channel(RED), channel(GREEN), channel(BLUE)];
}

function roundedSquareCoverage(x: number, y: number, sizePx: number): number {
    const radius = sizePx * CORNER_RADIUS_FRACTION;
    let inside = 0;
    for (let sy = 0; sy < CORNER_SUBSAMPLES_PER_AXIS; sy++) {
        for (let sx = 0; sx < CORNER_SUBSAMPLES_PER_AXIS; sx++) {
            const px = x + (sx + HALF) / CORNER_SUBSAMPLES_PER_AXIS;
            const py = y + (sy + HALF) / CORNER_SUBSAMPLES_PER_AXIS;
            const dx = Math.max(radius - px, px - (sizePx - radius), 0);
            const dy = Math.max(radius - py, py - (sizePx - radius), 0);
            if (dx * dx + dy * dy <= radius * radius) inside++;
        }
    }
    return inside / (CORNER_SUBSAMPLES_PER_AXIS * CORNER_SUBSAMPLES_PER_AXIS);
}

function motifColorAt(x: number, y: number, cellPx: number): Rgb | undefined {
    const symbol = MOTIF[Math.floor(y / cellPx)][Math.floor(x / cellPx)];
    if (symbol === EMPTY_CELL) return undefined;
    const gapPx = cellPx >= MIN_CELL_PX_FOR_GAPS ? Math.max(1, Math.round(cellPx * CELL_GAP_FRACTION)) : 0;
    const firstLitPx = Math.floor(gapPx * HALF);
    const lastLitPx = cellPx - Math.ceil(gapPx * HALF);
    const insideX = x % cellPx >= firstLitPx && x % cellPx < lastLitPx;
    const insideY = y % cellPx >= firstLitPx && y % cellPx < lastLitPx;
    return insideX && insideY ? MOTIF_COLORS[symbol] : undefined;
}

function backgroundAt(x: number, y: number, sizePx: number, cellPx: number): Rgb {
    const gradient = mix(BACKGROUND_TOP, BACKGROUND_BOTTOM, y / (sizePx - 1));
    if (cellPx < MIN_CELL_PX_FOR_GRID_LINES) return gradient;
    const lineWidthPx = Math.max(1, Math.floor(cellPx / CELL_PX_PER_GRID_LINE_PX));
    const onGridLine = x % cellPx < lineWidthPx || y % cellPx < lineWidthPx;
    return onGridLine ? CELL_GRID_LINE : gradient;
}

function drawAppIcon(sizePx: number): Uint8Array {
    if (sizePx % MOTIF_CELLS !== 0) throw new Error(`icon sizes must be multiples of ${MOTIF_CELLS} px, got ${sizePx}`);
    const cellPx = sizePx / MOTIF_CELLS;
    const rgba = new Uint8Array(sizePx * sizePx * RGBA_CHANNELS);
    for (let y = 0; y < sizePx; y++) {
        for (let x = 0; x < sizePx; x++) {
            const color = motifColorAt(x, y, cellPx) ?? backgroundAt(x, y, sizePx, cellPx);
            const i = (y * sizePx + x) * RGBA_CHANNELS;
            rgba.set(color, i);
            rgba[i + ALPHA] = Math.round(OPAQUE_ALPHA * roundedSquareCoverage(x, y, sizePx));
        }
    }
    return rgba;
}

function renderPng(sizePx: number): PngIconImage {
    return {sizePx, png: encodePng(sizePx, sizePx, drawAppIcon(sizePx), nodeDeflate)};
}

function writeIconFile(fileName: string, bytes: Uint8Array): void {
    const path = join(APP_ICON_DIRECTORY, fileName);
    writeFileSync(path, bytes);
    console.log(`wrote ${relative(ROOT, path).replace(/\\/g, "/")} (${bytes.length} bytes)`);
}

const renderedBySize = new Map<number, PngIconImage>();
const pngOfSize = (sizePx: number): PngIconImage => {
    const cached = renderedBySize.get(sizePx);
    if (cached !== undefined) return cached;
    const rendered = renderPng(sizePx);
    renderedBySize.set(sizePx, rendered);
    return rendered;
};

mkdirSync(APP_ICON_DIRECTORY, {recursive: true});
for (const sizePx of FILE_SIZES_PX) writeIconFile(`icon-${sizePx}.png`, pngOfSize(sizePx).png);
writeIconFile(APP_ICON_PNG_FILE, pngOfSize(PRIMARY_PNG_SIZE_PX).png);
writeIconFile(APP_ICON_ICO_FILE, encodeIco(FILE_SIZES_PX.filter(sizePx => sizePx <= ICO_MAX_DIMENSION_PX).map(pngOfSize)));
writeIconFile(APP_ICON_ICNS_FILE, encodeIcns(ICNS_SIZES_PX.map(pngOfSize)));
