import {describe, expect, test} from "../../../testing/harness";
import {inflate, inflateRaw} from "./inflate";

const zlib = require("zlib") as typeof import("zlib");

function expectBytesEqual(actual: Uint8Array, expected: Uint8Array): void {
    expect(actual.length).toBe(expected.length);
    let firstDifference = -1;
    for (let i = 0; i < expected.length; i++) {
        if (actual[i] !== expected[i]) {
            firstDifference = i;
            break;
        }
    }
    expect(firstDifference).toBe(-1);
}

function seededRandom(seed: number): () => number {
    let state = seed >>> 0 || 1;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 4294967296;
    };
}

function randomBytes(length: number, seed: number): Uint8Array {
    const random = seededRandom(seed);
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(random() * 256);
    return bytes;
}

function repetitiveBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    bytes.fill(0x61, 0, length >> 1);
    for (let i = length >> 1; i < length; i++) bytes[i] = "abc".charCodeAt(i % 3);
    return bytes;
}

const WORDS = ["the", "engine", "renders", "to", "a", "terminal", "with", "ANSI", "escape", "codes", "and", "archetype",
    "entity", "component", "system", "mesh", "texture", "triangle", "pixel", "\n", "of", "is", "lighting", "frame"];

function textBytes(length: number, seed: number): Uint8Array {
    const random = seededRandom(seed);
    const bytes = new Uint8Array(length);
    let i = 0;
    while (i < length) {
        const word = WORDS[Math.floor(random() * WORDS.length)] + " ";
        for (let c = 0; c < word.length && i < length; c++) bytes[i++] = word.charCodeAt(c);
    }
    return bytes;
}

function scanlineBytes(width: number, height: number, seed: number): Uint8Array {
    const random = seededRandom(seed);
    const stride = width * 4 + 1;
    const bytes = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
        bytes[y * stride] = y % 5;
        for (let x = 0; x < width * 4; x++) {
            const smooth = ((x >> 2) * 3 + y * 2 + (x & 3) * 40) & 255;
            bytes[y * stride + 1 + x] = random() < 0.1 ? Math.floor(random() * 256) : smooth;
        }
    }
    return bytes;
}

function largeMixedBytes(): Uint8Array {
    const text = textBytes(900_000, 7);
    const noise = randomBytes(200_000, 8);
    const runs = repetitiveBytes(300_000);
    const bytes = new Uint8Array(text.length + noise.length + runs.length);
    bytes.set(text, 0);
    bytes.set(noise, text.length);
    bytes.set(runs, text.length + noise.length);
    return bytes;
}

const INPUTS: [string, Uint8Array][] = [
    ["empty", new Uint8Array(0)],
    ["one byte", new Uint8Array([42])],
    ["repetitive", repetitiveBytes(100_000)],
    ["random 200 KB", randomBytes(200_000, 1)],
    ["text", textBytes(50_000, 2)],
    ["png scanlines", scanlineBytes(64, 64, 3)],
    ["over 1 MB", largeMixedBytes()],
];

const OPTIONS: [string, import("zlib").ZlibOptions][] = [
    ["level 0 (stored)", {level: 0}],
    ["level 1", {level: 1}],
    ["level 6", {level: 6}],
    ["level 9", {level: 9}],
    ["fixed Huffman", {strategy: zlib.constants.Z_FIXED}],
    ["Huffman only", {strategy: zlib.constants.Z_HUFFMAN_ONLY}],
    ["RLE", {strategy: zlib.constants.Z_RLE}],
];

describe("inflate (zlib)", () => {
    for (const [inputName, input] of INPUTS) {
        for (const [optionName, options] of OPTIONS) {
            test(`${inputName}, ${optionName}`, () => {
                const compressed = new Uint8Array(zlib.deflateSync(input, options));
                expectBytesEqual(inflate(compressed), input);
            });
        }
    }

    test("long overlapping distance-1 run reproduces the repeated byte", () => {
        const input = new Uint8Array(70_000).fill(7);
        const compressed = new Uint8Array(zlib.deflateSync(input, {level: 9}));
        expect(compressed.length).toBeLessThan(1000);
        expectBytesEqual(inflate(compressed), input);
    });
});

describe("inflateRaw", () => {
    for (const [inputName, input] of INPUTS) {
        for (const [optionName, options] of [OPTIONS[0], OPTIONS[2], OPTIONS[4]]) {
            test(`${inputName}, ${optionName}`, () => {
                const compressed = new Uint8Array(zlib.deflateRawSync(input, options));
                expectBytesEqual(inflateRaw(compressed), input);
            });
        }
    }
});

