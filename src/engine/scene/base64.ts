const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const PADDING = "=";
const BYTES_PER_GROUP = 3;
const CHARACTERS_PER_GROUP = 4;
const BITS_PER_CHARACTER = 6;
const SIXTEEN_BITS = 16;
const EIGHT_BITS = 8;
const SIX_BIT_MASK = 0x3F;
const BYTE_MASK = 0xFF;
const UPPERCASE_COUNT = 26;
const DIGIT_COUNT = 10;
const LOWERCASE_START = UPPERCASE_COUNT;
const DIGIT_START = 2 * UPPERCASE_COUNT;
const PLUS_VALUE = DIGIT_START + DIGIT_COUNT;
const SLASH_VALUE = PLUS_VALUE + 1;
const INVALID_CHARACTER = -1;
const CODE_A = 0x41;
const CODE_Z = 0x5A;
const CODE_LOWER_A = 0x61;
const CODE_LOWER_Z = 0x7A;
const CODE_ZERO = 0x30;
const CODE_NINE = 0x39;
const CODE_PLUS = 0x2B;
const CODE_SLASH = 0x2F;

function sextetOf(code: number): number {
    if (code >= CODE_A && code <= CODE_Z) return code - CODE_A;
    if (code >= CODE_LOWER_A && code <= CODE_LOWER_Z) return code - CODE_LOWER_A + LOWERCASE_START;
    if (code >= CODE_ZERO && code <= CODE_NINE) return code - CODE_ZERO + DIGIT_START;
    if (code === CODE_PLUS) return PLUS_VALUE;
    if (code === CODE_SLASH) return SLASH_VALUE;
    return INVALID_CHARACTER;
}

export function encodeBase64(bytes: Uint8Array): string {
    const parts: string[] = [];
    for (let i = 0; i < bytes.length; i += BYTES_PER_GROUP) {
        const remaining = bytes.length - i;
        const b0 = bytes[i];
        const b1 = remaining > 1 ? bytes[i + 1] : 0;
        const b2 = remaining > 2 ? bytes[i + 2] : 0;
        const group = (b0 << SIXTEEN_BITS) | (b1 << EIGHT_BITS) | b2;
        parts.push(
            BASE64_ALPHABET.charAt((group >> (3 * BITS_PER_CHARACTER)) & SIX_BIT_MASK)
            + BASE64_ALPHABET.charAt((group >> (2 * BITS_PER_CHARACTER)) & SIX_BIT_MASK)
            + (remaining > 1 ? BASE64_ALPHABET.charAt((group >> BITS_PER_CHARACTER) & SIX_BIT_MASK) : PADDING)
            + (remaining > 2 ? BASE64_ALPHABET.charAt(group & SIX_BIT_MASK) : PADDING),
        );
    }
    return parts.join("");
}

export function decodeBase64(text: string): Uint8Array {
    if (text.length % CHARACTERS_PER_GROUP !== 0) {
        throw new Error(`base64 text must be a multiple of ${CHARACTERS_PER_GROUP} characters long, got ${text.length}`);
    }
    let padding = 0;
    if (text.endsWith(PADDING + PADDING)) padding = 2;
    else if (text.endsWith(PADDING)) padding = 1;
    const bytes = new Uint8Array(text.length / CHARACTERS_PER_GROUP * BYTES_PER_GROUP - padding);
    let written = 0;
    for (let i = 0; i < text.length; i += CHARACTERS_PER_GROUP) {
        const lastGroup = i + CHARACTERS_PER_GROUP === text.length;
        const paddedCharacters = lastGroup ? padding : 0;
        let group = 0;
        for (let c = 0; c < CHARACTERS_PER_GROUP; c++) {
            const isPadding = c >= CHARACTERS_PER_GROUP - paddedCharacters;
            const sextet = isPadding ? 0 : sextetOf(text.charCodeAt(i + c));
            if (sextet === INVALID_CHARACTER) {
                throw new Error(`base64 text has an invalid character ${JSON.stringify(text.charAt(i + c))} at ${i + c}`);
            }
            group = (group << BITS_PER_CHARACTER) | sextet;
        }
        bytes[written++] = (group >> SIXTEEN_BITS) & BYTE_MASK;
        if (written < bytes.length) bytes[written++] = (group >> EIGHT_BITS) & BYTE_MASK;
        if (written < bytes.length) bytes[written++] = group & BYTE_MASK;
    }
    return bytes;
}
