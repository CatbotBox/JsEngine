import {structFields} from "../../scene/componentSchemaBuilder";
import {migrateDocumentJson} from "../../scene/documentMigrations";
import type {DocumentMigrations} from "../../scene/documentMigrations";
import type {StructFieldType} from "../../scene/fieldSchema";
import {HEX_COLOR_EXPECTATION, hexColorOf, rgbOfHexColorText} from "../../scene/fieldValueCodec";
import {describeJson, isSceneJsonObject} from "../../scene/sceneDocument";
import type {SceneJsonObject} from "../../scene/sceneDocument";
import {SpritePatternColor} from "./spritePattern";
import type {SpritePatternSource} from "./spritePattern";

export const SPRITE_PATTERN_FILE_FORMAT = "jsengine-sprite-pattern";
export const SPRITE_PATTERN_FILE_VERSION = 1;
export const SPRITE_PATTERN_FILE_SUFFIX = ".pattern.json";
export const SPRITE_PATTERN_TYPE_NAME = "SpritePattern";
export const SPRITE_PATTERN_COLOR_TYPE_NAME = "SpritePatternColor";
export const SPRITE_PATTERN_FILE_MIGRATIONS: DocumentMigrations = {currentVersion: SPRITE_PATTERN_FILE_VERSION, steps: []};

const ROWS_KEY = "rows";
const PALETTE_KEY = "palette";
const CHAR_KEY = "char";
const RGB_KEY = "rgb";
const FILE_TEXT_INDENT_SPACES = 2;
const FILE_TEXT_END = "\n";

export type SpritePatternErrorOf = (key: string, expectation: string, actual: unknown) => Error;

export function spritePatternColorFieldType(): StructFieldType {
    return {
        kind: "struct",
        typeName: SPRITE_PATTERN_COLOR_TYPE_NAME,
        fields: structFields<SpritePatternColor>().string(CHAR_KEY).rgb(RGB_KEY).build(),
        create: () => new SpritePatternColor(),
    };
}

export function spritePatternFieldType(): StructFieldType {
    return {
        kind: "struct",
        typeName: SPRITE_PATTERN_TYPE_NAME,
        fields: [
            {key: ROWS_KEY, kind: "textLines"},
            {key: PALETTE_KEY, kind: "list", element: spritePatternColorFieldType()},
        ],
    };
}

export function isSpritePatternJson(json: SceneJsonObject): boolean {
    return json[ROWS_KEY] !== undefined;
}

export function isSpritePatternFile(path: string): boolean {
    return path.toLowerCase().endsWith(SPRITE_PATTERN_FILE_SUFFIX);
}

function decodedRows(json: unknown, errorOf: SpritePatternErrorOf): string[] {
    if (!Array.isArray(json) || !json.every(row => typeof row === "string")) throw errorOf(ROWS_KEY, "an array of strings", json);
    return json as string[];
}

function decodedColor(json: unknown, index: number, errorOf: SpritePatternErrorOf): SpritePatternColor {
    const key = `${PALETTE_KEY}[${index}]`;
    if (!isSceneJsonObject(json)) throw errorOf(key, `an object with "${CHAR_KEY}" and "${RGB_KEY}"`, json);
    const char = json[CHAR_KEY];
    if (typeof char !== "string") throw errorOf(`${key}.${CHAR_KEY}`, "a string", char);
    const rgb = rgbOfHexColorText(json[RGB_KEY]);
    if (rgb === undefined) throw errorOf(`${key}.${RGB_KEY}`, HEX_COLOR_EXPECTATION, json[RGB_KEY]);
    return new SpritePatternColor(char, rgb);
}

export function decodeSpritePatternJson(json: SceneJsonObject, errorOf: SpritePatternErrorOf): SpritePatternSource {
    const rows = decodedRows(json[ROWS_KEY], errorOf);
    const palette = json[PALETTE_KEY];
    if (!Array.isArray(palette)) throw errorOf(PALETTE_KEY, "an array", palette);
    return {rows, palette: palette.map((color, index) => decodedColor(color, index, errorOf))};
}

export function encodeSpritePatternJson(pattern: SpritePatternSource): SceneJsonObject {
    return {
        [ROWS_KEY]: [...pattern.rows],
        [PALETTE_KEY]: pattern.palette.map(color => ({[CHAR_KEY]: color.char, [RGB_KEY]: hexColorOf(color.rgb)})),
    };
}

function fileLabel(path: string | undefined): string {
    return path === undefined ? "Sprite pattern" : `Sprite pattern "${path}"`;
}

function fileError(path: string | undefined, key: string, expectation: string, actual: unknown): Error {
    return new Error(`${fileLabel(path)}: ${key} must be ${expectation}, got ${describeJson(actual)}`);
}

export function spritePatternFileJson(pattern: SpritePatternSource): SceneJsonObject {
    return {format: SPRITE_PATTERN_FILE_FORMAT, version: SPRITE_PATTERN_FILE_VERSION, ...encodeSpritePatternJson(pattern)};
}

export function spritePatternFileText(document: SceneJsonObject): string {
    return JSON.stringify(document, null, FILE_TEXT_INDENT_SPACES) + FILE_TEXT_END;
}

export function migrateSpritePatternJson(source: unknown, path?: string): SceneJsonObject {
    let value: unknown;
    try {
        value = typeof source === "string" ? JSON.parse(source) as unknown : source;
    } catch (error) {
        throw new Error(`${fileLabel(path)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isSceneJsonObject(value)) throw fileError(path, "the document", "an object", value);
    if (value.format !== SPRITE_PATTERN_FILE_FORMAT) throw fileError(path, "format", JSON.stringify(SPRITE_PATTERN_FILE_FORMAT), value.format);
    const version = value.version;
    if (typeof version !== "number" || !Number.isSafeInteger(version)) throw fileError(path, "version", "a whole number", version);
    return migrateDocumentJson(value, version, SPRITE_PATTERN_FILE_MIGRATIONS, fileLabel(path));
}

export function parseSpritePatternFile(source: unknown, path?: string): SpritePatternSource {
    const migrated = migrateSpritePatternJson(source, path);
    return decodeSpritePatternJson(migrated, (key, expectation, actual) => fileError(path, key, expectation, actual));
}
