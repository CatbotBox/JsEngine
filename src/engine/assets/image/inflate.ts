const KIND_LITERAL = 0;
const KIND_BASE = 1 << 8;
const KIND_END = 2 << 8;
const KIND_LINK = 3 << 8;
const KIND_INVALID = 4 << 8;
const KIND_MASK = 7 << 8;

const ENTRY_CONSUMED_BITS_MASK = 15;
const ENTRY_EXTRA_BITS_SHIFT = 4;
const ENTRY_EXTRA_BITS_MASK = 15;
const ENTRY_VALUE_SHIFT = 16;

const ALLOW_SINGLE_CODE = true;
const REQUIRE_COMPLETE_CODE = false;

const BITS_PER_BYTE = 8;
const BYTE_VALUES = 256;
const REFILL_BITS = 16;
const REFILL_BYTES = 2;

const MAX_CODE_LENGTH = 15;
const LITERAL_PRIMARY_BITS = 10;
const DISTANCE_PRIMARY_BITS = 8;
const CODE_LENGTH_PRIMARY_BITS = 7;

const LITERAL_LENGTH_SYMBOL_COUNT = 288;
const DISTANCE_SYMBOL_COUNT = 32;
const CODE_LENGTH_SYMBOL_COUNT = 19;
const MAX_LITERAL_LENGTH_CODES = 286;
const MAX_DISTANCE_CODES = 30;
const END_OF_BLOCK = 256;
const FIRST_LENGTH_SYMBOL = 257;

const BLOCK_FINAL_BITS = 1;
const BLOCK_TYPE_BITS = 2;
const STORED_HEADER_BYTES = 4;
const STORED_LENGTH_COMPLEMENT_MASK = 0xFFFF;

const LITERAL_LENGTH_COUNT_BITS = 5;
const MIN_LITERAL_LENGTH_CODES = 257;
const DISTANCE_COUNT_BITS = 5;
const MIN_DISTANCE_CODES = 1;
const CODE_LENGTH_COUNT_BITS = 4;
const MIN_CODE_LENGTH_CODES = 4;
const CODE_LENGTH_CODE_BITS = 3;
const REPEAT_PREVIOUS_SYMBOL = 16;
const REPEAT_ZERO_SHORT_SYMBOL = 17;
const REPEAT_PREVIOUS_MIN = 3;
const REPEAT_PREVIOUS_EXTRA_BITS = 2;
const REPEAT_ZERO_SHORT_MIN = 3;
const REPEAT_ZERO_SHORT_EXTRA_BITS = 3;
const REPEAT_ZERO_LONG_MIN = 11;
const REPEAT_ZERO_LONG_EXTRA_BITS = 7;

const FIXED_LITERAL_LOW_END = 144;
const FIXED_LITERAL_HIGH_END = 256;
const FIXED_LENGTH_LOW_END = 280;
const FIXED_LITERAL_LOW_BITS = 8;
const FIXED_LITERAL_HIGH_BITS = 9;
const FIXED_LENGTH_LOW_BITS = 7;
const FIXED_LENGTH_HIGH_BITS = 8;
const FIXED_DISTANCE_BITS = 5;

const LITERAL_TABLE_SIZE = (1 << LITERAL_PRIMARY_BITS) + LITERAL_LENGTH_SYMBOL_COUNT * (1 << (MAX_CODE_LENGTH - LITERAL_PRIMARY_BITS));
const DISTANCE_TABLE_SIZE = (1 << DISTANCE_PRIMARY_BITS) + DISTANCE_SYMBOL_COUNT * (1 << (MAX_CODE_LENGTH - DISTANCE_PRIMARY_BITS));
const CODE_LENGTH_TABLE_SIZE = 1 << CODE_LENGTH_PRIMARY_BITS;

const BLOCK_STORED = 0;
const BLOCK_FIXED = 1;
const BLOCK_DYNAMIC = 2;

const ZLIB_HEADER_BYTES = 2;
const ZLIB_HEADER_CHECK_MODULUS = 31;
const ZLIB_METHOD_DEFLATE = 8;
const ZLIB_MAX_WINDOW_BITS_LOG = 7;
const ZLIB_FLAG_DICTIONARY = 0x20;
const ADLER_MODULUS = 65521;
const ADLER_CHUNK = 3000;
const ADLER_UNROLL = 8;
const ADLER32_BYTES = 4;

