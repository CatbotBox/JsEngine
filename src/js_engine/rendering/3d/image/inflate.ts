/**
 * zlib (RFC 1950) over DEFLATE (RFC 1951), synchronous and self-contained: the `Platform.inflate`
 * of hosts without zlib. Stored, fixed and dynamic Huffman blocks; preset dictionaries are not
 * supported (PNG never uses them).
 *
 * Huffman codes decode through one flat table per code, indexed by the next `maxLength` stream
 * bits (codes are stored bit-reversed, so the table is indexed with the low bits of the bit
 * buffer). An entry is `symbol << 4 | codeLength`; 0 marks a bit pattern no code starts with.
 */

const MAX_CODE_LENGTH = 15;
const END_OF_BLOCK = 256;
const MAX_LITERAL_LENGTH_CODES = 286;
const MAX_DISTANCE_CODES = 30;
const ADLER_MODULUS = 65521;
/** zlib's NMAX: bytes summed before both Adler-32 sums are reduced, so they stay below 2^32. */
const ADLER_CHUNK = 5552;
/** Matches shorter than this copy byte by byte; longer non-overlapping ones use `copyWithin`. */
const BYTE_COPY_LIMIT = 32;

const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const LENGTH_BASE = new Uint16Array([
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
    35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
]);
const LENGTH_EXTRA = new Uint8Array([
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
    3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
]);
const DISTANCE_BASE = new Uint16Array([
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
    257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
]);
const DISTANCE_EXTRA = new Uint8Array([
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
    7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
]);

interface HuffmanTable {
    readonly entries: Int32Array;
    readonly mask: number;
}

let fixedTables: {literalLength: HuffmanTable, distance: HuffmanTable} | undefined;

function fixedHuffmanTables(): {literalLength: HuffmanTable, distance: HuffmanTable} {
    if (fixedTables !== undefined) return fixedTables;
    const literalLengths = new Uint8Array(288);
    literalLengths.fill(8, 0, 144);
    literalLengths.fill(9, 144, 256);
    literalLengths.fill(7, 256, 280);
    literalLengths.fill(8, 280, 288);
    const distanceLengths = new Uint8Array(32).fill(5);
    fixedTables = {
        literalLength: buildTable(literalLengths, 0, 288, new Int32Array(1 << 9)),
        distance: buildTable(distanceLengths, 0, 32, new Int32Array(1 << 5)),
    };
    return fixedTables;
}

/**
 * Canonical Huffman table for `lengths[offset, offset + count)`, written into `scratch` (which must
 * hold 2^maxLength entries). Over-subscribed code sets throw; incomplete ones are allowed, as zlib
 * allows a single-code distance tree, and their missing patterns stay 0 so decoding them throws.
 */
function buildTable(lengths: Uint8Array, offset: number, count: number, scratch: Int32Array): HuffmanTable {
    const lengthCounts = new Uint16Array(MAX_CODE_LENGTH + 1);
    let maxLength = 0;
    for (let i = 0; i < count; i++) {
        const length = lengths[offset + i];
        lengthCounts[length]++;
        if (length > maxLength) maxLength = length;
    }
    lengthCounts[0] = 0;

    const nextCode = new Uint16Array(MAX_CODE_LENGTH + 2);
    let code = 0;
    let available = 1;
    for (let length = 1; length <= MAX_CODE_LENGTH; length++) {
        available = (available << 1) - lengthCounts[length];
        if (available < 0) throw new Error("inflate: over-subscribed Huffman code lengths");
        nextCode[length] = code;
        code = (code + lengthCounts[length]) << 1;
    }

    const size = 1 << Math.max(maxLength, 1);
    const entries = scratch.subarray(0, size);
    entries.fill(0);
    for (let symbol = 0; symbol < count; symbol++) {
        const length = lengths[offset + symbol];
        if (length === 0) continue;
        const reversed = reverseBits(nextCode[length]++, length);
        const entry = (symbol << 4) | length;
        for (let index = reversed; index < size; index += 1 << length) entries[index] = entry;
    }
    return {entries, mask: size - 1};
}

