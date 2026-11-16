import type {Entity} from "../core";
import {NULL_ENTITY} from "../core/entity";
import {Vec2, Vec3, Vec4} from "../math/types/vec";
import {TextColor} from "../rendering/textColor";
import {PACKED_RGB_MASK} from "../rendering/packedRgb";
import type {SpriteImage} from "../rendering/2d/spriteImage";
import {engineAssetType} from "./assetTypes";
import type {AssetType} from "./assetTypes";
import {createStructValue, customFieldTypeOf} from "./fieldDefaults";
import type {AssetFieldType, FieldType, FieldTypeResolver, StructFieldType} from "./fieldSchema";
import {fieldValueError} from "./fieldValueError";
import type {SceneAssetLoader} from "./sceneAssets";
import {describeJson, FIRST_SCENE_ENTITY_ID, isSceneJsonObject} from "./sceneDocument";
import type {SceneJsonObject, SceneJsonValue} from "./sceneDocument";

const NOT_A_NUMBER_TEXT = "NaN";
const POSITIVE_INFINITY_TEXT = "Infinity";
const NEGATIVE_INFINITY_TEXT = "-Infinity";
const DEFAULT_TEXT_COLOR_TEXT = "default";
const HEX_COLOR_PREFIX = "#";
const HEX_COLOR_DIGITS = 6;
const HEX_RADIX = 16;
const VEC2_LENGTH = 2;
const VEC3_LENGTH = 3;
const QUATERNION_LENGTH = 4;
const PALETTE_SIZE = 256;
const CODE_ZERO = 0x30;
const CODE_NINE = 0x39;
const CODE_LOWER_A = 0x61;
const CODE_LOWER_F = 0x66;
const CODE_A = 0x41;
const CODE_F = 0x46;
const PATH_ONLY_EXPECTATION = `{"path": "<file>"}`;

export interface FieldEncodeContext {
    sceneIdOf(entity: Entity): number | undefined;

    reportDanglingEntity(path: string): void;

    reportUnsavedAsset(path: string): void;

    readonly inlineSpriteImageEncodings?: Map<SpriteImage, string>;
    readonly fieldTypes?: FieldTypeResolver;
}

export interface FieldDecodeContext {
    entityOf(sceneId: number): Entity | undefined;

    reportDanglingEntity(path: string): void;

    reportSchemaChange?(typeName: string, addedKeys: readonly string[], removedKeys: readonly string[]): void;

    readonly assets?: SceneAssetLoader;
    readonly inlineSpriteImages?: Map<string, SpriteImage>;
    readonly fieldTypes?: FieldTypeResolver;
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
        throw fieldValueError(path, expectation, json);
    }
    for (let i = HEX_COLOR_PREFIX.length; i < json.length; i++) {
        if (!isHexDigit(json.charCodeAt(i))) throw fieldValueError(path, expectation, json);
    }
    return Number.parseInt(json.slice(HEX_COLOR_PREFIX.length), HEX_RADIX);
}

function encodeNumber(value: unknown, path: string): SceneJsonValue {
    if (typeof value !== "number") throw fieldValueError(path, "a number", value);
    if (Number.isNaN(value)) return NOT_A_NUMBER_TEXT;
    if (value === Number.POSITIVE_INFINITY) return POSITIVE_INFINITY_TEXT;
    if (value === Number.NEGATIVE_INFINITY) return NEGATIVE_INFINITY_TEXT;
    // -0 + 0 is +0, so -0 saves as 0.
    return value + 0;
}

function decodeNumber(json: SceneJsonValue, path: string): number {
    if (typeof json === "number") return json;
    if (json === NOT_A_NUMBER_TEXT) return Number.NaN;
    if (json === POSITIVE_INFINITY_TEXT) return Number.POSITIVE_INFINITY;
    if (json === NEGATIVE_INFINITY_TEXT) return Number.NEGATIVE_INFINITY;
    throw fieldValueError(path, `a number, "${NOT_A_NUMBER_TEXT}", "${POSITIVE_INFINITY_TEXT}" or "${NEGATIVE_INFINITY_TEXT}"`, json);
}

function encodeInteger(value: unknown, path: string): SceneJsonValue {
    if (typeof value !== "number" || !Number.isInteger(value)) throw fieldValueError(path, "a whole number", value);
    return value + 0;
}

function decodeInteger(json: SceneJsonValue, path: string): number {
    if (typeof json !== "number" || !Number.isInteger(json)) throw fieldValueError(path, "a whole number", json);
    return json;
}

function isNumberArrayLike(value: unknown, length: number): value is ArrayLike<number> {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as ArrayLike<unknown>;
    if (candidate.length !== length) return false;
    for (let i = 0; i < length; i++) if (typeof candidate[i] !== "number") return false;
    return true;
}

function encodeVector(value: unknown, length: number, path: string): SceneJsonValue {
    if (!isNumberArrayLike(value, length)) throw fieldValueError(path, `${length} numbers`, value);
    const encoded: SceneJsonValue[] = [];
    for (let i = 0; i < length; i++) encoded.push(encodeNumber(value[i], `${path}[${i}]`));
    return encoded;
}

