import {adler32, DISTANCE_BASE, DISTANCE_EXTRA, LENGTH_BASE, LENGTH_EXTRA} from "./inflate";

const ZLIB_CMF_DEFLATE_32K_WINDOW = 0x78;
const ZLIB_FLG_FASTEST = 0x01;
const ZLIB_FLG_DEFAULT_LEVEL = 0x9C;
const ZLIB_HEADER_BYTES = 2;
const ADLER32_BYTES = 4;
const BITS_PER_BYTE = 8;
const BYTE_MASK = 0xFF;

const FINAL_BLOCK = 1;
const NOT_FINAL_BLOCK = 0;
const BLOCK_FINAL_BITS = 1;
const BLOCK_TYPE_BITS = 2;
const BLOCK_FIXED = 1;

const MAX_STORED_BLOCK_BYTES = 0xFFFF;
const STORED_BLOCK_HEADER_BYTES = 5;
const STORED_LENGTH_OFFSET = 1;
const STORED_LENGTH_COMPLEMENT_OFFSET = 3;
const LITTLE_ENDIAN = true;

const END_OF_BLOCK = 256;
const FIRST_LENGTH_SYMBOL = 257;
const LITERAL_LENGTH_SYMBOL_COUNT = 288;
const DISTANCE_SYMBOL_COUNT = 30;
const FIXED_LITERAL_LOW_END = 144;
const FIXED_LITERAL_HIGH_END = 256;
const FIXED_LENGTH_LOW_END = 280;
const FIXED_LITERAL_LOW_BITS = 8;
const FIXED_LITERAL_HIGH_BITS = 9;
const FIXED_LENGTH_LOW_BITS = 7;
const FIXED_LENGTH_HIGH_BITS = 8;
const FIXED_LITERAL_LOW_FIRST_CODE = 0x30;
const FIXED_LITERAL_HIGH_FIRST_CODE = 0x190;
const FIXED_LENGTH_LOW_FIRST_CODE = 0;
const FIXED_LENGTH_HIGH_FIRST_CODE = 0xC0;
const FIXED_DISTANCE_BITS = 5;
const WORST_FIXED_BITS_PER_BYTE = FIXED_LITERAL_HIGH_BITS;
const FIXED_BLOCK_OVERHEAD_BYTES = 4;

const MIN_MATCH = 3;
const MAX_MATCH = 258;
const WINDOW_SIZE = 32768;
const WINDOW_MASK = 0x7FFF;
const HASH_TABLE_SIZE = 32768;
const HASH_SHIFT = 17;
const HASH_MULTIPLIER = 0x9E3779B1;
const SECOND_BYTE_SHIFT = 8;
const FIRST_BYTE_SHIFT = 16;
const MAX_CHAIN_STEPS = 128;
const NO_POSITION = -1;

interface HuffmanCode {
    readonly bits: number;
    readonly length: number;
}

interface FixedTables {
    readonly literalCodes: readonly HuffmanCode[];
    readonly distanceCodes: readonly HuffmanCode[];
    readonly lengthSymbolIndex: Uint8Array;
    readonly distanceSymbolIndex: Uint8Array;
}

function fixedTables(): FixedTables {
    return {
        literalCodes: fixedLiteralCodes(),
        distanceCodes: fixedDistanceCodes(),
        lengthSymbolIndex: lengthSymbolIndex(),
        distanceSymbolIndex: distanceSymbolIndex(),
    };
}

export function deflate(bytes: Uint8Array): Uint8Array {
    const fixed = fixedBlockStream(bytes);
    return fixed.length <= storedStreamLength(bytes.length) ? fixed : deflateStored(bytes);
}