function reverseBits(code: number, length: number): number {
    let reversed = 0;
    for (let i = 0; i < length; i++) {
        reversed = (reversed << 1) | (code & 1);
        code >>>= 1;
    }
    return reversed;
}


function grow(out: Uint8Array, needed: number): Uint8Array {
    const next = new Uint8Array(Math.max(out.length * 2, needed));
    next.set(out);
    return next;
}

export function adler32(bytes: Uint8Array, start: number = 0, end: number = bytes.length): number {
    let a = 1;
    let b = 0;
    let i = start;
    while (i < end) {
        const chunkEnd = Math.min(i + ADLER_CHUNK, end);
        for (; i < chunkEnd; i++) {
            a += bytes[i];
            b += a;
        }
        a %= ADLER_MODULUS;
        b %= ADLER_MODULUS;
    }
    return ((b << 16) | a) >>> 0;
}

/** The longest match DEFLATE can emit; the decode loop keeps this much output room free. */
const MAX_MATCH = 258;

/** Table scratch reused across calls: `inflate` is synchronous, so two calls never share it. */
let literalScratch: Int32Array | undefined;
let distanceScratch: Int32Array | undefined;
const codeLengthScratch = new Int32Array(1 << 7);
const codeLengthLengths = new Uint8Array(CODE_LENGTH_ORDER.length);

function overrun(): never {
    throw new Error("inflate: unexpected end of compressed data");
}

/**
 * The stream position and output. Bits are consumed least-significant first from `bitBuffer`.
 * Reads past the end feed zero bytes; four may sit unread in the buffer (the most a refill takes
 * ahead), so needing a fifth means a bit beyond the input was consumed.
 */
class InflateStream {
    public pos = 2;
    public bitBuffer = 0;
    public bitCount = 0;
    public out: Uint8Array;
    public outPos = 0;

    public constructor(public readonly input: Uint8Array) {
        this.out = new Uint8Array(Math.max(1024, input.length * 4));
    }

    public bits(count: number): number {
        while (this.bitCount < count) {
            if (this.pos < this.input.length) this.bitBuffer |= this.input[this.pos] << this.bitCount;
            else if (this.pos >= this.input.length + 4) overrun();
            this.pos++;
            this.bitCount += 8;
        }
        const value = this.bitBuffer & ((1 << count) - 1);
        this.bitBuffer >>>= count;
        this.bitCount -= count;
        return value;
    }

    public decodeSymbol(table: HuffmanTable): number {
        while (this.bitCount < MAX_CODE_LENGTH) {
            if (this.pos < this.input.length) this.bitBuffer |= this.input[this.pos] << this.bitCount;
            else if (this.pos >= this.input.length + 4) overrun();
            this.pos++;
            this.bitCount += 8;
        }
        const entry = table.entries[this.bitBuffer & table.mask];
        const length = entry & 15;
        if (length === 0) throw new Error("inflate: invalid Huffman code");
        this.bitBuffer >>>= length;
        this.bitCount -= length;
        return entry >>> 4;
    }

    /** Drops to the byte boundary and returns whole bytes still in the bit buffer to the input. */
    public alignToByte(): void {
        this.pos -= this.bitCount >>> 3;
        this.bitBuffer = 0;
        this.bitCount = 0;
        if (this.pos > this.input.length) overrun();
    }

    public reserve(extra: number): void {
        if (this.outPos + extra > this.out.length) this.out = grow(this.out, this.outPos + extra);
    }
}

function inflateStoredBlock(stream: InflateStream): void {
    stream.alignToByte();
    const input = stream.input;
    const pos = stream.pos;
    if (pos + 4 > input.length) overrun();
    const length = input[pos] | (input[pos + 1] << 8);
    const inverted = input[pos + 2] | (input[pos + 3] << 8);
    if ((length ^ 0xffff) !== inverted) throw new Error("inflate: stored block length check failed");
    if (pos + 4 + length > input.length) overrun();
    stream.reserve(length);
    stream.out.set(input.subarray(pos + 4, pos + 4 + length), stream.outPos);
    stream.outPos += length;
    stream.pos = pos + 4 + length;
}