const MIN_OUTPUT_CAPACITY = 1 << 15;
const INITIAL_EXPANSION_RATIO = 4;
const BULK_COPY_MIN_LENGTH = 32;

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
    8193, 12289, 16385, 24577,
];
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const LITERAL_LENGTH_SYMBOLS = literalLengthSymbols();
const DISTANCE_SYMBOLS = distanceSymbols();
const CODE_LENGTH_SYMBOLS = codeLengthSymbols();

export function inflate(bytes: Uint8Array): Uint8Array {
    if (bytes.length < ZLIB_HEADER_BYTES) throw new Error("inflate: zlib stream is truncated (missing header)");
    const cmf = bytes[0];
    const flg = bytes[1];
    if ((cmf * BYTE_VALUES + flg) % ZLIB_HEADER_CHECK_MODULUS !== 0) throw new Error("inflate: bad zlib header checksum");
    if ((cmf & 15) !== ZLIB_METHOD_DEFLATE) throw new Error(`inflate: unsupported zlib compression method ${cmf & 15}`);
    if (cmf >> 4 > ZLIB_MAX_WINDOW_BITS_LOG) throw new Error(`inflate: invalid zlib window size ${cmf >> 4}`);
    if (flg & ZLIB_FLAG_DICTIONARY) throw new Error("inflate: zlib preset dictionaries (FDICT) are not supported");

    const inflater = new Inflater(bytes, ZLIB_HEADER_BYTES);
    inflater.run();
    const trailer = inflater.alignToByte();
    if (trailer + ADLER32_BYTES > bytes.length) throw new Error("inflate: zlib stream is truncated (missing Adler-32)");
    const expected = ((bytes[trailer] << 24) | (bytes[trailer + 1] << 16) | (bytes[trailer + 2] << 8) | bytes[trailer + 3]) >>> 0;
    const output = inflater.output();
    if (adler32(output) !== expected) throw new Error("inflate: Adler-32 mismatch (corrupt data)");
    return output;
}

export function inflateRaw(bytes: Uint8Array): Uint8Array {
    const inflater = new Inflater(bytes, 0);
    inflater.run();
    return inflater.output();
}

function adler32(data: Uint8Array): number {
    let a = 1, b = 0, i = 0;
    const end = data.length;
    while (i < end) {
        const chunkEnd = Math.min(i + ADLER_CHUNK, end);
        const unrolledEnd = chunkEnd - (ADLER_UNROLL - 1);
        for (; i < unrolledEnd; i += ADLER_UNROLL) {
            a += data[i]; b += a;
            a += data[i + 1]; b += a;
            a += data[i + 2]; b += a;
            a += data[i + 3]; b += a;
            a += data[i + 4]; b += a;
            a += data[i + 5]; b += a;
            a += data[i + 6]; b += a;
            a += data[i + 7]; b += a;
        }
        for (; i < chunkEnd; i++) {
            a += data[i];
            b += a;
        }
        a %= ADLER_MODULUS;
        b %= ADLER_MODULUS;
    }
    return ((b << 16) | a) >>> 0;
}

let fixedLiteralTable: Int32Array | undefined;
let fixedDistanceTable: Int32Array | undefined;

function fixedTables(): [Int32Array, Int32Array] {
    if (fixedLiteralTable === undefined || fixedDistanceTable === undefined) {
        const lengths = new Uint8Array(LITERAL_LENGTH_SYMBOL_COUNT + DISTANCE_SYMBOL_COUNT);
        lengths.fill(FIXED_LITERAL_LOW_BITS, 0, FIXED_LITERAL_LOW_END);
        lengths.fill(FIXED_LITERAL_HIGH_BITS, FIXED_LITERAL_LOW_END, FIXED_LITERAL_HIGH_END);
        lengths.fill(FIXED_LENGTH_LOW_BITS, FIXED_LITERAL_HIGH_END, FIXED_LENGTH_LOW_END);
        lengths.fill(FIXED_LENGTH_HIGH_BITS, FIXED_LENGTH_LOW_END, LITERAL_LENGTH_SYMBOL_COUNT);
        lengths.fill(FIXED_DISTANCE_BITS, LITERAL_LENGTH_SYMBOL_COUNT);
        const literal = new Int32Array(LITERAL_TABLE_SIZE);
        const distance = new Int32Array(DISTANCE_TABLE_SIZE);
        buildHuffmanTable(lengths, 0, LITERAL_LENGTH_SYMBOL_COUNT, LITERAL_LENGTH_SYMBOLS, LITERAL_PRIMARY_BITS, literal, ALLOW_SINGLE_CODE, "literal/length");
        buildHuffmanTable(lengths, LITERAL_LENGTH_SYMBOL_COUNT, DISTANCE_SYMBOL_COUNT, DISTANCE_SYMBOLS, DISTANCE_PRIMARY_BITS, distance, ALLOW_SINGLE_CODE, "distance");
        fixedLiteralTable = literal;
        fixedDistanceTable = distance;
    }
    return [fixedLiteralTable, fixedDistanceTable];
}

