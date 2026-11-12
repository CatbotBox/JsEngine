import type * as FileSystem from "fs";
import {encodePng} from "../src/js_engine/rendering/3d/image/png";

const SIZE_PIXELS = 64;
const CHECK_PIXELS = 8;
const ORIGIN_MARKER_PIXELS = CHECK_PIXELS * 2;
const RGBA_CHANNELS = 4;
const OPAQUE_ALPHA = 255;
const LIGHT = [232, 232, 232], DARK = [42, 42, 42], MARKER = [220, 40, 40];

const rgba = new Uint8Array(SIZE_PIXELS * SIZE_PIXELS * RGBA_CHANNELS);
for (let y = 0; y < SIZE_PIXELS; y++) {
    for (let x = 0; x < SIZE_PIXELS; x++) {
        const light = ((Math.floor(x / CHECK_PIXELS) + Math.floor(y / CHECK_PIXELS)) & 1) === 0;
        const insideOriginMarker = x < ORIGIN_MARKER_PIXELS && y < ORIGIN_MARKER_PIXELS;
        const color = insideOriginMarker ? MARKER : light ? LIGHT : DARK;
        const i = (y * SIZE_PIXELS + x) * RGBA_CHANNELS;
        rgba[i] = color[0];
        rgba[i + 1] = color[1];
        rgba[i + 2] = color[2];
        rgba[i + 3] = OPAQUE_ALPHA;
    }
}

const fs = require("fs") as typeof FileSystem;
fs.writeFileSync("demo/3d/checker.png", encodePng(SIZE_PIXELS, SIZE_PIXELS, rgba));
fs.writeFileSync("demo/3d/cube.mtl", "newmtl Material\nKd 1.0 1.0 1.0\nKs 0.6 0.6 0.6\nNs 24\nmap_Kd checker.png\n");
console.log(`wrote demo/3d/checker.png (${SIZE_PIXELS}x${SIZE_PIXELS}) and demo/3d/cube.mtl`);