function decodeVectorComponents(json: SceneJsonValue, length: number, path: string): number[] {
    if (!Array.isArray(json) || json.length !== length) throw fieldValueError(path, `an array of ${length} numbers`, json);
    return json.map((element, i) => decodeNumber(element, `${path}[${i}]`));
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(line => typeof line === "string");
}

function encodeTextColor(value: unknown, path: string): SceneJsonValue {
    if (!TextColor.isTextColor(value)) throw fieldValueError(path, "a TextColor", value);
    if (TextColor.isDefault(value)) return DEFAULT_TEXT_COLOR_TEXT;
    if (TextColor.isPalette(value)) return {palette: TextColor.paletteIndexOf(value)};
    return hexColorOf(TextColor.rgbOf(value));
}

function decodeTextColor(json: SceneJsonValue, path: string): TextColor {
    if (json === DEFAULT_TEXT_COLOR_TEXT) return TextColor.DEFAULT;
    if (isSceneJsonObject(json)) {
        const index = json.palette;
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= PALETTE_SIZE) {
            throw fieldValueError(`${path}.palette`, `a whole number in [0, ${PALETTE_SIZE - 1}]`, index);
        }
        return TextColor.palette(index);
    }
    if (typeof json === "string" && json.startsWith(HEX_COLOR_PREFIX)) return TextColor.packedRgb(rgbOfHexColor(json, path));
    throw fieldValueError(path, `"${DEFAULT_TEXT_COLOR_TEXT}", {"palette": n} or "#rrggbb"`, json);
}

export function readSceneEntityId(json: SceneJsonValue, path: string): number | null {
    if (json === null) return null;
    if (typeof json !== "number" || !Number.isSafeInteger(json) || json < FIRST_SCENE_ENTITY_ID) {
        throw fieldValueError(path, `an entity id (a whole number >= ${FIRST_SCENE_ENTITY_ID}) or null`, json);
    }
    return json;
}