export function deflateStored(bytes: Uint8Array): Uint8Array {
    const output = new Uint8Array(storedStreamLength(bytes.length));
    const view = new DataView(output.buffer);
    output[0] = ZLIB_CMF_DEFLATE_32K_WINDOW;
    output[1] = ZLIB_FLG_FASTEST;
    let offset = ZLIB_HEADER_BYTES;
    const blockCount = storedBlockCount(bytes.length);
    for (let block = 0; block < blockCount; block++) {
        const start = block * MAX_STORED_BLOCK_BYTES;
        const length = Math.min(MAX_STORED_BLOCK_BYTES, bytes.length - start);
        output[offset] = block === blockCount - 1 ? FINAL_BLOCK : NOT_FINAL_BLOCK;
        view.setUint16(offset + STORED_LENGTH_OFFSET, length, LITTLE_ENDIAN);
        view.setUint16(offset + STORED_LENGTH_COMPLEMENT_OFFSET, ~length & MAX_STORED_BLOCK_BYTES, LITTLE_ENDIAN);
        output.set(bytes.subarray(start, start + length), offset + STORED_BLOCK_HEADER_BYTES);
        offset += STORED_BLOCK_HEADER_BYTES + length;
    }
    view.setUint32(offset, adler32(bytes));
    return output;
}

function storedBlockCount(byteLength: number): number {
    return Math.max(1, Math.ceil(byteLength / MAX_STORED_BLOCK_BYTES));
}

function storedStreamLength(byteLength: number): number {
    return ZLIB_HEADER_BYTES + storedBlockCount(byteLength) * STORED_BLOCK_HEADER_BYTES + byteLength + ADLER32_BYTES;
}

function fixedBlockStream(bytes: Uint8Array): Uint8Array {
    const capacity = ZLIB_HEADER_BYTES + Math.ceil(bytes.length * WORST_FIXED_BITS_PER_BYTE / BITS_PER_BYTE) + FIXED_BLOCK_OVERHEAD_BYTES + ADLER32_BYTES;
    const writer = new BitWriter(capacity);
    writer.writeBits(ZLIB_CMF_DEFLATE_32K_WINDOW, BITS_PER_BYTE);
    writer.writeBits(ZLIB_FLG_DEFAULT_LEVEL, BITS_PER_BYTE);
    writer.writeBits(FINAL_BLOCK, BLOCK_FINAL_BITS);
    writer.writeBits(BLOCK_FIXED, BLOCK_TYPE_BITS);
    const tables = fixedTables();
    writeMatchedSymbols(writer, bytes, tables);
    writer.writeCode(tables.literalCodes[END_OF_BLOCK]);
    writer.alignToByte();
    const checksum = adler32(bytes);
    for (let shift = (ADLER32_BYTES - 1) * BITS_PER_BYTE; shift >= 0; shift -= BITS_PER_BYTE) writer.writeBits((checksum >>> shift) & BYTE_MASK, BITS_PER_BYTE);
    return writer.bytes();
}

function hashAt(bytes: Uint8Array, position: number): number {
    const key = (bytes[position] << FIRST_BYTE_SHIFT) | (bytes[position + 1] << SECOND_BYTE_SHIFT) | bytes[position + 2];
    return Math.imul(key, HASH_MULTIPLIER) >>> HASH_SHIFT;
}

function writeMatchedSymbols(writer: BitWriter, bytes: Uint8Array, tables: FixedTables): void {
    const head = new Int32Array(HASH_TABLE_SIZE).fill(NO_POSITION);
    const previous = new Int32Array(WINDOW_SIZE);
    const insert = (position: number): void => {
        if (position + MIN_MATCH > bytes.length) return;
        const hash = hashAt(bytes, position);
        previous[position & WINDOW_MASK] = head[hash];
        head[hash] = position;
    };
    let position = 0;
    while (position < bytes.length) {
        const maxLength = Math.min(MAX_MATCH, bytes.length - position);
        let bestLength = 0;
        let bestDistance = 0;
        if (maxLength >= MIN_MATCH) {
            let candidate = head[hashAt(bytes, position)];
            for (let steps = 0; steps < MAX_CHAIN_STEPS && candidate !== NO_POSITION && position - candidate <= WINDOW_SIZE; steps++) {
                if (bytes[candidate + bestLength] === bytes[position + bestLength]) {
                    let length = 0;
                    while (length < maxLength && bytes[candidate + length] === bytes[position + length]) length++;
                    if (length > bestLength) {
                        bestLength = length;
                        bestDistance = position - candidate;
                        if (length === maxLength) break;
                    }
                }
                candidate = previous[candidate & WINDOW_MASK];
            }
        }
        if (bestLength >= MIN_MATCH) {
            writeMatch(writer, tables, bestLength, bestDistance);
            for (let offset = 0; offset < bestLength; offset++) insert(position + offset);
            position += bestLength;
        } else {
            writer.writeCode(tables.literalCodes[bytes[position]]);
            insert(position);
            position++;
        }
    }
}

