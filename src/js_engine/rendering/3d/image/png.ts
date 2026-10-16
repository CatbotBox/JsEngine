import {DecodedImage, registerImageDecoder} from "./decodedImage";
import type {AssetLoadOptions} from "../../../platform";
import {nodeDeflate, nodePlatform} from "../../../platform";

export const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const COLOR_GREY = 0;
const COLOR_RGB = 2;
const COLOR_PALETTE = 3;
const COLOR_GREY_ALPHA = 4;
const COLOR_RGBA = 6;

const FILTER_NONE = 0;
const FILTER_SUB = 1;
const FILTER_UP = 2;
const FILTER_AVERAGE = 3;
const FILTER_PAETH = 4;

const channelsByColorType: Record<number, number> = {
    [COLOR_GREY]: 1,
    [COLOR_RGB]: 3,
    [COLOR_PALETTE]: 1,
    [COLOR_GREY_ALPHA]: 2,
    [COLOR_RGBA]: 4,
};

export function decodePng(bytes: Uint8Array, options: Pick<AssetLoadOptions, "inflate"> = {}): DecodedImage {
    verifySignature(bytes);
    const chunks = readChunks(bytes);
    const header = parseHeader(chunks.header);
    const compressed = concatenate(chunks.imageData);
    const inflate = options.inflate ?? nodePlatform().inflate;
    const raw = new Uint8Array(inflate(compressed));
    const scanlines = unfilterScanlines(raw, header);
    return {
        width: header.width,
        height: header.height,
        rgba: toRgba(scanlines, header, chunks.palette, chunks.transparency),
    };
}

export function encodePng(width: number, height: number, rgba: Uint8Array, deflate: (bytes: Uint8Array) => Uint8Array = nodeDeflate): Uint8Array {
    const rowStride = width * 4;
    const filtered = new Uint8Array((rowStride + 1) * height);
    for (let y = 0; y < height; y++) {
        filtered[y * (rowStride + 1)] = FILTER_NONE;
        filtered.set(rgba.subarray(y * rowStride, (y + 1) * rowStride), y * (rowStride + 1) + 1);
    }
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    header[8] = 8;
    header[9] = COLOR_RGBA;
    return concatenate([
        new Uint8Array(PNG_SIGNATURE),
        pngChunk("IHDR", header),
        pngChunk("IDAT", deflate(filtered)),
        pngChunk("IEND", new Uint8Array(0)),
    ]);
}

registerImageDecoder(".png", decodePng);

interface PngHeader {
    width: number;
    height: number;
    bitDepth: number;
    colorType: number;
    channels: number;
    bytesPerPixel: number;
    scanlineBytes: number;
}

interface PngChunks {
    header: Uint8Array;
    palette: Uint8Array | null;
    transparency: Uint8Array | null;
    imageData: Uint8Array[];
}

function verifySignature(bytes: Uint8Array): void {
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
        if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error("Not a PNG file: signature mismatch");
    }
}

function readChunks(bytes: Uint8Array): PngChunks {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let header: Uint8Array | null = null;
    let palette: Uint8Array | null = null;
    let transparency: Uint8Array | null = null;
    const imageData: Uint8Array[] = [];
    let offset = PNG_SIGNATURE.length;
    while (offset + 8 <= bytes.length) {
        const length = view.getUint32(offset);
        const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
        const data = bytes.subarray(offset + 8, offset + 8 + length);
        if (type === "IHDR") header = data;
        else if (type === "PLTE") palette = data;
        else if (type === "tRNS") transparency = data;
        else if (type === "IDAT") imageData.push(data);
        else if (type === "IEND") break;
        offset += 12 + length;
    }
    if (header === null) throw new Error("PNG has no IHDR chunk");
    if (imageData.length === 0) throw new Error("PNG has no IDAT chunk");
    return {header, palette, transparency, imageData};
}

function parseHeader(data: Uint8Array): PngHeader {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const width = view.getUint32(0);
    const height = view.getUint32(4);
    const bitDepth = data[8];
    const colorType = data[9];
    const interlace = data[12];
    const channels = channelsByColorType[colorType];
    if (channels === undefined) throw new Error(`PNG color type ${colorType} is not supported`);
    if (interlace !== 0) throw new Error("Interlaced (Adam7) PNGs are not supported; re-export without interlacing");
    if (![1, 2, 4, 8, 16].includes(bitDepth)) throw new Error(`PNG bit depth ${bitDepth} is not valid`);
    const bitsPerPixel = channels * bitDepth;
    return {
        width, height, bitDepth, colorType, channels,
        bytesPerPixel: Math.max(1, bitsPerPixel >> 3),
        scanlineBytes: (width * bitsPerPixel + 7) >> 3,
    };
}

