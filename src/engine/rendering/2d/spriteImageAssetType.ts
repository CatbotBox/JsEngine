import type {AssetType} from "../../scene/assetTypes";
import {decodeBase64, encodeBase64} from "../../scene/base64";
import {SPRITE_IMAGE_ASSET_TYPE_NAME} from "../../scene/fieldSchema";
import {fieldValueError} from "../../scene/fieldValueError";
import type {FieldDecodeContext, FieldEncodeContext} from "../../scene/fieldValueCodec";
import type {SceneJsonObject} from "../../scene/sceneDocument";
import {SpriteImage} from "./spriteImage";
import {isSpritePatternImage} from "./spritePattern";

const IMAGE_FILE_SUFFIXES: readonly string[] = [".png", ".jpg", ".jpeg", ".ppm"];
const RGBA_BYTES_PER_PIXEL = 4;

function inlineSpriteImageText(image: SpriteImage, context: FieldEncodeContext): string {
    const cache = context.inlineSpriteImageEncodings;
    const cached = cache?.get(image);
    if (cached !== undefined) return cached;
    const text = encodeBase64(image.rgba);
    cache?.set(image, text);
    return text;
}

function imageExtentOf(json: SceneJsonObject, key: string, path: string): number {
    const extent = json[key];
    if (typeof extent !== "number" || !Number.isSafeInteger(extent) || extent < 0) throw fieldValueError(`${path}.${key}`, "a whole number >= 0", extent);
    return extent;
}

function decodeInlineSpriteImage(json: SceneJsonObject, context: FieldDecodeContext, path: string): SpriteImage {
    const width = imageExtentOf(json, "width", path);
    const height = imageExtentOf(json, "height", path);
    const text = json.rgbaBase64;
    if (typeof text !== "string") throw fieldValueError(`${path}.rgbaBase64`, "base64 RGBA bytes", text);
    const cacheKey = `${width}x${height}:${text}`;
    const cached = context.inlineSpriteImages?.get(cacheKey);
    if (cached !== undefined) return cached;
    let rgba: Uint8Array;
    try {
        rgba = decodeBase64(text);
    } catch (error) {
        throw new Error(`Scene field ${path}.rgbaBase64: ${error instanceof Error ? error.message : String(error)}`);
    }
    const expectedBytes = width * height * RGBA_BYTES_PER_PIXEL;
    if (rgba.length !== expectedBytes) {
        throw new Error(`Scene field ${path}.rgbaBase64: expected ${expectedBytes} bytes for ${width}x${height}, got ${rgba.length}`);
    }
    const image = SpriteImage.fromPixels(width, height, rgba);
    context.inlineSpriteImages?.set(cacheKey, image);
    return image;
}

export const SPRITE_IMAGE_ASSET_TYPE: AssetType<SpriteImage> = {
    name: SPRITE_IMAGE_ASSET_TYPE_NAME,
    valueName: "SpriteImage",
    fileSuffixes: IMAGE_FILE_SUFFIXES,
    inline: {
        expectation: `{"width", "height", "rgbaBase64"}`,
        matches: json => json.rgbaBase64 !== undefined,
        encode: (image, context) => ({width: image.sizeX, height: image.sizeY, rgbaBase64: inlineSpriteImageText(image, context)}),
        decode: decodeInlineSpriteImage,
    },
    isAsset: (value): value is SpriteImage => value instanceof SpriteImage,
    isDerived: isSpritePatternImage,
    load: (path, loader) => SpriteImage.fromFile(path, loader.loadOptions),
    pathOf: image => image.sourcePath,
};