function readDynamicTables(stream: InflateStream): {literalLength: HuffmanTable, distance: HuffmanTable} {
    const literalCount = stream.bits(5) + 257;
    const distanceCount = stream.bits(5) + 1;
    const codeLengthCount = stream.bits(4) + 4;
    if (literalCount > MAX_LITERAL_LENGTH_CODES || distanceCount > MAX_DISTANCE_CODES) {
        throw new Error("inflate: too many length or distance codes");
    }
    codeLengthLengths.fill(0);
    for (let i = 0; i < codeLengthCount; i++) codeLengthLengths[CODE_LENGTH_ORDER[i]] = stream.bits(3);
    const codeLengthTable = buildTable(codeLengthLengths, 0, codeLengthLengths.length, codeLengthScratch);

    const total = literalCount + distanceCount;
    const codeLengths = new Uint8Array(total);
    let i = 0;
    while (i < total) {
        const symbol = stream.decodeSymbol(codeLengthTable);
        if (symbol < 16) {
            codeLengths[i++] = symbol;
            continue;
        }
        let repeat: number;
        let value = 0;
        if (symbol === 16) {
            if (i === 0) throw new Error("inflate: repeated code length with no previous length");
            value = codeLengths[i - 1];
            repeat = 3 + stream.bits(2);
        } else if (symbol === 17) {
            repeat = 3 + stream.bits(3);
        } else {
            repeat = 11 + stream.bits(7);
        }
        if (i + repeat > total) throw new Error("inflate: code lengths overflow the code count");
        codeLengths.fill(value, i, i + repeat);
        i += repeat;
    }
    if (codeLengths[END_OF_BLOCK] === 0) throw new Error("inflate: block has no end-of-block code");
    literalScratch ??= new Int32Array(1 << MAX_CODE_LENGTH);
    distanceScratch ??= new Int32Array(1 << MAX_CODE_LENGTH);
    return {
        literalLength: buildTable(codeLengths, 0, literalCount, literalScratch),
        distance: buildTable(codeLengths, literalCount, distanceCount, distanceScratch),
    };
}