class Inflater {
    private pos: number;
    private bitBuffer = 0;
    private bitCount = 0;
    private out: Uint8Array;
    private outPos = 0;
    private readonly inputEnd: number;
    private dynamicLiteralTable: Int32Array | undefined;
    private dynamicDistanceTable: Int32Array | undefined;

    public constructor(private readonly input: Uint8Array, start: number) {
        this.pos = start;
        this.inputEnd = input.length;
        this.out = new Uint8Array(Math.max(MIN_OUTPUT_CAPACITY, input.length * INITIAL_EXPANSION_RATIO));
    }

    public run(): void {
        let final = 0;
        while (final === 0) {
            final = this.readBits(BLOCK_FINAL_BITS);
            const type = this.readBits(BLOCK_TYPE_BITS);
            if (type === BLOCK_STORED) {
                this.copyStoredBlock();
            } else if (type === BLOCK_FIXED) {
                const [literal, distance] = fixedTables();
                this.decodeHuffmanBlock(literal, distance);
            } else if (type === BLOCK_DYNAMIC) {
                this.readDynamicTables();
                this.decodeHuffmanBlock(this.dynamicLiteralTable!, this.dynamicDistanceTable!);
            } else {
                throw new Error("inflate: invalid block type 3");
            }
            this.checkOverrun();
        }
    }

    public output(): Uint8Array {
        return this.out.subarray(0, this.outPos);
    }

    public alignToByte(): number {
        const partial = this.bitCount & 7;
        this.bitBuffer >>>= partial;
        this.bitCount -= partial;
        this.pos -= this.bitCount >> 3;
        this.bitBuffer = 0;
        this.bitCount = 0;
        return this.pos;
    }

    private readBits(count: number): number {
        while (this.bitCount < count) {
            if (this.pos < this.inputEnd) this.bitBuffer |= this.input[this.pos] << this.bitCount;
            this.pos++;
            this.bitCount += BITS_PER_BYTE;
        }
        const value = this.bitBuffer & ((1 << count) - 1);
        this.bitBuffer >>>= count;
        this.bitCount -= count;
        this.checkOverrun();
        return value;
    }

    private checkOverrun(): void {
        if (this.pos > this.inputEnd && (this.pos - this.inputEnd) * BITS_PER_BYTE > this.bitCount) {
            throw new Error("inflate: DEFLATE stream is truncated");
        }
    }

    private failAt(pos: number, bitCount: number, message: string): never {
        this.pos = pos;
        this.bitCount = bitCount;
        this.checkOverrun();
        throw new Error(`inflate: ${message}`);
    }

    private refillNearEnd(pos: number, bitBuffer: number, bitCount: number): void {
        while (bitCount < REFILL_BITS) {
            if (pos < this.inputEnd) {
                bitBuffer |= this.input[pos] << bitCount;
            } else if ((pos - this.inputEnd) * BITS_PER_BYTE > bitCount) {
                throw new Error("inflate: DEFLATE stream is truncated");
            }
            pos++;
            bitCount += BITS_PER_BYTE;
        }
        this.pos = pos;
        this.bitBuffer = bitBuffer;
        this.bitCount = bitCount;
    }

    private ensureCapacity(minimumLength: number): void {
        if (minimumLength <= this.out.length) return;
        const grown = new Uint8Array(Math.max(minimumLength, this.out.length * 2));
        grown.set(this.out.subarray(0, this.outPos));
        this.out = grown;
    }