class BitWriter {
    private readonly bytes: number[] = [];
    private buffer = 0;
    private count = 0;

    public bits(value: number, count: number): this {
        for (let i = 0; i < count; i++) this.bit((value >> i) & 1);
        return this;
    }

    public code(code: number, length: number): this {
        for (let i = length - 1; i >= 0; i--) this.bit((code >> i) & 1);
        return this;
    }

    public finish(): Uint8Array {
        if (this.count > 0) this.bytes.push(this.buffer);
        return new Uint8Array(this.bytes);
    }

    private bit(bit: number): void {
        this.buffer |= bit << this.count;
        if (++this.count === 8) {
            this.bytes.push(this.buffer);
            this.buffer = 0;
            this.count = 0;
        }
    }
}

describe("inflate errors", () => {
    const valid = new Uint8Array(zlib.deflateSync(textBytes(5000, 4)));

    test("bad header checksum", () => {
        const corrupt = valid.slice();
        corrupt[1] ^= 1;
        expect(() => inflate(corrupt)).toThrow(/header checksum/);
    });

    test("preset dictionary flag", () => {
        const cmf = 0x78;
        let flg = 0x20;
        flg += 31 - ((cmf * 256 + flg) % 31);
        const stream = new Uint8Array([cmf, flg, 0, 0, 0, 0, 3, 0]);
        expect((cmf * 256 + flg) % 31).toBe(0);
        expect(() => inflate(stream)).toThrow(/FDICT/);
    });

    test("unsupported compression method", () => {
        const cmf = 0x77;
        const flg = 31 - ((cmf * 256) % 31);
        expect(() => inflate(new Uint8Array([cmf, flg, 3, 0]))).toThrow(/compression method/);
    });

    test("corrupted Adler-32", () => {
        const corrupt = valid.slice();
        corrupt[corrupt.length - 1] ^= 0xFF;
        expect(() => inflate(corrupt)).toThrow(/Adler-32 mismatch/);
    });

    test("truncated stream", () => {
        expect(() => inflate(valid.subarray(0, valid.length >> 1))).toThrow(/truncated/);
        expect(() => inflate(valid.subarray(0, valid.length - 2))).toThrow(/truncated/);
        expect(() => inflate(valid.subarray(0, 1))).toThrow(/truncated/);
        expect(() => inflateRaw(new Uint8Array(0))).toThrow(/truncated/);
    });

    test("truncated stored block", () => {
        const stored = new Uint8Array(zlib.deflateRawSync(randomBytes(1000, 5), {level: 0}));
        expect(() => inflateRaw(stored.subarray(0, 500))).toThrow(/truncated/);
    });

    test("stored block length complement mismatch", () => {
        expect(() => inflateRaw(new Uint8Array([0x01, 0x05, 0x00, 0xFA, 0xFE, 1, 2, 3, 4, 5]))).toThrow(/complement/);
        expectBytesEqual(inflateRaw(new Uint8Array([0x01, 0x05, 0x00, 0xFA, 0xFF, 1, 2, 3, 4, 5])), new Uint8Array([1, 2, 3, 4, 5]));
    });

    test("block type 3", () => {
        expect(() => inflate(new Uint8Array([0x78, 0x01, 0x07, 0, 0, 0, 0]))).toThrow(/block type 3/);
        expect(() => inflateRaw(new Uint8Array([0x07]))).toThrow(/block type 3/);
    });

    test("distance too far back", () => {
        const stream = new BitWriter().bits(1, 1).bits(1, 2).code(1, 7).code(0, 5).code(0, 7).finish();
        expect(() => inflateRaw(stream)).toThrow(/too far back/);
    });

    test("fixed-Huffman stream decodes when the match is in range", () => {
        const stream = new BitWriter().bits(1, 1).bits(1, 2).code(0x30 + 65, 8).code(1, 7).code(0, 5).code(0, 7).finish();
        expectBytesEqual(inflateRaw(stream), new Uint8Array([65, 65, 65, 65]));
    });

    test("over-subscribed code lengths", () => {
        const writer = new BitWriter().bits(1, 1).bits(2, 2).bits(0, 5).bits(0, 5).bits(15, 4);
        for (let i = 0; i < 19; i++) writer.bits(1, 3);
        expect(() => inflateRaw(writer.finish())).toThrow(/over-subscribed/);
    });

    test("incomplete code lengths", () => {
        const stream = new BitWriter().bits(1, 1).bits(2, 2).bits(0, 5).bits(0, 5).bits(0, 4)
            .bits(2, 3).bits(0, 3).bits(0, 3).bits(0, 3).finish();
        expect(() => inflateRaw(stream)).toThrow(/incomplete/);
    });
});
