import {DecodedImage, registerImageDecoder} from "./decodedImage";

export function decodePpm(bytes: Uint8Array): DecodedImage {
    const reader = new PpmHeaderReader(bytes);
    if (reader.nextToken() !== "P6") throw new Error("Only binary PPM (P6) is supported");
    const width = reader.nextNumber();
    const height = reader.nextNumber();
    const maxValue = reader.nextNumber();
    if (maxValue !== 255) throw new Error(`PPM max value ${maxValue} is not supported, expected 255`);
    const pixelStart = reader.offset + 1;
    const pixelCount = width * height;
    if (bytes.length < pixelStart + pixelCount * 3) throw new Error("PPM pixel data is truncated");
    const rgba = new Uint8Array(pixelCount * 4);
    for (let i = 0, input = pixelStart, output = 0; i < pixelCount; i++, input += 3, output += 4) {
        rgba[output] = bytes[input];
        rgba[output + 1] = bytes[input + 1];
        rgba[output + 2] = bytes[input + 2];
        rgba[output + 3] = 255;
    }
    return {width, height, rgba};
}

export function encodePpm(width: number, height: number, rgba: Uint8Array): Uint8Array {
    const header = `P6\n${width} ${height}\n255\n`;
    const out = new Uint8Array(header.length + width * height * 3);
    for (let i = 0; i < header.length; i++) out[i] = header.charCodeAt(i);
    for (let i = 0, input = 0, output = header.length; i < width * height; i++, input += 4, output += 3) {
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
        const value = Number.parseInt(this.nextToken(), 10);
        if (Number.isNaN(value)) throw new Error("PPM header is malformed");
        return value;
    }

    private skipWhitespaceAndComments(): void {
        while (this.offset < this.bytes.length) {
            const byte = this.bytes[this.offset];
            if (byte === 35) {
                while (this.offset < this.bytes.length && this.bytes[this.offset] !== 10) this.offset++;
            } else if (isWhitespace(byte)) {
                this.offset++;
            } else {
                return;
            }
        }
    }
}

function isWhitespace(byte: number): boolean {
    return byte === 32 || byte === 10 || byte === 13 || byte === 9;
}
