import {describe, expect, test} from "../../../testing/harness";
import {decodeJpeg, encodeJpeg, JpegEncodeOptions} from "./jpeg";
import {decodeImageFile} from "./decodedImage";
import {Texture} from "../texture";

function flatRgba(width: number, height: number, r: number, g: number, b: number): Uint8Array {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = 255;
    }
    return rgba;
}

function gradientRgba(width: number, height: number): Uint8Array {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            rgba[i] = Math.round(x * 255 / Math.max(1, width - 1));
            rgba[i + 1] = Math.round(y * 255 / Math.max(1, height - 1));
            rgba[i + 2] = 128;
            rgba[i + 3] = 255;
        }
    }
    return rgba;
}

interface ErrorStats {
    max: number;
    mean: number;
}

function colorError(expected: Uint8Array, actual: Uint8Array): ErrorStats {
    let max = 0, total = 0, count = 0;
    for (let i = 0; i < expected.length; i += 4) {
        for (let channel = 0; channel < 3; channel++) {
            const difference = Math.abs(expected[i + channel] - actual[i + channel]);
            max = Math.max(max, difference);
            total += difference;
            count++;
        }
        expect(actual[i + 3]).toBe(255);
    }
    return {max, mean: total / count};
}

function roundTrip(width: number, height: number, rgba: Uint8Array, options?: JpegEncodeOptions): Uint8Array {
    const decoded = decodeJpeg(encodeJpeg(width, height, rgba, options));
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    return decoded.rgba;
}

function distinctColorCount(rgba: Uint8Array, stride: number): number {
    const seen = new Set<number>();
    for (let i = 0; i < rgba.length; i += 4 * stride) seen.add((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
    return seen.size;
}

describe("decodeJpeg", () => {
    test("round-trips a flat colour at quality 100 within +-2", () => {
        const source = flatRgba(16, 16, 200, 30, 90);
        const error = colorError(source, roundTrip(16, 16, source, {quality: 100}));
        expect(error.max).toBeLessThan(3);
    });

    test("round-trips a 4:4:4 gradient at quality 90 with bounded error", () => {
        const source = gradientRgba(32, 24);
        const error = colorError(source, roundTrip(32, 24, source));
        expect(error.max).toBeLessThan(16);
        expect(error.mean).toBeLessThan(3);
    });

    test("decodes odd-sized 4:2:0 images with chroma upsampling and edge cropping", () => {
        const source = gradientRgba(45, 35);
        const error = colorError(source, roundTrip(45, 35, source, {chromaSubsampling: "4:2:0"}));
        expect(error.max).toBeLessThan(16);
        expect(error.mean).toBeLessThan(4);
    });

    test("restart intervals reproduce the exact same pixels as one continuous scan", () => {
        const source = gradientRgba(40, 24);
        const continuous = roundTrip(40, 24, source);
        const restarted = roundTrip(40, 24, source, {restartInterval: 2});
        const restartedSubsampled = roundTrip(40, 24, source, {restartInterval: 1, chromaSubsampling: "4:2:0"});
        const continuousSubsampled = roundTrip(40, 24, source, {chromaSubsampling: "4:2:0"});
        expect(Array.from(restarted)).toEqual(Array.from(continuous));
        expect(Array.from(restartedSubsampled)).toEqual(Array.from(continuousSubsampled));
    });

    test("round-trips a greyscale one-component frame", () => {
        const width = 20, height = 9;
        const source = new Uint8Array(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            const value = (i * 7) & 255;
            source[i * 4] = source[i * 4 + 1] = source[i * 4 + 2] = value;
            source[i * 4 + 3] = 255;
        }
        const decoded = roundTrip(width, height, source, {greyscale: true, quality: 100});
        for (let i = 0; i < decoded.length; i += 4) {
            expect(decoded[i]).toBe(decoded[i + 1]);
            expect(decoded[i]).toBe(decoded[i + 2]);
        }
        expect(colorError(source, decoded).max).toBeLessThan(3);
    });

    test("rejects progressive, non-JPEG and truncated data with clear messages", () => {
        const encoded = encodeJpeg(32, 24, gradientRgba(32, 24));
        const progressive = new Uint8Array(encoded);
        for (let i = 0; i + 1 < progressive.length; i++) {
            if (progressive[i] === 0xFF && progressive[i + 1] === 0xC0) {
                progressive[i + 1] = 0xC2;
                break;
            }
        }
        expect(() => decodeJpeg(progressive)).toThrow("Progressive");
        expect(() => decodeJpeg(new Uint8Array([1, 2, 3, 4]))).toThrow("SOI");
        expect(() => decodeJpeg(encoded.subarray(0, encoded.length - 60))).toThrow("truncated");
    });

    test("decodes the demo cat textures (4:2:0, restart intervals, Adobe marker)", () => {
        const diffuse = decodeImageFile("./demo/3d/Cat_diffuse.jpg");
        expect(diffuse.width).toBe(1024);
        expect(diffuse.height).toBe(1024);
        expect(distinctColorCount(diffuse.rgba, 4099)).toBeGreaterThan(16);

        const bump = decodeImageFile("./demo/3d/Cat_bump.jpg");
        expect(bump.width).toBe(1024);
        expect(distinctColorCount(bump.rgba, 4099)).toBeGreaterThan(16);

        const texture = Texture.fromFile("./demo/3d/Cat_diffuse.jpg");
        expect(texture.width).toBe(512);
        expect(texture.levels.length).toBe(10);
    });
});
