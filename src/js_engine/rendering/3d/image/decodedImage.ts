export interface DecodedImage {
    readonly width: number;
    readonly height: number;
    /** Row-major RGBA, 4 bytes per pixel, top row first. */
    readonly rgba: Uint8Array;
}

export function decodeImageFile(filePath: string): DecodedImage {
    const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
    const decoder = decodersByExtension.get(extension);
    if (decoder === undefined) {
        throw new Error(`Unable to decode image ${filePath}: ${extension} is not supported (supported: ${[...decodersByExtension.keys()].join(", ")})`);
    }
    const fs = require("fs") as typeof import("fs");
    return decoder(new Uint8Array(fs.readFileSync(filePath)));
}

export type ImageDecoder = (bytes: Uint8Array) => DecodedImage;

const decodersByExtension = new Map<string, ImageDecoder>();

export function registerImageDecoder(extension: string, decoder: ImageDecoder): void {
    decodersByExtension.set(extension.toLowerCase(), decoder);
}
