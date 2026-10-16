import {describe, expect, test} from "../../../testing/harness";
import {adler32, inflate} from "./inflate";
import {decodePng, encodePng} from "./png";

const zlib = require("zlib") as typeof import("zlib");
const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

const DEMO_3D = path.resolve(__dirname, "../../../../../demo/3d");

function zlibInflate(bytes: Uint8Array): Uint8Array {
    return new Uint8Array(zlib.inflateSync(bytes));
}

function deflate(bytes: Uint8Array, options: import("zlib").ZlibOptions): Uint8Array {
    return new Uint8Array(zlib.deflateSync(bytes, options));
}

function randomBytes(length: number, seed: number = 1): Uint8Array {
    const bytes = new Uint8Array(length);
    let state = seed;
    for (let i = 0; i < length; i++) {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        bytes[i] = state >>> 24;
    }
    return bytes;
}

function repetitiveBytes(length: number): Uint8Array {
    const pattern = new TextEncoder().encode("the quick brown fox jumps over the lazy dog. ");
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) bytes[i] = pattern[i % pattern.length];
    return bytes;
}

/** Alternating random and run-heavy stretches: the compressor switches block types and tables. */
function mixedBytes(length: number): Uint8Array {
    const random = randomBytes(length, 7);
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) bytes[i] = (i >> 14) % 2 === 0 ? random[i] : (i >> 8) & 3;
    return bytes;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

/** Blocks in a zlib stream made only of stored blocks: each is a 5-byte header (type byte, LEN, NLEN) plus LEN bytes. */
function countStoredBlocks(stream: Uint8Array): number {
    let blocks = 0;
    let pos = 2;
    for (;;) {
        blocks++;
        const final = stream[pos] & 1;
        pos += 5 + (stream[pos + 1] | (stream[pos + 2] << 8));
        if (final === 1) return blocks;
    }
}

const INPUTS: readonly [name: string, bytes: Uint8Array][] = [
    ["empty", new Uint8Array(0)],
    ["one byte", new Uint8Array([42])],
    ["random", randomBytes(200_000)],
    ["repetitive", repetitiveBytes(300_000)],
    ["mixed", mixedBytes(1_000_000)],
];

describe("inflate", () => {
    for (const level of [0, 1, 6, 9]) {
        test(`round-trips zlib deflateSync at level ${level}`, () => {
            for (const [name, bytes] of INPUTS) {
                const inflated = inflate(deflate(bytes, {level}));
                expect(`${name}: ${sameBytes(inflated, bytes)}`).toBe(`${name}: true`);
            }
        });
    }

    test("round-trips fixed-Huffman, Huffman-only and RLE streams", () => {
        const {Z_FIXED, Z_HUFFMAN_ONLY, Z_RLE} = zlib.constants;
        for (const strategy of [Z_FIXED, Z_HUFFMAN_ONLY, Z_RLE]) {
            for (const [name, bytes] of INPUTS) {
                const inflated = inflate(deflate(bytes, {level: 6, strategy}));
                expect(`${name}/${strategy}: ${sameBytes(inflated, bytes)}`).toBe(`${name}/${strategy}: true`);
            }
        }
    });

    test("multi-block streams: many stored blocks, and many Huffman blocks with a small memory level", () => {
        const bytes = mixedBytes(400_000);
        const stored = deflate(bytes, {level: 0});
        expect(countStoredBlocks(stored)).toBeGreaterThan(5);
        expect(sameBytes(inflate(stored), bytes)).toBe(true);
        // memLevel 1 caps each block's symbol buffer at 512 symbols, so this is hundreds of dynamic blocks.
        const dynamic = deflate(bytes, {level: 9, memLevel: 1});
        expect(sameBytes(inflate(dynamic), bytes)).toBe(true);
    });

    test("decodes matches that overlap their own output (distance < length)", () => {
        const bytes = new Uint8Array(100_000).fill(0xab);
        bytes[0] = 1;
        expect(sameBytes(inflate(deflate(bytes, {level: 9})), bytes)).toBe(true);
    });

    test("every committed demo PNG decodes to the same pixels as with zlib", () => {
        const pngs = fs.readdirSync(DEMO_3D).filter(name => name.toLowerCase().endsWith(".png"));
        expect(pngs.length).toBeGreaterThan(0);
        for (const name of pngs) {
            const bytes = new Uint8Array(fs.readFileSync(path.join(DEMO_3D, name)));
            const ours = decodePng(bytes, {inflate});
            const reference = decodePng(bytes, {inflate: zlibInflate});
            expect(`${name} ${ours.width}x${ours.height}`).toBe(`${name} ${reference.width}x${reference.height}`);
            expect(`${name}: ${sameBytes(ours.rgba, reference.rgba)}`).toBe(`${name}: true`);
        }
    });

    test("a large noisy PNG decodes to the same pixels as with zlib", () => {
        const size = 512;
        const rgba = randomBytes(size * size * 4, 3);
        for (let i = 0; i < rgba.length; i += 4) rgba[i] = (i >> 10) & 0xff;
        const png = encodePng(size, size, rgba, bytes => deflate(bytes, {level: 6}));
        expect(sameBytes(decodePng(png, {inflate}).rgba, decodePng(png, {inflate: zlibInflate}).rgba)).toBe(true);
    });

    test("throws on a corrupt header, a preset dictionary, truncation, bad data and a bad checksum", () => {
        const bytes = repetitiveBytes(10_000);
        const good = deflate(bytes, {level: 6});

        const badMethod = good.slice();
        badMethod[0] = (badMethod[0] & 0xf0) | 7;
        expect(() => inflate(badMethod)).toThrow("compression method");

        const badCheck = good.slice();
        badCheck[1] ^= 1;
        expect(() => inflate(badCheck)).toThrow("header check");

        const withDictionary = new Uint8Array(zlib.deflateSync(bytes, {dictionary: Buffer.from("fox")}));
        expect(() => inflate(withDictionary)).toThrow("dictionar");

        expect(() => inflate(good.subarray(0, good.length - 6))).toThrow();
        expect(() => inflate(good.subarray(0, 3))).toThrow("too short");

        const badAdler = good.slice();
        badAdler[badAdler.length - 1] ^= 0xff;
        expect(() => inflate(badAdler)).toThrow("Adler-32");

        const invalidBlockType = new Uint8Array([0x78, 0x9c, 0x07, 0, 0, 0, 0, 0]);
        expect(() => inflate(invalidBlockType)).toThrow("block type");

        const stored = deflate(bytes.subarray(0, 100), {level: 0});
        const badStoredLength = stored.slice();
        badStoredLength[5] ^= 0xff;
        expect(() => inflate(badStoredLength)).toThrow("stored block");

        let flipsCaught = 0;
        for (let i = 2; i < good.length - 5; i += 7) {
            const flipped = good.slice();
            flipped[i] ^= 0x5a;
            try {
                inflate(flipped);
            } catch {
                flipsCaught++;
            }
        }
        expect(flipsCaught).toBe(Math.ceil((good.length - 7) / 7));
    });

    test("adler32 matches the checksum zlib writes", () => {
        const bytes = randomBytes(70_000, 11);
        const stream = deflate(bytes, {level: 1});
        const trailer = new DataView(stream.buffer, stream.byteOffset + stream.length - 4, 4).getUint32(0);
        expect(adler32(bytes)).toBe(trailer);
        expect(adler32(new Uint8Array(0))).toBe(1);
    });
});
