/**
 * Hand-written inflate vs zlib.inflateSync on the IDAT streams of every PNG under a directory, plus two synthetic
 * 2048x2048 RGBA textures (noisy: mostly literals; smooth: mostly matches). Fails loudly if any output differs from zlib's.
 *
 * Run: bun bench/inflate.bench.ts [directory]   (default ./demo/3d, searched recursively)
 */
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import {inflate} from "../src/js_engine/rendering/3d/image/inflate";
import {fmt, median} from "./_harness";

const MIN_SAMPLE_MS = 50;
const SAMPLES = 7;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function findPngs(directory: string): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) found.push(...findPngs(full));
        else if (entry.name.toLowerCase().endsWith(".png")) found.push(full);
    }
    return found.sort();
}

function idatOf(file: Uint8Array): Uint8Array {
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
        if (file[i] !== PNG_SIGNATURE[i]) throw new Error("not a PNG");
    }
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    const parts: Uint8Array[] = [];
    let offset = PNG_SIGNATURE.length;
    while (offset + 8 <= file.length) {
        const length = view.getUint32(offset);
        const type = String.fromCharCode(file[offset + 4], file[offset + 5], file[offset + 6], file[offset + 7]);
        const data = file.subarray(offset + 8, offset + 8 + length);
        if (type === "IDAT") parts.push(data);
        offset += 12 + length;
        if (type === "IEND") break;
    }
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const idat = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
        idat.set(part, at);
        at += part.length;
    }
    return idat;
}

function syntheticTexture(width: number, height: number, noise: number): Uint8Array {
    let seed = 12345;
    const random = () => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return (seed >>> 0) / 4294967296;
    };
    const stride = width * 4 + 1;
    const filtered = new Uint8Array(stride * height);
    let previousRow = new Uint8Array(width * 4);
    let row = new Uint8Array(width * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const shade = 128 + 60 * Math.sin(x / 37) * Math.cos(y / 53) + noise * random();
            row[x * 4] = shade;
            row[x * 4 + 1] = shade * 0.8 + noise * 0.5 * random();
            row[x * 4 + 2] = 255 - shade;
            row[x * 4 + 3] = 255;
        }
        const base = y * stride;
        filtered[base] = y === 0 ? 1 : 2;
        for (let i = 0; i < row.length; i++) {
            const predictor = y === 0 ? (i >= 4 ? row[i - 4] : 0) : previousRow[i];
            filtered[base + 1 + i] = (row[i] - predictor) & 255;
        }
        [previousRow, row] = [row, previousRow];
    }
    return new Uint8Array(zlib.deflateSync(filtered, {level: 6}));
}

function medianMs(run: () => unknown): number {
    run();
    const once = performance.now();
    run();
    const single = Math.max(performance.now() - once, 0.001);
    const repeats = Math.max(1, Math.ceil(MIN_SAMPLE_MS / single));
    const samples: number[] = [];
    for (let s = 0; s < SAMPLES; s++) {
        const start = performance.now();
        for (let r = 0; r < repeats; r++) run();
        samples.push((performance.now() - start) / repeats);
    }
    return median(samples);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

const cases: [string, Uint8Array][] = [];
const directory = process.argv[2] ?? "./demo/3d";
for (const file of findPngs(directory)) cases.push([path.relative(directory, file), idatOf(new Uint8Array(fs.readFileSync(file)))]);
cases.push(["synthetic 2048x2048 RGBA noisy (lvl 6)", syntheticTexture(2048, 2048, 20)]);
cases.push(["synthetic 2048x2048 RGBA smooth (lvl 6)", syntheticTexture(2048, 2048, 0)]);

console.log(`directory: ${directory}, ${cases.length - 2} png(s)`);
console.log("case".padEnd(40) + "idat KB".padStart(10) + "out KB".padStart(10) + "  ours ms" + "  zlib ms" + "   ratio  identical");
let mismatches = 0;
for (const [name, idat] of cases) {
    const reference = new Uint8Array(zlib.inflateSync(idat));
    const identical = sameBytes(inflate(idat), reference);
    if (!identical) mismatches++;
    const ours = medianMs(() => inflate(idat));
    const native = medianMs(() => zlib.inflateSync(idat));
    console.log(
        name.slice(0, 39).padEnd(40)
        + (idat.length / 1024).toFixed(1).padStart(10)
        + (reference.length / 1024).toFixed(1).padStart(10)
        + "  " + fmt(ours)
        + "  " + fmt(native)
        + (ours / native).toFixed(2).padStart(7) + "x"
        + "  " + (identical ? "yes" : "NO"),
    );
}
if (mismatches > 0) {
    console.error(`${mismatches} case(s) differ from zlib.inflateSync`);
    process.exit(1);
}