    private copyStoredBlock(): void {
        const start = this.alignToByte();
        const input = this.input;
        if (start + STORED_HEADER_BYTES > this.inputEnd) throw new Error("inflate: DEFLATE stream is truncated (stored block header)");
        const length = input[start] | (input[start + 1] << 8);
        const complement = input[start + 2] | (input[start + 3] << 8);
        if ((length ^ STORED_LENGTH_COMPLEMENT_MASK) !== complement) throw new Error("inflate: stored block length does not match its complement");
        const dataStart = start + STORED_HEADER_BYTES;
        if (dataStart + length > this.inputEnd) throw new Error("inflate: DEFLATE stream is truncated (stored block data)");
        this.ensureCapacity(this.outPos + length);
        this.out.set(input.subarray(dataStart, dataStart + length), this.outPos);
        this.outPos += length;
        this.pos = dataStart + length;
    }

    private readDynamicTables(): void {
        const literalCount = this.readBits(LITERAL_LENGTH_COUNT_BITS) + MIN_LITERAL_LENGTH_CODES;
        const distanceCount = this.readBits(DISTANCE_COUNT_BITS) + MIN_DISTANCE_CODES;
        const codeLengthCount = this.readBits(CODE_LENGTH_COUNT_BITS) + MIN_CODE_LENGTH_CODES;
        if (literalCount > MAX_LITERAL_LENGTH_CODES) throw new Error(`inflate: too many literal/length codes (${literalCount})`);
        if (distanceCount > MAX_DISTANCE_CODES) throw new Error(`inflate: too many distance codes (${distanceCount})`);

        const codeLengthLengths = new Uint8Array(CODE_LENGTH_SYMBOL_COUNT);
        for (let i = 0; i < codeLengthCount; i++) codeLengthLengths[CODE_LENGTH_ORDER[i]] = this.readBits(CODE_LENGTH_CODE_BITS);
        const codeLengthTable = new Int32Array(CODE_LENGTH_TABLE_SIZE);
        buildHuffmanTable(codeLengthLengths, 0, CODE_LENGTH_SYMBOL_COUNT, CODE_LENGTH_SYMBOLS, CODE_LENGTH_PRIMARY_BITS, codeLengthTable, REQUIRE_COMPLETE_CODE, "code length");

        const total = literalCount + distanceCount;
        const lengths = new Uint8Array(total);
        let i = 0;
        while (i < total) {
            while (this.bitCount < CODE_LENGTH_PRIMARY_BITS) this.pullByte();
            const entry = codeLengthTable[this.bitBuffer & (CODE_LENGTH_TABLE_SIZE - 1)];
            if ((entry & KIND_MASK) === KIND_INVALID) throw new Error("inflate: invalid code length code");
            const used = entry & ENTRY_CONSUMED_BITS_MASK;
            this.bitBuffer >>>= used;
            this.bitCount -= used;
            this.checkOverrun();
            const symbol = entry >>> ENTRY_VALUE_SHIFT;
            if (symbol < REPEAT_PREVIOUS_SYMBOL) {
                lengths[i++] = symbol;
                continue;
            }
            let repeat: number;
            let value = 0;
            if (symbol === REPEAT_PREVIOUS_SYMBOL) {
                if (i === 0) throw new Error("inflate: code length repeat with no previous length");
                value = lengths[i - 1];
                repeat = REPEAT_PREVIOUS_MIN + this.readBits(REPEAT_PREVIOUS_EXTRA_BITS);
            } else if (symbol === REPEAT_ZERO_SHORT_SYMBOL) {
                repeat = REPEAT_ZERO_SHORT_MIN + this.readBits(REPEAT_ZERO_SHORT_EXTRA_BITS);
            } else {
                repeat = REPEAT_ZERO_LONG_MIN + this.readBits(REPEAT_ZERO_LONG_EXTRA_BITS);
            }
            if (i + repeat > total) throw new Error("inflate: code length repeat runs past the end of the code lengths");
            lengths.fill(value, i, i + repeat);
            i += repeat;
        }
        if (lengths[END_OF_BLOCK] === 0) throw new Error("inflate: dynamic block has no end-of-block code");

        this.dynamicLiteralTable ??= new Int32Array(LITERAL_TABLE_SIZE);
        this.dynamicDistanceTable ??= new Int32Array(DISTANCE_TABLE_SIZE);
        buildHuffmanTable(lengths, 0, literalCount, LITERAL_LENGTH_SYMBOLS, LITERAL_PRIMARY_BITS, this.dynamicLiteralTable, ALLOW_SINGLE_CODE, "literal/length");
        buildHuffmanTable(lengths, literalCount, distanceCount, DISTANCE_SYMBOLS, DISTANCE_PRIMARY_BITS, this.dynamicDistanceTable, ALLOW_SINGLE_CODE, "distance");
    }

