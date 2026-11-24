import {describe, expect, test} from "../../testing/harness";
import {deflate, deflateStored} from "./deflate";
import {inflate} from "./inflate";
import {decodePng, encodePng} from "./png";
import type * as Zlib from "zlib";

const zlib = require("zlib") as typeof Zlib;

const RGBA_BYTES = 4;
const LONG_RUN_BYTES = 100_000;
const FAR_REPEAT_GAP_BYTES = 40_000;

function seededBytes(length: number, seed: number): Uint8Array {
    let state = seed >>> 0 || 1;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        bytes[i] = state & 255;
    }
    return bytes;
}

function farRepeat(): Uint8Array {
    const block = seededBytes(300, 9);
    const bytes = new Uint8Array(block.length * 2 + FAR_REPEAT_GAP_BYTES);
    bytes.set(block);
    bytes.set(seededBytes(FAR_REPEAT_GAP_BYTES, 4), block.length);
    bytes.set(block, block.length + FAR_REPEAT_GAP_BYTES);
    return bytes;
}

function spriteRgba(width: number, height: number): Uint8Array {
    const rgba = new Uint8Array(width * height * RGBA_BYTES);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * RGBA_BYTES;
            const inside = (x + y) % 5 !== 0;
            rgba.set(inside ? [220, 40, 40, 255] : [0, 0, 0, 0], i);
        }
    }
    return rgba;
}

const SAMPLES: ReadonlyArray<readonly [string, Uint8Array]> = [
    ["empty", new Uint8Array(0)],
    ["one byte", new Uint8Array([7])],
    ["two bytes", new Uint8Array([7, 7])],
    ["a long run", new Uint8Array(LONG_RUN_BYTES).fill(0x41)],
    ["a short period", Uint8Array.from({length: 5000}, (_, i) => "abcab".charCodeAt(i % 5))],
    ["random bytes", seededBytes(70_000, 3)],
    ["a repeat beyond the window", farRepeat()],
    ["sprite pixels", spriteRgba(37, 23)],
];

describe("deflate", () => {
    for (const [name, input] of SAMPLES) {
        test(`round-trips ${name} through the engine inflate and zlib`, () => {
            const compressed = deflate(input);
            expect(Array.from(inflate(compressed))).toEqual(Array.from(input));
            expect(Array.from(new Uint8Array(zlib.inflateSync(compressed)))).toEqual(Array.from(input));
        });
    }

    test("compresses repetitive data and never grows past a stored stream", () => {
        const run = new Uint8Array(LONG_RUN_BYTES).fill(0x41);
        expect(deflate(run).length < LONG_RUN_BYTES / 100).toBe(true);
        const random = seededBytes(70_000, 3);
        expect(deflate(random).length <= deflateStored(random).length).toBe(true);
    });

    test("PNG files encoded with it decode to the same pixels", () => {
        const width = 37, height = 23;
        const rgba = spriteRgba(width, height);
        const png = encodePng(width, height, rgba, deflate);
        const decoded = decodePng(png, {inflate});
        expect([decoded.width, decoded.height]).toEqual([width, height]);
        expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba));
        expect(png.length < encodePng(width, height, rgba, deflateStored).length).toBe(true);
    });
});
