import {registerImageDecoders} from "./decodedImage";
import type {ImageDecoderEntry} from "./decodedImage";
import {JPEG_IMAGE_DECODER} from "./jpeg";
import {PNG_IMAGE_DECODER} from "./png";
import {PPM_IMAGE_DECODER} from "./ppm";

export const BUILTIN_IMAGE_DECODERS: readonly ImageDecoderEntry[] = [PNG_IMAGE_DECODER, PPM_IMAGE_DECODER, JPEG_IMAGE_DECODER];

export function registerBuiltinImageDecoders(): void {
    registerImageDecoders(BUILTIN_IMAGE_DECODERS);
}
