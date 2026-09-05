import {describe, expect, test} from "../../../testing/harness";
import {decodePng, encodePng, PNG_SIGNATURE, pngChunk} from "./png";
import {decodePpm, encodePpm} from "./ppm";
import {decodeImageFile} from "./decodedImage";

interface PngSpec {
    width: number;
    height: number;
    bitDepth: number;
    colorType: number;
    rows: number[][];
    filters?: number[];
    palette?: number[];
    transparency?: number[];
    interlace?: number;
}

function buildPng(spec: PngSpec): Uint8Array {
    const zlib = require("zlib") as typeof import("zlib");
    const channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[spec.colorType]!;
    const bytesPerPixel = Math.max(1, (channels * spec.bitDepth) >> 3);
    const filtered: number[] = [];
    let previous: number[] | null = null;
    for (let y = 0; y < spec.height; y++) {
        const row = spec.rows[y];
        const filter = spec.filters?.[y] ?? 0;
        filtered.push(filter);
        for (let x = 0; x < row.length; x++) {
            const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
            const up = previous !== null ? previous[x] : 0;
            const upLeft = previous !== null && x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
            const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
            filtered.push((row[x] - predictor) & 255);
        }
        previous = row;
    }
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, spec.width);
    view.setUint32(4, spec.height);
    header[8] = spec.bitDepth;
    header[9] = spec.colorType;
    header[12] = spec.interlace ?? 0;
    const parts = [new Uint8Array(PNG_SIGNATURE), pngChunk("IHDR", header)];
    if (spec.palette) parts.push(pngChunk("PLTE", new Uint8Array(spec.palette)));
    if (spec.transparency) parts.push(pngChunk("tRNS", new Uint8Array(spec.transparency)));
    parts.push(pngChunk("IDAT", new Uint8Array(zlib.deflateSync(new Uint8Array(filtered)))));
    parts.push(pngChunk("IEND", new Uint8Array(0)));
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

function paeth(left: number, up: number, upLeft: number): number {
    const estimate = left + up - upLeft;
    const dl = Math.abs(estimate - left), du = Math.abs(estimate - up), dul = Math.abs(estimate - upLeft);
    if (dl <= du && dl <= dul) return left;
    return du <= dul ? up : upLeft;
}

function pixel(rgba: Uint8Array, width: number, x: number, y: number): number[] {
    const i = (y * width + x) * 4;
    return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
}

describe("decodePng", () => {
    test("round-trips an RGBA image through encodePng", () => {
        const width = 5, height = 3;
        const rgba = new Uint8Array(width * height * 4);
        for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37 + 11) & 255;
        const decoded = decodePng(encodePng(width, height, rgba));
        expect(decoded.width).toBe(width);
        expect(decoded.height).toBe(height);
        expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba));
    });

    test("undoes every scanline filter on 8-bit RGB", () => {
        const rows = [
            [10, 20, 30, 40, 50, 60, 70, 80, 90],
            [15, 25, 35, 45, 55, 65, 75, 85, 95],
            [200, 100, 0, 250, 5, 128, 64, 32, 16],
            [1, 2, 3, 4, 5, 6, 7, 8, 9],
            [255, 254, 253, 0, 1, 2, 100, 101, 102],
        ];
        const decoded = decodePng(buildPng({width: 3, height: 5, bitDepth: 8, colorType: 2, rows, filters: [0, 1, 2, 3, 4]}));
        for (let y = 0; y < 5; y++) {
            for (let x = 0; x < 3; x++) {
                expect(pixel(decoded.rgba, 3, x, y)).toEqual([rows[y][x * 3], rows[y][x * 3 + 1], rows[y][x * 3 + 2], 255]);
            }
        }
    });

    test("expands a 2-bit palette image with tRNS alpha", () => {
        const decoded = decodePng(buildPng({
            width: 4, height: 1, bitDepth: 2, colorType: 3,
            rows: [[0b00011011]],
            palette: [255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9],
            transparency: [255, 128],
        }));
        expect(pixel(decoded.rgba, 4, 0, 0)).toEqual([255, 0, 0, 255]);
        expect(pixel(decoded.rgba, 4, 1, 0)).toEqual([0, 255, 0, 128]);
        expect(pixel(decoded.rgba, 4, 2, 0)).toEqual([0, 0, 255, 255]);
        expect(pixel(decoded.rgba, 4, 3, 0)).toEqual([9, 9, 9, 255]);
    });

    test("scales 1-bit greyscale to full range", () => {
        const decoded = decodePng(buildPng({width: 3, height: 1, bitDepth: 1, colorType: 0, rows: [[0b10100000]]}));
        expect(pixel(decoded.rgba, 3, 0, 0)).toEqual([255, 255, 255, 255]);
        expect(pixel(decoded.rgba, 3, 1, 0)).toEqual([0, 0, 0, 255]);
        expect(pixel(decoded.rgba, 3, 2, 0)).toEqual([255, 255, 255, 255]);
    });

    test("takes the high byte of 16-bit grey+alpha samples", () => {
        const decoded = decodePng(buildPng({width: 1, height: 1, bitDepth: 16, colorType: 4, rows: [[0xAB, 0xCD, 0x12, 0x34]]}));
        expect(pixel(decoded.rgba, 1, 0, 0)).toEqual([0xAB, 0xAB, 0xAB, 0x12]);
    });

    test("applies an RGB tRNS color key", () => {
        const decoded = decodePng(buildPng({
            width: 2, height: 1, bitDepth: 8, colorType: 2,
            rows: [[1, 2, 3, 4, 5, 6]],
            transparency: [0, 1, 0, 2, 0, 3],
        }));
        expect(pixel(decoded.rgba, 2, 0, 0)).toEqual([1, 2, 3, 0]);
        expect(pixel(decoded.rgba, 2, 1, 0)).toEqual([4, 5, 6, 255]);
    });

    test("rejects interlaced images and non-PNG data with clear messages", () => {
        expect(() => decodePng(buildPng({width: 1, height: 1, bitDepth: 8, colorType: 0, rows: [[7]], interlace: 1}))).toThrow("Interlaced");
        expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow("signature");
    });
});

describe("ppm", () => {
    test("round-trips through encodePpm and tolerates header comments", () => {
        const rgba = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]);
        const encoded = encodePpm(2, 1, rgba);
        const decoded = decodePpm(encoded);
        expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba));

        const commented = new TextEncoder().encode("P6\n# a comment\n1 1\n255\n");
        const withPixels = new Uint8Array([...commented, 9, 8, 7]);
        expect(Array.from(decodePpm(withPixels).rgba)).toEqual([9, 8, 7, 255]);
    });

    test("rejects ascii PPM", () => {
        expect(() => decodePpm(new TextEncoder().encode("P3\n1 1\n255\n1 2 3\n"))).toThrow("P6");
    });
});

describe("decodeImageFile", () => {
    test("rejects unknown extensions and names the supported ones", () => {
        expect(() => decodeImageFile("texture.gif")).toThrow(".png");
    });
});