function writeMatch(writer: BitWriter, tables: FixedTables, length: number, distance: number): void {
    const lengthIndex = tables.lengthSymbolIndex[length];
    writer.writeCode(tables.literalCodes[FIRST_LENGTH_SYMBOL + lengthIndex]);
    writer.writeBits(length - LENGTH_BASE[lengthIndex], LENGTH_EXTRA[lengthIndex]);
    const distanceIndex = tables.distanceSymbolIndex[distance];
    writer.writeCode(tables.distanceCodes[distanceIndex]);
    writer.writeBits(distance - DISTANCE_BASE[distanceIndex], DISTANCE_EXTRA[distanceIndex]);
}

function reversedBits(code: number, length: number): number {
    let reversed = 0;
    for (let bit = 0; bit < length; bit++) reversed |= ((code >> bit) & 1) << (length - 1 - bit);
    return reversed;
}

function fixedLiteralCodes(): HuffmanCode[] {
    const codes: HuffmanCode[] = [];
    for (let symbol = 0; symbol < LITERAL_LENGTH_SYMBOL_COUNT; symbol++) {
        const [code, length] = symbol < FIXED_LITERAL_LOW_END ? [FIXED_LITERAL_LOW_FIRST_CODE + symbol, FIXED_LITERAL_LOW_BITS]
            : symbol < FIXED_LITERAL_HIGH_END ? [FIXED_LITERAL_HIGH_FIRST_CODE + symbol - FIXED_LITERAL_LOW_END, FIXED_LITERAL_HIGH_BITS]
                : symbol < FIXED_LENGTH_LOW_END ? [FIXED_LENGTH_LOW_FIRST_CODE + symbol - FIXED_LITERAL_HIGH_END, FIXED_LENGTH_LOW_BITS]
                    : [FIXED_LENGTH_HIGH_FIRST_CODE + symbol - FIXED_LENGTH_LOW_END, FIXED_LENGTH_HIGH_BITS];
        codes.push({bits: reversedBits(code, length), length});
    }
    return codes;
}

function fixedDistanceCodes(): HuffmanCode[] {
    const codes: HuffmanCode[] = [];
    for (let symbol = 0; symbol < DISTANCE_SYMBOL_COUNT; symbol++) codes.push({bits: reversedBits(symbol, FIXED_DISTANCE_BITS), length: FIXED_DISTANCE_BITS});
    return codes;
}

function symbolIndex(bases: readonly number[], extras: readonly number[], limit: number): Uint8Array {
    const index = new Uint8Array(limit + 1);
    for (let symbol = 0; symbol < bases.length; symbol++) {
        const end = Math.min(limit, bases[symbol] + (1 << extras[symbol]) - 1);
        index.fill(symbol, bases[symbol], end + 1);
    }
    return index;
}

function lengthSymbolIndex(): Uint8Array {
    return symbolIndex(LENGTH_BASE, LENGTH_EXTRA, MAX_MATCH);
}

function distanceSymbolIndex(): Uint8Array {
    return symbolIndex(DISTANCE_BASE, DISTANCE_EXTRA, WINDOW_SIZE);
}

class BitWriter {
    private readonly output: Uint8Array;
    private length = 0;
    private pending = 0;
    private pendingBits = 0;

    public constructor(capacity: number) {
        this.output = new Uint8Array(capacity);
    }

    public writeBits(value: number, count: number): void {
        this.pending |= value << this.pendingBits;
        this.pendingBits += count;
        while (this.pendingBits >= BITS_PER_BYTE) {
            this.output[this.length++] = this.pending & BYTE_MASK;
            this.pending >>>= BITS_PER_BYTE;
            this.pendingBits -= BITS_PER_BYTE;
        }
    }

    public writeCode(code: HuffmanCode): void {
        this.writeBits(code.bits, code.length);
    }

    public alignToByte(): void {
        if (this.pendingBits > 0) this.writeBits(0, BITS_PER_BYTE - this.pendingBits);
    }

    public bytes(): Uint8Array {
        return this.output.slice(0, this.length);
    }
}
