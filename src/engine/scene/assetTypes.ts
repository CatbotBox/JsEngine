import {Mesh} from "../rendering/3d/mesh";
import {SpriteImage} from "../rendering/2d/spriteImage";
import {isSpritePatternImage} from "../rendering/2d/spritePattern";
import {ShaderSource, WGSL_FILE_SUFFIX} from "../rendering/shaderSource";
import {decodeBase64, encodeBase64} from "./base64";
import {MESH_ASSET_TYPE_NAME, PREFAB_ASSET_TYPE_NAME, PREFAB_FILE_SUFFIX, SHADER_ASSET_TYPE_NAME, SPRITE_IMAGE_ASSET_TYPE_NAME} from "./fieldSchema";
import {fieldValueError} from "./fieldValueError";
import type {FieldDecodeContext, FieldEncodeContext} from "./fieldValueCodec";
import {PrefabAsset} from "./prefabAsset";
import type {SceneAssetLoader} from "./sceneAssets";
import type {SceneJsonObject} from "./sceneDocument";

export {MESH_ASSET_TYPE_NAME, PREFAB_ASSET_TYPE_NAME, PREFAB_FILE_SUFFIX, SHADER_ASSET_TYPE_NAME, SPRITE_IMAGE_ASSET_TYPE_NAME} from "./fieldSchema";

const MESH_FILE_SUFFIXES: readonly string[] = [".obj"];
const IMAGE_FILE_SUFFIXES: readonly string[] = [".png", ".jpg", ".jpeg", ".ppm"];
const PREFAB_FILE_SUFFIXES: readonly string[] = [PREFAB_FILE_SUFFIX];
const SHADER_FILE_SUFFIXES: readonly string[] = [WGSL_FILE_SUFFIX];
const RGBA_BYTES_PER_PIXEL = 4;

export interface InlineAssetCodec<A> {
    readonly expectation: string;

    matches(json: SceneJsonObject): boolean;

    encode(value: A, context: FieldEncodeContext, path: string): SceneJsonObject;

    decode(json: SceneJsonObject, context: FieldDecodeContext, path: string): A;
}

export interface AssetType<A = unknown> {
    readonly name: string;
    readonly valueName: string;
    readonly fileSuffixes: readonly string[];
    readonly inline?: InlineAssetCodec<A>;

    isAsset(value: unknown): value is A;

    isDerived?(value: A): boolean;

    load(path: string, loader: SceneAssetLoader): A;

    pathOf(value: A): string | undefined;
}

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

export const MESH_ASSET_TYPE: AssetType<Mesh> = {
    name: MESH_ASSET_TYPE_NAME,
    valueName: "Mesh",
    fileSuffixes: MESH_FILE_SUFFIXES,
    isAsset: (value): value is Mesh => value instanceof Mesh,
    load: (path, loader) => loader.loadMesh(path),
    pathOf: mesh => mesh.sourcePath,
};

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
    load: (path, loader) => loader.loadSpriteImage(path),
    pathOf: image => image.sourcePath,
};

export const PREFAB_ASSET_TYPE: AssetType<PrefabAsset> = {
    name: PREFAB_ASSET_TYPE_NAME,
    valueName: "PrefabAsset",
    fileSuffixes: PREFAB_FILE_SUFFIXES,
    isAsset: (value): value is PrefabAsset => value instanceof PrefabAsset,
    load: (path, loader) => loader.loadPrefab(path),
    pathOf: prefab => prefab.sourcePath,
};

export const SHADER_ASSET_TYPE: AssetType<ShaderSource> = {
    name: SHADER_ASSET_TYPE_NAME,
    valueName: "ShaderSource",
    fileSuffixes: SHADER_FILE_SUFFIXES,
    isAsset: (value): value is ShaderSource => value instanceof ShaderSource,
    load: (path, loader) => new ShaderSource(path, loader.loadText(path)),
    pathOf: shader => shader.sourcePath,
};

export const ENGINE_ASSET_TYPES: readonly AssetType[] = [
    MESH_ASSET_TYPE as AssetType,
    SPRITE_IMAGE_ASSET_TYPE as AssetType,
    PREFAB_ASSET_TYPE as AssetType,
    SHADER_ASSET_TYPE as AssetType,
];

export function engineAssetType(name: string): AssetType | undefined {
    return ENGINE_ASSET_TYPES.find(type => type.name === name);
}
