import type {Entity} from "../core";
import {NULL_ENTITY} from "../core/entity";
import {Vec3, Vec4} from "../math/types/vec";
import {TextColor} from "../rendering/textColor";
import {PACKED_RGB_MASK} from "../rendering/packedRgb";
import {Mesh} from "../rendering/3d/mesh";
import {SpriteImage} from "../rendering/2d/spriteImage";
import type {FieldSchema} from "./fieldSchema";
import type {SceneAssetLoader} from "./sceneAssets";
import {describeJson, FIRST_SCENE_ENTITY_ID, isSceneJsonObject} from "./sceneDocument";
import type {SceneJsonObject, SceneJsonValue} from "./sceneDocument";
import {decodeBase64, encodeBase64} from "./base64";

const NOT_A_NUMBER_TEXT = "NaN";
const POSITIVE_INFINITY_TEXT = "Infinity";
const NEGATIVE_INFINITY_TEXT = "-Infinity";
const DEFAULT_TEXT_COLOR_TEXT = "default";
const HEX_COLOR_PREFIX = "#";
const HEX_COLOR_DIGITS = 6;
const HEX_RADIX = 16;
const VEC3_LENGTH = 3;
const QUATERNION_LENGTH = 4;
const RGBA_BYTES_PER_PIXEL = 4;
const PALETTE_SIZE = 256;
const CODE_ZERO = 0x30;
const CODE_NINE = 0x39;
const CODE_LOWER_A = 0x61;
const CODE_LOWER_F = 0x66;
const CODE_A = 0x41;
const CODE_F = 0x46;

export interface FieldEncodeContext {
    sceneIdOf(entity: Entity): number | undefined;

    reportDanglingEntity(path: string): void;

    reportUnsavedAsset(path: string): void;

    readonly inlineSpriteImageEncodings?: Map<SpriteImage, string>;
}

export interface FieldDecodeContext {
    entityOf(sceneId: number): Entity | undefined;

    reportDanglingEntity(path: string): void;

    readonly assets?: SceneAssetLoader;
    readonly inlineSpriteImages?: Map<string, SpriteImage>;
}

function valueError(path: string, expectation: string, actual: unknown): Error {
    return new Error(`Scene field ${path}: expected ${expectation}, got ${describeValue(actual)}`);
}

function describeValue(value: unknown): string {
    if (value instanceof Float32Array) return `Float32Array [${Array.from(value).join(", ")}]`;
    if (typeof value === "function") return "a function";
    if (typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
        return `a ${value.constructor.name}`;
    }
    return describeJson(value);
}

function isHexDigit(code: number): boolean {
    return (code >= CODE_ZERO && code <= CODE_NINE)
        || (code >= CODE_LOWER_A && code <= CODE_LOWER_F)
        || (code >= CODE_A && code <= CODE_F);
}

function isPackedRgb(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= PACKED_RGB_MASK;
}

function hexColorOf(rgb: number): string {
    return HEX_COLOR_PREFIX + rgb.toString(HEX_RADIX).padStart(HEX_COLOR_DIGITS, "0");
}

function rgbOfHexColor(json: SceneJsonValue, path: string): number {
    const expectation = `a "#rrggbb" colour`;
    if (typeof json !== "string" || json.length !== HEX_COLOR_PREFIX.length + HEX_COLOR_DIGITS || !json.startsWith(HEX_COLOR_PREFIX)) {
        throw valueError(path, expectation, json);
    }
    for (let i = HEX_COLOR_PREFIX.length; i < json.length; i++) {
        if (!isHexDigit(json.charCodeAt(i))) throw valueError(path, expectation, json);
    }
    return Number.parseInt(json.slice(HEX_COLOR_PREFIX.length), HEX_RADIX);
}

function encodeNumber(value: unknown, path: string): SceneJsonValue {
    if (typeof value !== "number") throw valueError(path, "a number", value);
    if (Number.isNaN(value)) return NOT_A_NUMBER_TEXT;
    if (value === Number.POSITIVE_INFINITY) return POSITIVE_INFINITY_TEXT;
    if (value === Number.NEGATIVE_INFINITY) return NEGATIVE_INFINITY_TEXT;
    return value + 0;
}

function decodeNumber(json: SceneJsonValue, path: string): number {
    if (typeof json === "number") return json;
    if (json === NOT_A_NUMBER_TEXT) return Number.NaN;
    if (json === POSITIVE_INFINITY_TEXT) return Number.POSITIVE_INFINITY;
    if (json === NEGATIVE_INFINITY_TEXT) return Number.NEGATIVE_INFINITY;
    throw valueError(path, `a number, "${NOT_A_NUMBER_TEXT}", "${POSITIVE_INFINITY_TEXT}" or "${NEGATIVE_INFINITY_TEXT}"`, json);
}

function isNumberArrayLike(value: unknown, length: number): value is ArrayLike<number> {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as ArrayLike<unknown>;
    if (candidate.length !== length) return false;
    for (let i = 0; i < length; i++) if (typeof candidate[i] !== "number") return false;
    return true;
}

