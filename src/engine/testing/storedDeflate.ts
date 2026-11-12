const ZLIB_CMF_DEFLATE_32K_WINDOW = 0x78;
const ZLIB_FLG_FASTEST = 0x01;
const ZLIB_HEADER = [ZLIB_CMF_DEFLATE_32K_WINDOW, ZLIB_FLG_FASTEST];

const MAX_STORED_BLOCK_BYTES = 0xFFFF;
const STORED_BLOCK_HEADER_BYTES = 5;
const STORED_LENGTH_OFFSET = 1;
const STORED_LENGTH_COMPLEMENT_OFFSET = 3;
const FINAL_STORED_BLOCK = 1;
const NON_FINAL_STORED_BLOCK = 0;
const LITTLE_ENDIAN = true;

const ADLER_INITIAL = 1;
const ADLER_MODULUS = 65521;
const ADLER_HIGH_SHIFT = 16;
const ADLER32_BYTES = 4;

export function deflateStored(bytes: Uint8Array): Uint8Array {
    const blockCount = Math.max(1, Math.ceil(bytes.length / MAX_STORED_BLOCK_BYTES));
    const output = new Uint8Array(ZLIB_HEADER.length + blockCount * STORED_BLOCK_HEADER_BYTES + bytes.length + ADLER32_BYTES);
    const view = new DataView(output.buffer);
    output.set(ZLIB_HEADER);
    let offset = ZLIB_HEADER.length;
    for (let block = 0; block < blockCount; block++) {
        const start = block * MAX_STORED_BLOCK_BYTES;
        const length = Math.min(MAX_STORED_BLOCK_BYTES, bytes.length - start);
        output[offset] = block === blockCount - 1 ? FINAL_STORED_BLOCK : NON_FINAL_STORED_BLOCK;
        view.setUint16(offset + STORED_LENGTH_OFFSET, length, LITTLE_ENDIAN);
        view.setUint16(offset + STORED_LENGTH_COMPLEMENT_OFFSET, ~length & MAX_STORED_BLOCK_BYTES, LITTLE_ENDIAN);
        output.set(bytes.subarray(start, start + length), offset + STORED_BLOCK_HEADER_BYTES);
        offset += STORED_BLOCK_HEADER_BYTES + length;
    }
    view.setUint32(offset, adler32(bytes));
    return output;
}

function adler32(bytes: Uint8Array): number {
    let a = ADLER_INITIAL, b = 0;
    for (const byte of bytes) {
        a = (a + byte) % ADLER_MODULUS;
        b = (b + a) % ADLER_MODULUS;
    }
    return ((b << ADLER_HIGH_SHIFT) | a) >>> 0;
}
