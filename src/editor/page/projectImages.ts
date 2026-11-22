import type {DecodedImage} from "../../engine/assets/image/decodedImage";
import {inflate} from "../../engine/assets/image/inflate";
import {decodeJpeg} from "../../engine/assets/image/jpeg";
import {decodePng} from "../../engine/assets/image/png";
import {decodePpm} from "../../engine/assets/image/ppm";
import {extensionOf} from "./projectFiles";

const IMAGE_DECODERS: Readonly<Record<string, (bytes: Uint8Array) => DecodedImage>> = {
    ".png": bytes => decodePng(bytes, {inflate}),
    ".jpg": decodeJpeg,
    ".jpeg": decodeJpeg,
    ".ppm": decodePpm,
};

export function decodeProjectImage(path: string, bytes: Uint8Array): DecodedImage | undefined {
    const decode = IMAGE_DECODERS[extensionOf(path).toLowerCase()];
    return decode === undefined ? undefined : decode(bytes);
}

export function canDecodeProjectImage(path: string): boolean {
    return IMAGE_DECODERS[extensionOf(path).toLowerCase()] !== undefined;
}