function encodeVector(value: unknown, length: number, path: string): SceneJsonValue {
    if (!isNumberArrayLike(value, length)) throw valueError(path, `${length} numbers`, value);
    const encoded: SceneJsonValue[] = [];
    for (let i = 0; i < length; i++) encoded.push(encodeNumber(value[i], `${path}[${i}]`));
    return encoded;
}

function decodeVectorComponents(json: SceneJsonValue, length: number, path: string): number[] {
    if (!Array.isArray(json) || json.length !== length) throw valueError(path, `an array of ${length} numbers`, json);
    return json.map((element, i) => decodeNumber(element, `${path}[${i}]`));
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(line => typeof line === "string");
}

function encodeTextColor(value: unknown, path: string): SceneJsonValue {
    if (!TextColor.isTextColor(value)) throw valueError(path, "a TextColor", value);
    if (TextColor.isDefault(value)) return DEFAULT_TEXT_COLOR_TEXT;
    if (TextColor.isPalette(value)) return {palette: TextColor.paletteIndexOf(value)};
    return hexColorOf(TextColor.rgbOf(value));
}

function decodeTextColor(json: SceneJsonValue, path: string): TextColor {
    if (json === DEFAULT_TEXT_COLOR_TEXT) return TextColor.DEFAULT;
    if (isSceneJsonObject(json)) {
        const index = json.palette;
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= PALETTE_SIZE) {
            throw valueError(`${path}.palette`, `a whole number in [0, ${PALETTE_SIZE - 1}]`, index);
        }
        return TextColor.palette(index);
    }
    if (typeof json === "string" && json.startsWith(HEX_COLOR_PREFIX)) return TextColor.packedRgb(rgbOfHexColor(json, path));
    throw valueError(path, `"${DEFAULT_TEXT_COLOR_TEXT}", {"palette": n} or "#rrggbb"`, json);
}

export function readSceneEntityId(json: SceneJsonValue, path: string): number | null {
    if (json === null) return null;
    if (typeof json !== "number" || !Number.isSafeInteger(json) || json < FIRST_SCENE_ENTITY_ID) {
        throw valueError(path, `an entity id (a whole number >= ${FIRST_SCENE_ENTITY_ID}) or null`, json);
    }
    return json;
}

function encodeEntity(value: unknown, context: FieldEncodeContext, path: string): SceneJsonValue {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw valueError(path, "an entity", value);
    const entity = value as Entity;
    if (entity === NULL_ENTITY) return null;
    const sceneId = context.sceneIdOf(entity);
    if (sceneId === undefined) {
        context.reportDanglingEntity(path);
        return null;
    }
    return sceneId;
}

function decodeEntity(json: SceneJsonValue, context: FieldDecodeContext, path: string): Entity {
    const sceneId = readSceneEntityId(json, path);
    if (sceneId === null) return NULL_ENTITY;
    const entity = context.entityOf(sceneId);
    if (entity === undefined) {
        context.reportDanglingEntity(path);
        return NULL_ENTITY;
    }
    return entity;
}

function requireAssets(context: FieldDecodeContext, path: string, assetPath: string): SceneAssetLoader {
    if (context.assets === undefined) throw new Error(`Scene field ${path}: loading "${assetPath}" needs an asset loader`);
    return context.assets;
}

function assetPathOf(json: SceneJsonObject, path: string): string {
    const assetPath = json.path;
    if (typeof assetPath !== "string" || assetPath.length === 0) throw valueError(`${path}.path`, "a non-empty file path", assetPath);
    return assetPath;
}