function encodeEntity(value: unknown, context: FieldEncodeContext, path: string): SceneJsonValue {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw fieldValueError(path, "an entity", value);
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
    if (typeof assetPath !== "string" || assetPath.length === 0) throw fieldValueError(`${path}.path`, "a non-empty file path", assetPath);
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

function assetTypeOf(fieldTypes: FieldTypeResolver | undefined, name: string, path: string): AssetType {
    const type = fieldTypes?.assetType(name) ?? engineAssetType(name);
    if (type === undefined) throw new Error(`Scene field ${path}: the asset type "${name}" is not registered`);
    return type;
}

function encodeAsset(field: AssetFieldType, value: unknown, context: FieldEncodeContext, path: string): SceneJsonValue {
    if (value === undefined) return null;
    const type = assetTypeOf(context.fieldTypes, field.assetType, path);
    if (!type.isAsset(value)) throw fieldValueError(path, `a ${type.valueName} or undefined`, value);
    const assetPath = type.pathOf(value);
    if (assetPath !== undefined) return {path: assetPath};
    if (type.inline !== undefined) return type.inline.encode(value, context, path);
    context.reportUnsavedAsset(path);
    return null;
}

function decodeAsset(field: AssetFieldType, json: SceneJsonValue, context: FieldDecodeContext, path: string): unknown {
    if (json === null) return undefined;
    const type = assetTypeOf(context.fieldTypes, field.assetType, path);
    const inline = type.inline;
    const expectation = inline === undefined ? `${PATH_ONLY_EXPECTATION} or null` : `${PATH_ONLY_EXPECTATION}, ${inline.expectation} or null`;
    if (!isSceneJsonObject(json)) throw fieldValueError(path, expectation, json);
    if (inline !== undefined && json.path === undefined) {
        if (inline.matches(json)) return inline.decode(json, context, path);
        throw fieldValueError(path, expectation, json);
    }
    const assetPath = assetPathOf(json, path);
    const assets = requireAssets(context, path, assetPath);
    return loadAsset(path, assetPath, () => type.load(assetPath, assets));
}

function structLabel(field: StructFieldType): string {
    return field.typeName ?? "the struct";
}

function encodeStruct(field: StructFieldType, value: unknown, context: FieldEncodeContext, path: string): SceneJsonValue {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw fieldValueError(path, `an object holding ${structLabel(field)}'s fields`, value);
    const values = value as Record<string, unknown>;
    const encoded: SceneJsonObject = {};
    for (const member of field.fields) encoded[member.key] = encodeFieldValue(member, values[member.key], context, `${path}.${member.key}`);
    return encoded;
}

function decodeStruct(field: StructFieldType, json: SceneJsonValue, context: FieldDecodeContext, path: string): object {
    if (!isSceneJsonObject(json)) throw fieldValueError(path, `an object of ${structLabel(field)}'s fields`, json);
    const unknownKeys = Object.keys(json).filter(key => !field.fields.some(member => member.key === key));
    if (context.reportSchemaChange === undefined) {
        if (unknownKeys.length > 0) {
            throw new Error(`Scene field ${path}: ${structLabel(field)} has no field${unknownKeys.length === 1 ? "" : "s"} ${unknownKeys.map(key => JSON.stringify(key)).join(", ")}`);
        }
    } else {
        const missingKeys = field.fields.filter(member => json[member.key] === undefined).map(member => member.key);
        context.reportSchemaChange(field.typeName ?? path, missingKeys, unknownKeys);
    }
    const target = createStructValue(field, context.fieldTypes, path) as Record<string, unknown>;
    for (const member of field.fields) {
        const memberJson = json[member.key];
        if (memberJson !== undefined) target[member.key] = decodeFieldValue(member, memberJson, context, `${path}.${member.key}`);
    }
    return target;
}

function encodeList(element: FieldType, value: unknown, context: FieldEncodeContext, path: string): SceneJsonValue {
    if (!Array.isArray(value)) throw fieldValueError(path, "an array", value);
    const encoded: SceneJsonValue[] = [];
    for (let i = 0; i < value.length; i++) encoded.push(encodeFieldValue(element, value[i], context, `${path}[${i}]`));
    return encoded;
}

function decodeList(element: FieldType, json: SceneJsonValue, context: FieldDecodeContext, path: string): unknown[] {
    if (!Array.isArray(json)) throw fieldValueError(path, "an array", json);
    return json.map((item, i) => decodeFieldValue(element, item, context, `${path}[${i}]`));
}

export function encodeFieldValue(field: FieldType, value: unknown, context: FieldEncodeContext, path: string): SceneJsonValue {
    switch (field.kind) {
        case "number":
            if (field.nullable === true && value === undefined) return null;
            if (field.nullable === true && typeof value !== "number") throw fieldValueError(path, "a number or undefined", value);
            return encodeNumber(value, path);
        case "integer":
            if (field.nullable === true && value === undefined) return null;
            if (field.nullable === true && (typeof value !== "number" || !Number.isInteger(value))) throw fieldValueError(path, "a whole number or undefined", value);
            return encodeInteger(value, path);
        case "boolean":
            if (typeof value !== "boolean") throw fieldValueError(path, "true or false", value);
            return value;
        case "string":
            if (typeof value === "string") return value;
            if (field.nullable && value === undefined) return null;
            throw fieldValueError(path, field.nullable ? "a string or undefined" : "a string", value);
        case "textLines":
            if (!isStringArray(value)) throw fieldValueError(path, "an array of strings", value);
            return [...value];
        case "vec2":
            return encodeVector(value, VEC2_LENGTH, path);
        case "vec3":
            return encodeVector(value, VEC3_LENGTH, path);
        case "rotation":
            return encodeVector(value, QUATERNION_LENGTH, path);
        case "rgb":
            if (!isPackedRgb(value)) throw fieldValueError(path, "a packed 0xRRGGBB colour", value);
            return hexColorOf(value);
        case "textColor":
            return encodeTextColor(value, path);
        case "enum": {
            const member = field.members.find(candidate => candidate.value === value);
            if (member === undefined) throw fieldValueError(path, `one of ${field.members.map(candidate => describeJson(candidate.value)).join(", ")}`, value);
            return member.name;
        }
        case "entity":
            return encodeEntity(value, context, path);
        case "asset":
            return encodeAsset(field, value, context, path);
        case "list":
            return encodeList(field.element, value, context, path);
        case "struct":
            return encodeStruct(field, value, context, path);
        case "custom":
            return customFieldTypeOf(context.fieldTypes, field.typeName, path).encode(value, path);
    }
}

export function decodeFieldValue(field: FieldType, json: SceneJsonValue, context: FieldDecodeContext, path: string): unknown {
    switch (field.kind) {
        case "number":
            if (field.nullable === true && json === null) return undefined;
            return decodeNumber(json, path);
        case "integer":
            if (field.nullable === true && json === null) return undefined;
            return decodeInteger(json, path);
        case "boolean":
            if (typeof json !== "boolean") throw fieldValueError(path, "true or false", json);
            return json;
        case "string":
            if (typeof json === "string") return json;
            if (field.nullable && json === null) return undefined;
            throw fieldValueError(path, field.nullable ? "a string or null" : "a string", json);
        case "textLines":
            if (!isStringArray(json)) throw fieldValueError(path, "an array of strings", json);
            return [...json];
        case "vec2": {
            const [x, y] = decodeVectorComponents(json, VEC2_LENGTH, path);
            return Vec2.alloc(x, y);
        }
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
            if (member === undefined) throw fieldValueError(path, `one of ${field.members.map(candidate => JSON.stringify(candidate.name)).join(", ")}`, json);
            return member.value;
        }
        case "entity":
            return decodeEntity(json, context, path);
        case "asset":
            return decodeAsset(field, json, context, path);
        case "list":
            return decodeList(field.element, json, context, path);
        case "struct":
            return decodeStruct(field, json, context, path);
        case "custom":
            return customFieldTypeOf(context.fieldTypes, field.typeName, path).decode(json, path);
    }
}
