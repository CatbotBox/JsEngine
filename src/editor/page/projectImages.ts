import type {DecodedImage} from "../../engine/assets/image/decodedImage";
import {inflate} from "../../engine/assets/image/inflate";
import {decodeJpeg} from "../../engine/assets/image/jpeg";
import {decodePng} from "../../engine/assets/image/png";
import {decodePpm} from "../../engine/assets/image/ppm";
import {SpriteImage} from "../../engine/rendering/2d/spriteImage";
import {parseSpritePatternFile, SPRITE_PATTERN_FILE_SUFFIX} from "../../engine/rendering/2d/spritePatternFile";
import {extensionOf} from "./projectFiles";

const TEXT_DECODER_OPTIONS = {ignoreBOM: true} as const;

function decodePatternFile(bytes: Uint8Array): DecodedImage {
    const image = SpriteImage.fromPatternSource(parseSpritePatternFile(new TextDecoder("utf-8", TEXT_DECODER_OPTIONS).decode(bytes)));
    return {width: image.sizeX, height: image.sizeY, rgba: image.rgba};
}

const IMAGE_DECODERS: Readonly<Record<string, (bytes: Uint8Array) => DecodedImage>> = {
    ".png": bytes => decodePng(bytes, {inflate}),
    ".jpg": decodeJpeg,
    ".jpeg": decodeJpeg,
    ".ppm": decodePpm,
    [SPRITE_PATTERN_FILE_SUFFIX]: decodePatternFile,
};

export function decodeProjectImage(path: string, bytes: Uint8Array): DecodedImage | undefined {
    const decode = IMAGE_DECODERS[extensionOf(path).toLowerCase()];
    return decode === undefined ? undefined : decode(bytes);
}

export function canDecodeProjectImage(path: string): boolean {
    return IMAGE_DECODERS[extensionOf(path).toLowerCase()] !== undefined;
}
