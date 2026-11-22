import type {AssetLoadOptions} from "../../platform";

export interface DecodedImage {
    readonly width: number;
    readonly height: number;
    readonly rgba: Uint8Array;
}

export function decodeImageFile(filePath: string, options: AssetLoadOptions): DecodedImage {
    const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
    const decoder = decodersByExtension.get(extension);
    if (decoder === undefined) {
        const registered = decodersByExtension.size === 0 ? "none" : [...decodersByExtension.keys()].join(", ");
        throw new Error(`Unable to decode image ${filePath}: no image decoder is registered for ${extension} (registered: ${registered}); `
            + "call registerBuiltinImageDecoders() or registerImageDecoders([...]), or regenerate the project so its bootstrap registers the decoders its image files need");
    }
    return decoder(options.files.readBytes(filePath), options);
}

export type ImageDecoder = (bytes: Uint8Array, options: Pick<AssetLoadOptions, "inflate">) => DecodedImage;

export interface ImageDecoderEntry {
    readonly extensions: readonly string[];
    readonly decode: ImageDecoder;
}

const decodersByExtension = new Map<string, ImageDecoder>();

export function registerImageDecoder(extension: string, decoder: ImageDecoder): void {
    decodersByExtension.set(extension.toLowerCase(), decoder);
}

export function registerImageDecoders(entries: readonly ImageDecoderEntry[]): void {
    for (const entry of entries) for (const extension of entry.extensions) registerImageDecoder(extension, entry.decode);
}
