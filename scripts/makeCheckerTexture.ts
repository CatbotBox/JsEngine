import {encodePng} from "../src/js_engine/rendering/3d/image/png";

const SIZE = 64;
const CHECK = 8;
const LIGHT = [232, 232, 232], DARK = [42, 42, 42], MARKER = [220, 40, 40];

const rgba = new Uint8Array(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
        const light = ((Math.floor(x / CHECK) + Math.floor(y / CHECK)) & 1) === 0;
        const insideOriginMarker = x < CHECK * 2 && y < CHECK * 2;
        const color = insideOriginMarker ? MARKER : light ? LIGHT : DARK;
        const i = (y * SIZE + x) * 4;
        rgba[i] = color[0];
        rgba[i + 1] = color[1];
        rgba[i + 2] = color[2];
        rgba[i + 3] = 255;
    }
}

const fs = require("fs") as typeof import("fs");
fs.writeFileSync("demo/3d/checker.png", encodePng(SIZE, SIZE, rgba));
fs.writeFileSync("demo/3d/cube.mtl", "newmtl Material\nKd 1.0 1.0 1.0\nKs 0.6 0.6 0.6\nNs 24\nmap_Kd checker.png\n");
console.log(`wrote demo/3d/checker.png (${SIZE}x${SIZE}) and demo/3d/cube.mtl`);
