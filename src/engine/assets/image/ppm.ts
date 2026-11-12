import {DecodedImage, registerImageDecoder} from "./decodedImage";

const PPM_BINARY_MAGIC = "P6";
const SUPPORTED_MAX_VALUE = 255;
const RGB_BYTES = 3;
const RGBA_BYTES = 4;
const OPAQUE_ALPHA = 255;
const DECIMAL = 10;
const CHAR_HASH = 35;
const CHAR_LINE_FEED = 10;
const CHAR_CARRIAGE_RETURN = 13;
const CHAR_SPACE = 32;
const CHAR_TAB = 9;

export function decodePpm(bytes: Uint8Array): DecodedImage {
    const reader = new PpmHeaderReader(bytes);
    if (reader.nextToken() !== PPM_BINARY_MAGIC) throw new Error("Only binary PPM (P6) is supported");
    const width = reader.nextNumber();
    const height = reader.nextNumber();
    const maxValue = reader.nextNumber();
    if (maxValue !== SUPPORTED_MAX_VALUE) throw new Error(`PPM max value ${maxValue} is not supported, expected 255`);
    const pixelStart = reader.offset + 1;
    const pixelCount = width * height;
    if (bytes.length < pixelStart + pixelCount * RGB_BYTES) throw new Error("PPM pixel data is truncated");
    const rgba = new Uint8Array(pixelCount * RGBA_BYTES);
    for (let i = 0, input = pixelStart, output = 0; i < pixelCount; i++, input += RGB_BYTES, output += RGBA_BYTES) {
        rgba[output] = bytes[input];
        rgba[output + 1] = bytes[input + 1];
        rgba[output + 2] = bytes[input + 2];
        rgba[output + 3] = OPAQUE_ALPHA;
    }
    return {width, height, rgba};
}

export function encodePpm(width: number, height: number, rgba: Uint8Array): Uint8Array {
    const header = `P6\n${width} ${height}\n255\n`;
    const out = new Uint8Array(header.length + width * height * RGB_BYTES);
    for (let i = 0; i < header.length; i++) out[i] = header.charCodeAt(i);
    for (let i = 0, input = 0, output = header.length; i < width * height; i++, input += RGBA_BYTES, output += RGB_BYTES) {
        out[output] = rgba[input];
        out[output + 1] = rgba[input + 1];
        out[output + 2] = rgba[input + 2];
    }
    return out;
}

registerImageDecoder(".ppm", decodePpm);

class PpmHeaderReader {
    public offset = 0;

    public constructor(private readonly bytes: Uint8Array) {
    }

    public nextToken(): string {
        this.skipWhitespaceAndComments();
        const start = this.offset;
        while (this.offset < this.bytes.length && !isWhitespace(this.bytes[this.offset])) this.offset++;
        return String.fromCharCode(...this.bytes.subarray(start, this.offset));
    }

    public nextNumber(): number {
        const value = Number.parseInt(this.nextToken(), DECIMAL);
        if (Number.isNaN(value)) throw new Error("PPM header is malformed");
        return value;
    }

    private skipWhitespaceAndComments(): void {
        while (this.offset < this.bytes.length) {
            const byte = this.bytes[this.offset];
            if (byte === CHAR_HASH) {
                while (this.offset < this.bytes.length && this.bytes[this.offset] !== CHAR_LINE_FEED) this.offset++;
            } else if (isWhitespace(byte)) {
                this.offset++;
            } else {
                return;
            }
        }
    }
}

function isWhitespace(byte: number): boolean {
    return byte === CHAR_SPACE || byte === CHAR_LINE_FEED || byte === CHAR_CARRIAGE_RETURN || byte === CHAR_TAB;
}