/** The hot loop: stream state lives in locals for the whole block and is written back at its end. */
function inflateHuffmanBlock(stream: InflateStream, literalLength: HuffmanTable, distance: HuffmanTable): void {
    const input = stream.input;
    const inputLength = input.length;
    const overrunAt = inputLength + 4;
    const literalEntries = literalLength.entries;
    const literalMask = literalLength.mask;
    const distanceEntries = distance.entries;
    const distanceMask = distance.mask;
    let pos = stream.pos;
    let bitBuffer = stream.bitBuffer;
    let bitCount = stream.bitCount;
    let out = stream.out;
    let outPos = stream.outPos;

    for (;;) {
        if (outPos + MAX_MATCH > out.length) out = grow(out, outPos + MAX_MATCH);
        // 24+ bits: a literal/length code (at most 15) plus its extra bits (at most 5).
        while (bitCount < 24) {
            if (pos < inputLength) bitBuffer |= input[pos] << bitCount;
            else if (pos >= overrunAt) overrun();
            pos++;
            bitCount += 8;
        }
        let entry = literalEntries[bitBuffer & literalMask];
        let codeLength = entry & 15;
        if (codeLength === 0) throw new Error("inflate: invalid literal/length code");
        bitBuffer >>>= codeLength;
        bitCount -= codeLength;
        const symbol = entry >>> 4;
        if (symbol < END_OF_BLOCK) {
            out[outPos++] = symbol;
            continue;
        }
        if (symbol === END_OF_BLOCK) break;

        const lengthIndex = symbol - 257;
        if (lengthIndex >= 29) throw new Error("inflate: invalid length symbol");
        const lengthExtra = LENGTH_EXTRA[lengthIndex];
        const length = LENGTH_BASE[lengthIndex] + (bitBuffer & ((1 << lengthExtra) - 1));
        bitBuffer >>>= lengthExtra;
        bitCount -= lengthExtra;

        while (bitCount < 24) {
            if (pos < inputLength) bitBuffer |= input[pos] << bitCount;
            else if (pos >= overrunAt) overrun();
            pos++;
            bitCount += 8;
        }
        entry = distanceEntries[bitBuffer & distanceMask];
        codeLength = entry & 15;
        if (codeLength === 0) throw new Error("inflate: invalid distance code");
        bitBuffer >>>= codeLength;
        bitCount -= codeLength;
        const distanceSymbol = entry >>> 4;
        if (distanceSymbol >= MAX_DISTANCE_CODES) throw new Error("inflate: invalid distance symbol");
        const distanceExtra = DISTANCE_EXTRA[distanceSymbol];
        while (bitCount < distanceExtra) {
            if (pos < inputLength) bitBuffer |= input[pos] << bitCount;
            else if (pos >= overrunAt) overrun();
            pos++;
            bitCount += 8;
        }
        const back = DISTANCE_BASE[distanceSymbol] + (bitBuffer & ((1 << distanceExtra) - 1));
        bitBuffer >>>= distanceExtra;
        bitCount -= distanceExtra;
        if (back > outPos) throw new Error("inflate: distance too far back");

        let from = outPos - back;
        if (back === 1) {
            out.fill(out[from], outPos, outPos + length);
            outPos += length;
        } else if (length >= BYTE_COPY_LIMIT && back >= length) {
            out.copyWithin(outPos, from, from + length);
            outPos += length;
        } else {
            const end = outPos + length;
            while (outPos < end) out[outPos++] = out[from++];
        }
    }

    stream.pos = pos;
    stream.bitBuffer = bitBuffer;
    stream.bitCount = bitCount;
    stream.out = out;
    stream.outPos = outPos;
}

/** Decompresses a zlib stream; throws on a malformed stream, a preset dictionary, or an Adler-32 mismatch. */
export function inflate(bytes: Uint8Array): Uint8Array {
    if (bytes.length < 6) throw new Error("inflate: stream too short for a zlib header and checksum");
    const cmf = bytes[0];
    const flg = bytes[1];
    if ((cmf & 0x0f) !== 8) throw new Error(`inflate: unsupported compression method ${cmf & 0x0f}`);
    if ((cmf >>> 4) > 7) throw new Error("inflate: invalid window size");
    if (((cmf << 8) | flg) % 31 !== 0) throw new Error("inflate: corrupt zlib header check");
    if ((flg & 0x20) !== 0) throw new Error("inflate: preset dictionaries are not supported");

    const stream = new InflateStream(bytes);
    let finalBlock = false;
    while (!finalBlock) {
        finalBlock = stream.bits(1) === 1;
        const type = stream.bits(2);
        if (type === 0) {
            inflateStoredBlock(stream);
        } else if (type === 1) {
            const fixed = fixedHuffmanTables();
            inflateHuffmanBlock(stream, fixed.literalLength, fixed.distance);
        } else if (type === 2) {
            const dynamic = readDynamicTables(stream);
            inflateHuffmanBlock(stream, dynamic.literalLength, dynamic.distance);
        } else {
            throw new Error("inflate: invalid block type 3");
        }
    }

    // The Adler-32 trailer starts at the next byte boundary.
    stream.alignToByte();
    const input = stream.input;
    const pos = stream.pos;
    if (pos + 4 > input.length) throw new Error("inflate: missing Adler-32 checksum");
    const expected = ((input[pos] << 24) | (input[pos + 1] << 16) | (input[pos + 2] << 8) | input[pos + 3]) >>> 0;
    if (adler32(stream.out, 0, stream.outPos) !== expected) throw new Error("inflate: Adler-32 checksum mismatch");
    return stream.out.subarray(0, stream.outPos);
}