function loadAsset<A>(path: string, assetPath: string, load: () => A): A {
    try {
        return load();
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Scene field ${path}: could not load "${assetPath}": ${reason}`);
    }
}

function encodeMesh(value: unknown, context: FieldEncodeContext, path: string): SceneJsonValue {
    if (value === undefined) return null;
    if (!(value instanceof Mesh)) throw valueError(path, "a Mesh or undefined", value);
    if (value.sourcePath !== undefined) return {path: value.sourcePath};
    context.reportUnsavedAsset(path);
    return null;
}

function decodeMesh(json: SceneJsonValue, context: FieldDecodeContext, path: string): Mesh | undefined {
    if (json === null) return undefined;
    if (!isSceneJsonObject(json)) throw valueError(path, `{"path": "<file>"} or null`, json);
    const assetPath = assetPathOf(json, path);
    const assets = requireAssets(context, path, assetPath);
    return loadAsset(path, assetPath, () => assets.loadMesh(assetPath));
}

function inlineSpriteImageText(image: SpriteImage, context: FieldEncodeContext): string {
    const cache = context.inlineSpriteImageEncodings;
    const cached = cache?.get(image);
    if (cached !== undefined) return cached;
    const text = encodeBase64(image.rgba);
    cache?.set(image, text);
    return text;
}

function encodeSpriteImage(value: unknown, context: FieldEncodeContext, path: string): SceneJsonValue {
    if (value === undefined) return null;
    if (!(value instanceof SpriteImage)) throw valueError(path, "a SpriteImage or undefined", value);
    if (value.sourcePath !== undefined) return {path: value.sourcePath};
    return {width: value.sizeX, height: value.sizeY, rgbaBase64: inlineSpriteImageText(value, context)};
}

function imageExtentOf(json: SceneJsonObject, key: string, path: string): number {
    const extent = json[key];
    if (typeof extent !== "number" || !Number.isSafeInteger(extent) || extent < 0) throw valueError(`${path}.${key}`, "a whole number >= 0", extent);
    return extent;
}

function decodeInlineSpriteImage(json: SceneJsonObject, context: FieldDecodeContext, path: string): SpriteImage {
    const width = imageExtentOf(json, "width", path);
    const height = imageExtentOf(json, "height", path);
    const text = json.rgbaBase64;
    if (typeof text !== "string") throw valueError(`${path}.rgbaBase64`, "base64 RGBA bytes", text);
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

function decodeSpriteImage(json: SceneJsonValue, context: FieldDecodeContext, path: string): SpriteImage | undefined {
    if (json === null) return undefined;
    const expectation = `{"path": "<file>"}, {"width", "height", "rgbaBase64"} or null`;
    if (!isSceneJsonObject(json)) throw valueError(path, expectation, json);
    if (json.path !== undefined) {
        const assetPath = assetPathOf(json, path);
        const assets = requireAssets(context, path, assetPath);
        return loadAsset(path, assetPath, () => assets.loadSpriteImage(assetPath));
    }
    if (json.rgbaBase64 !== undefined) return decodeInlineSpriteImage(json, context, path);
    throw valueError(path, expectation, json);
}

export function encodeFieldValue(field: FieldSchema, value: unknown, context: FieldEncodeContext, path: string): SceneJsonValue {
    switch (field.kind) {
        case "number":
            return encodeNumber(value, path);
        case "integer":
            if (typeof value !== "number" || !Number.isInteger(value)) throw valueError(path, "a whole number", value);
            return value + 0;
        case "boolean":
            if (typeof value !== "boolean") throw valueError(path, "true or false", value);
            return value;
        case "string":
            if (typeof value === "string") return value;
            if (field.nullable && value === undefined) return null;
            throw valueError(path, field.nullable ? "a string or undefined" : "a string", value);
        case "textLines":
            if (!isStringArray(value)) throw valueError(path, "an array of strings", value);
            return [...value];
        case "vec3":
            return encodeVector(value, VEC3_LENGTH, path);
        case "rotation":
            return encodeVector(value, QUATERNION_LENGTH, path);
        case "rgb":
            if (!isPackedRgb(value)) throw valueError(path, "a packed 0xRRGGBB colour", value);
            return hexColorOf(value);
        case "textColor":
            return encodeTextColor(value, path);
        case "enum": {
            const member = field.members.find(candidate => candidate.value === value);
            if (member === undefined) throw valueError(path, `one of ${field.members.map(candidate => describeJson(candidate.value)).join(", ")}`, value);
            return member.name;
        }
        case "entity":
            return encodeEntity(value, context, path);
        case "mesh":
            return encodeMesh(value, context, path);
        case "spriteImage":
            return encodeSpriteImage(value, context, path);
    }
}

export function decodeFieldValue(field: FieldSchema, json: SceneJsonValue, context: FieldDecodeContext, path: string): unknown {
    switch (field.kind) {
        case "number":
            return decodeNumber(json, path);
        case "integer":
            if (typeof json !== "number" || !Number.isInteger(json)) throw valueError(path, "a whole number", json);
            return json;
        case "boolean":
            if (typeof json !== "boolean") throw valueError(path, "true or false", json);
            return json;
        case "string":
            if (typeof json === "string") return json;
            if (field.nullable && json === null) return undefined;
            throw valueError(path, field.nullable ? "a string or null" : "a string", json);
        case "textLines":
            if (!isStringArray(json)) throw valueError(path, "an array of strings", json);
            return [...json];
        case "vec3": {
            const [x, y, z] = decodeVectorComponents(json, VEC3_LENGTH, path);
            return Vec3.alloc(x, y, z);
        }
        case "rotation": {
            const [x, y, z, w] = decodeVectorComponents(json, QUATERNION_LENGTH, path);
            return Vec4.alloc(x, y, z, w);
        }
        case "rgb":
            return rgbOfHexColor(json, path);
        case "textColor":
            return decodeTextColor(json, path);
        case "enum": {
            const member = field.members.find(candidate => candidate.name === json);
            if (member === undefined) throw valueError(path, `one of ${field.members.map(candidate => JSON.stringify(candidate.name)).join(", ")}`, json);
            return member.value;
        }
        case "entity":
            return decodeEntity(json, context, path);
        case "mesh":
            return decodeMesh(json, context, path);
        case "spriteImage":
            return decodeSpriteImage(json, context, path);
    }
}