    private pullByte(): void {
        if (this.pos < this.inputEnd) this.bitBuffer |= this.input[this.pos] << this.bitCount;
        this.pos++;
        this.bitCount += BITS_PER_BYTE;
    }

    private decodeHuffmanBlock(literalTable: Int32Array, distanceTable: Int32Array): void {
        const input = this.input;
        const inputEnd = this.inputEnd;
        const literalMask = (1 << LITERAL_PRIMARY_BITS) - 1;
        const distanceMask = (1 << DISTANCE_PRIMARY_BITS) - 1;
        let pos = this.pos;
        let bitBuffer = this.bitBuffer;
        let bitCount = this.bitCount;
        let out = this.out;
        let outPos = this.outPos;
        let capacity = out.length;

        for (;;) {
            if (bitCount < REFILL_BITS) {
                if (pos + 1 < inputEnd) {
                    bitBuffer |= (input[pos] | (input[pos + 1] << BITS_PER_BYTE)) << bitCount;
                    pos += REFILL_BYTES;
                    bitCount += REFILL_BITS;
                } else {
                    this.refillNearEnd(pos, bitBuffer, bitCount);
                    pos = this.pos;
                    bitBuffer = this.bitBuffer;
                    bitCount = this.bitCount;
                }
            }
            let entry = literalTable[bitBuffer & literalMask];
            if ((entry & KIND_MASK) === KIND_LINK) {
                bitBuffer >>>= LITERAL_PRIMARY_BITS;
                bitCount -= LITERAL_PRIMARY_BITS;
                entry = literalTable[(entry >>> ENTRY_VALUE_SHIFT) + (bitBuffer & ((1 << ((entry >> ENTRY_EXTRA_BITS_SHIFT) & ENTRY_EXTRA_BITS_MASK)) - 1))];
            }
            const literalBits = entry & ENTRY_CONSUMED_BITS_MASK;
            bitBuffer >>>= literalBits;
            bitCount -= literalBits;
            const kind = entry & KIND_MASK;

            if (kind === KIND_LITERAL) {
                if (outPos === capacity) {
                    this.outPos = outPos;
                    this.ensureCapacity(outPos + 1);
                    out = this.out;
                    capacity = out.length;
                }
                out[outPos++] = entry >>> ENTRY_VALUE_SHIFT;
                continue;
            }
            if (kind !== KIND_BASE) {
                if (kind === KIND_END) break;
                this.failAt(pos, bitCount, "invalid literal/length code");
            }

            let length = entry >>> ENTRY_VALUE_SHIFT;
            const lengthExtra = (entry >> ENTRY_EXTRA_BITS_SHIFT) & ENTRY_EXTRA_BITS_MASK;
            if (lengthExtra !== 0) {
                if (bitCount < lengthExtra) {
                    if (pos + 1 < inputEnd) {
                        bitBuffer |= (input[pos] | (input[pos + 1] << BITS_PER_BYTE)) << bitCount;
                        pos += REFILL_BYTES;
                        bitCount += REFILL_BITS;
                    } else {
                        this.refillNearEnd(pos, bitBuffer, bitCount);
                        pos = this.pos;
                        bitBuffer = this.bitBuffer;
                        bitCount = this.bitCount;
                    }
                }
                length += bitBuffer & ((1 << lengthExtra) - 1);
                bitBuffer >>>= lengthExtra;
                bitCount -= lengthExtra;
            }

            if (bitCount < REFILL_BITS) {
                if (pos + 1 < inputEnd) {
                    bitBuffer |= (input[pos] | (input[pos + 1] << BITS_PER_BYTE)) << bitCount;
                    pos += REFILL_BYTES;
                    bitCount += REFILL_BITS;
                } else {
                    this.refillNearEnd(pos, bitBuffer, bitCount);
                    pos = this.pos;
                    bitBuffer = this.bitBuffer;
                    bitCount = this.bitCount;
                }
            }
            entry = distanceTable[bitBuffer & distanceMask];
            if ((entry & KIND_MASK) === KIND_LINK) {
                bitBuffer >>>= DISTANCE_PRIMARY_BITS;
                bitCount -= DISTANCE_PRIMARY_BITS;
                entry = distanceTable[(entry >>> ENTRY_VALUE_SHIFT) + (bitBuffer & ((1 << ((entry >> ENTRY_EXTRA_BITS_SHIFT) & ENTRY_EXTRA_BITS_MASK)) - 1))];
            }
            if ((entry & KIND_MASK) !== KIND_BASE) this.failAt(pos, bitCount, "invalid distance code");
            const distanceBits = entry & ENTRY_CONSUMED_BITS_MASK;
            bitBuffer >>>= distanceBits;
            bitCount -= distanceBits;

            let distance = entry >>> ENTRY_VALUE_SHIFT;
            const distanceExtra = (entry >> ENTRY_EXTRA_BITS_SHIFT) & ENTRY_EXTRA_BITS_MASK;
            if (distanceExtra !== 0) {
                if (bitCount < distanceExtra) {
                    if (pos + 1 < inputEnd) {
                        bitBuffer |= (input[pos] | (input[pos + 1] << BITS_PER_BYTE)) << bitCount;
                        pos += REFILL_BYTES;
                        bitCount += REFILL_BITS;
                    } else {
                        this.refillNearEnd(pos, bitBuffer, bitCount);
                        pos = this.pos;
                        bitBuffer = this.bitBuffer;
                        bitCount = this.bitCount;
                    }
                }
                distance += bitBuffer & ((1 << distanceExtra) - 1);
                bitBuffer >>>= distanceExtra;
                bitCount -= distanceExtra;
            }
            if (distance > outPos) this.failAt(pos, bitCount, `distance ${distance} is too far back (only ${outPos} bytes written)`);

            const end = outPos + length;
            if (end > capacity) {
                this.outPos = outPos;
                this.ensureCapacity(end);
                out = this.out;
                capacity = out.length;
            }
            let from = outPos - distance;
            if (length < BULK_COPY_MIN_LENGTH) {
                while (outPos < end) out[outPos++] = out[from++];
            } else if (distance === 1) {
                out.fill(out[from], outPos, end);
                outPos = end;
            } else {
                while (outPos < end) {
                    const chunk = Math.min(outPos - from, end - outPos);
                    out.copyWithin(outPos, from, from + chunk);
                    outPos += chunk;
                }
            }
        }

        this.pos = pos;
        this.bitBuffer = bitBuffer;
        this.bitCount = bitCount;
        this.outPos = outPos;
    }
}

