import type {AssetLoadOptions} from "../../../platform";
import {nodePlatform} from "../../../platform";

export interface DecodedImage {
    readonly width: number;
    readonly height: number;
    /** Row-major RGBA, 4 bytes per pixel, top row first. */
    readonly rgba: Uint8Array;
}

export function decodeImageFile(filePath: string, options: AssetLoadOptions = {}): DecodedImage {
    const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
    const decoder = decodersByExtension.get(extension);
    if (decoder === undefined) {
        throw new Error(`Unable to decode image ${filePath}: ${extension} is not supported (supported: ${[...decodersByExtension.keys()].join(", ")})`);
    }
    const files = options.files ?? nodePlatform().files;
    return decoder(files.readBytes(filePath), options);
}

/** Decoders that need decompression (PNG) take `inflate` from the options. */
export type ImageDecoder = (bytes: Uint8Array, options?: Pick<AssetLoadOptions, "inflate">) => DecodedImage;

const decodersByExtension = new Map<string, ImageDecoder>();

export function registerImageDecoder(extension: string, decoder: ImageDecoder): void {
    decodersByExtension.set(extension.toLowerCase(), decoder);
}