function unfilterScanlines(raw: Uint8Array, header: PngHeader): Uint8Array {
    const {height, scanlineBytes, bytesPerPixel} = header;
    const out = new Uint8Array(scanlineBytes * height);
    let inOffset = 0;
    for (let y = 0; y < height; y++) {
        const filter = raw[inOffset++];
        const rowStart = y * scanlineBytes;
        const previousRowStart = rowStart - scanlineBytes;
        for (let x = 0; x < scanlineBytes; x++) {
            const value = raw[inOffset + x];
            const left = x >= bytesPerPixel ? out[rowStart + x - bytesPerPixel] : 0;
            const up = y > 0 ? out[previousRowStart + x] : 0;
            const upLeft = y > 0 && x >= bytesPerPixel ? out[previousRowStart + x - bytesPerPixel] : 0;
            let predictor: number;
            switch (filter) {
                case FILTER_NONE: predictor = 0; break;
                case FILTER_SUB: predictor = left; break;
                case FILTER_UP: predictor = up; break;
                case FILTER_AVERAGE: predictor = (left + up) >> 1; break;
                case FILTER_PAETH: predictor = paeth(left, up, upLeft); break;
                default: throw new Error(`PNG scanline ${y} uses unknown filter ${filter}`);
            }
            out[rowStart + x] = (value + predictor) & 255;
        }
        inOffset += scanlineBytes;
    }
    return out;
}

function paeth(left: number, up: number, upLeft: number): number {
    const estimate = left + up - upLeft;
    const distanceLeft = Math.abs(estimate - left);
    const distanceUp = Math.abs(estimate - up);
    const distanceUpLeft = Math.abs(estimate - upLeft);
    if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
    return distanceUp <= distanceUpLeft ? up : upLeft;
}

function toRgba(scanlines: Uint8Array, header: PngHeader, palette: Uint8Array | null, transparency: Uint8Array | null): Uint8Array {
    const {width, height, colorType, bitDepth, scanlineBytes} = header;
    const rgba = new Uint8Array(width * height * 4);
    const maxSample = (1 << bitDepth) - 1;
    const sampleAt = bitDepth === 16
        ? (row: number, index: number) => scanlines[row * scanlineBytes + index * 2]
        : bitDepth === 8
            ? (row: number, index: number) => scanlines[row * scanlineBytes + index]
            : (row: number, index: number) => readSubByteSample(scanlines, row * scanlineBytes, index, bitDepth);
    const toByte = bitDepth === 8 || bitDepth === 16
        ? (sample: number) => sample
        : (sample: number) => Math.round(sample * 255 / maxSample);
    const transparentKey = transparency !== null && colorType !== COLOR_PALETTE ? readTransparentKey(transparency, colorType, bitDepth) : null;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const out = (y * width + x) * 4;
            let r: number, g: number, b: number, a = 255;
            if (colorType === COLOR_PALETTE) {
                const index = sampleAt(y, x);
                if (palette === null || index * 3 + 2 >= palette.length) throw new Error(`PNG palette index ${index} is out of range`);
                r = palette[index * 3];
                g = palette[index * 3 + 1];
                b = palette[index * 3 + 2];
                if (transparency !== null && index < transparency.length) a = transparency[index];
            } else if (colorType === COLOR_GREY || colorType === COLOR_GREY_ALPHA) {
                const grey = sampleAt(y, x * header.channels);
                r = g = b = toByte(grey);
                if (colorType === COLOR_GREY_ALPHA) a = toByte(sampleAt(y, x * 2 + 1));
                else if (transparentKey !== null && grey === transparentKey[0]) a = 0;
            } else {
                const base = x * header.channels;
                const rs = sampleAt(y, base), gs = sampleAt(y, base + 1), bs = sampleAt(y, base + 2);
                r = toByte(rs);
                g = toByte(gs);
                b = toByte(bs);
                if (colorType === COLOR_RGBA) a = toByte(sampleAt(y, base + 3));
                else if (transparentKey !== null && rs === transparentKey[0] && gs === transparentKey[1] && bs === transparentKey[2]) a = 0;
            }
            rgba[out] = r;
            rgba[out + 1] = g;
            rgba[out + 2] = b;
            rgba[out + 3] = a;
        }
    }
    return rgba;
}

function readSubByteSample(scanlines: Uint8Array, rowOffset: number, index: number, bitDepth: number): number {
    const bitOffset = index * bitDepth;
    const byte = scanlines[rowOffset + (bitOffset >> 3)];
    const shift = 8 - bitDepth - (bitOffset & 7);
    return (byte >> shift) & ((1 << bitDepth) - 1);
}

function readTransparentKey(transparency: Uint8Array, colorType: number, bitDepth: number): number[] {
    const view = new DataView(transparency.buffer, transparency.byteOffset, transparency.byteLength);
    const sampleCount = colorType === COLOR_RGB ? 3 : 1;
    const key: number[] = [];
    for (let i = 0; i < sampleCount && i * 2 + 1 < transparency.length; i++) {
        const sample16 = view.getUint16(i * 2);
        key.push(bitDepth === 16 ? sample16 >> 8 : sample16);
    }
    return key;
}

function concatenate(parts: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const part of parts) total += part.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
    const chunk = new Uint8Array(12 + data.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
    chunk.set(data, 8);
    view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
    return chunk;
}

const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}