function buildHuffmanTable(
    lengths: Uint8Array,
    start: number,
    count: number,
    symbols: Int32Array,
    primaryBits: number,
    table: Int32Array,
    allowSingleCode: boolean,
    name: string,
): void {
    const lengthCounts = new Int32Array(MAX_CODE_LENGTH + 1);
    for (let i = 0; i < count; i++) lengthCounts[lengths[start + i]]++;
    lengthCounts[0] = 0;

    let left = 1;
    let maxLength = 0;
    for (let length = 1; length <= MAX_CODE_LENGTH; length++) {
        left = (left << 1) - lengthCounts[length];
        if (left < 0) throw new Error(`inflate: over-subscribed ${name} code lengths`);
        if (lengthCounts[length] !== 0) maxLength = length;
    }
    if (left > 0 && !(allowSingleCode && maxLength <= 1)) throw new Error(`inflate: incomplete ${name} code lengths`);

    const offsets = new Int32Array(MAX_CODE_LENGTH + 2);
    for (let length = 1; length <= MAX_CODE_LENGTH; length++) offsets[length + 1] = offsets[length] + lengthCounts[length];
    const sorted = new Int32Array(offsets[MAX_CODE_LENGTH + 1]);
    for (let symbol = 0; symbol < count; symbol++) {
        const length = lengths[start + symbol];
        if (length !== 0) sorted[offsets[length]++] = symbol;
    }

    const nextCode = new Int32Array(MAX_CODE_LENGTH + 1);
    for (let length = 1, code = 0; length <= MAX_CODE_LENGTH; length++) {
        code = (code + lengthCounts[length - 1]) << 1;
        nextCode[length] = code;
    }

    const primarySize = 1 << primaryBits;
    const primaryMask = primarySize - 1;
    table.fill(KIND_INVALID, 0, primarySize);
    let tableEnd = primarySize;
    let currentPrefix = -1;
    let subOffset = 0;
    let subSize = 0;

    for (let k = 0; k < sorted.length; k++) {
        const symbol = sorted[k];
        const length = lengths[start + symbol];
        const reversed = reverseBits(nextCode[length]++, length);
        const info = symbols[symbol];
        if (length <= primaryBits) {
            for (let i = reversed; i < primarySize; i += 1 << length) table[i] = info | length;
        } else {
            const prefix = reversed & primaryMask;
            if (prefix !== currentPrefix) {
                let subBits = length - primaryBits;
                let room = 1 << subBits;
                while (subBits + primaryBits < maxLength) {
                    room -= lengthCounts[subBits + primaryBits];
                    if (room <= 0) break;
                    subBits++;
                    room <<= 1;
                }
                subOffset = tableEnd;
                subSize = 1 << subBits;
                tableEnd += subSize;
                table.fill(KIND_INVALID, subOffset, tableEnd);
                table[prefix] = (subOffset << ENTRY_VALUE_SHIFT) | KIND_LINK | (subBits << ENTRY_EXTRA_BITS_SHIFT) | primaryBits;
                currentPrefix = prefix;
            }
            const subLength = length - primaryBits;
            for (let i = reversed >>> primaryBits; i < subSize; i += 1 << subLength) table[subOffset + i] = info | subLength;
        }
        lengthCounts[length]--;
    }
}

function reverseBits(code: number, length: number): number {
    let reversed = 0;
    for (let i = 0; i < length; i++) {
        reversed = (reversed << 1) | (code & 1);
        code >>>= 1;
    }
    return reversed;
}

function literalLengthSymbols(): Int32Array {
    const symbols = new Int32Array(LITERAL_LENGTH_SYMBOL_COUNT);
    for (let symbol = 0; symbol < END_OF_BLOCK; symbol++) symbols[symbol] = (symbol << ENTRY_VALUE_SHIFT) | KIND_LITERAL;
    symbols[END_OF_BLOCK] = KIND_END;
    for (let i = 0; i < LENGTH_BASE.length; i++) symbols[FIRST_LENGTH_SYMBOL + i] = (LENGTH_BASE[i] << ENTRY_VALUE_SHIFT) | KIND_BASE | (LENGTH_EXTRA[i] << ENTRY_EXTRA_BITS_SHIFT);
    for (let symbol = FIRST_LENGTH_SYMBOL + LENGTH_BASE.length; symbol < LITERAL_LENGTH_SYMBOL_COUNT; symbol++) symbols[symbol] = KIND_INVALID;
    return symbols;
}

function distanceSymbols(): Int32Array {
    const symbols = new Int32Array(DISTANCE_SYMBOL_COUNT);
    for (let i = 0; i < DISTANCE_BASE.length; i++) symbols[i] = (DISTANCE_BASE[i] << ENTRY_VALUE_SHIFT) | KIND_BASE | (DISTANCE_EXTRA[i] << ENTRY_EXTRA_BITS_SHIFT);
    for (let symbol = DISTANCE_BASE.length; symbol < DISTANCE_SYMBOL_COUNT; symbol++) symbols[symbol] = KIND_INVALID;
    return symbols;
}

function codeLengthSymbols(): Int32Array {
    const symbols = new Int32Array(CODE_LENGTH_SYMBOL_COUNT);
    for (let symbol = 0; symbol < CODE_LENGTH_SYMBOL_COUNT; symbol++) symbols[symbol] = (symbol << ENTRY_VALUE_SHIFT) | KIND_LITERAL;
    return symbols;
}
