import type {Entity} from "../../engine/core";
import {Quaternions} from "../../engine/math/quaternions";
import {asFloat32Array, Vec3, Vec4} from "../../engine/math/types/vec";
import {isSceneJsonObject} from "../../engine/scene/sceneDocument";
import type {SceneJsonValue} from "../../engine/scene";
import type {EditorFieldValue, InlineSpriteImageSummary} from "../editorProtocol";

export type ParsedFieldText =
    | {readonly valid: true, readonly value: SceneJsonValue}
    | {readonly valid: false, readonly reason: string};

export type EulerDegrees = readonly [x: number, y: number, z: number];

export type ParsedEulerDegrees =
    | {readonly valid: true, readonly degrees: EulerDegrees}
    | {readonly valid: false, readonly reason: string};

export type TextColorMode = "default" | "palette" | "rgb";

export const TEXT_COLOR_MODES: readonly TextColorMode[] = ["default", "palette", "rgb"];

export interface StringNullability {
    readonly nullable: boolean;
}

export interface TextColorParts {
    readonly mode: TextColorMode;
    readonly text: string;
}

export const VEC3_COMPONENT_COUNT = 3;
export const QUATERNION_COMPONENT_COUNT = 4;
export const NOT_A_NUMBER_WIRE = "NaN";
export const POSITIVE_INFINITY_WIRE = "Infinity";
export const NEGATIVE_INFINITY_WIRE = "-Infinity";
export const PALETTE_INDEX_LIMIT = 256;
export const DEFAULT_PALETTE_INDEX = 7;
export const DEFAULT_RGB_TEXT = "#ffffff";
export const EULER_DISPLAY_DECIMALS = 3;
export const NO_ENTITY_OPTION_VALUE = "";

const FLOAT32_MAX_SIGNIFICANT_DIGITS = 9;
const DEFAULT_TEXT_COLOR_WIRE = "default";
const HEX_COLOR_PREFIX = "#";
const HEX_COLOR_TEXT = /^#?([0-9a-fA-F]{6})$/;
const LINE_BREAK = /\r?\n/;
const LINE_SEPARATOR = "\n";
const FALLBACK_RGB_TEXT = "#000000";
const ZYX_ORDER: Quaternions.EulerOrder = "ZYX";
const IN_DEGREES = {deg: true};
const UNREADABLE_ROTATION: EulerDegrees = [Number.NaN, Number.NaN, Number.NaN];
const NON_FINITE_BY_WIRE: ReadonlyMap<string, number> = new Map([
    [NOT_A_NUMBER_WIRE, Number.NaN],
    [POSITIVE_INFINITY_WIRE, Number.POSITIVE_INFINITY],
    [NEGATIVE_INFINITY_WIRE, Number.NEGATIVE_INFINITY],
]);

function valid(value: SceneJsonValue): ParsedFieldText {
    return {valid: true, value};
}

function invalid(reason: string): ParsedFieldText {
    return {valid: false, reason};
}

function fallbackText(value: EditorFieldValue): string {
    return JSON.stringify(value) ?? "";
}

export function entityLabel(entity: Entity, name: string | null): string {
    return name ?? `Entity ${entity}`;
}

export function wireNumber(value: number): SceneJsonValue {
    if (Number.isNaN(value)) return NOT_A_NUMBER_WIRE;
    if (value === Number.POSITIVE_INFINITY) return POSITIVE_INFINITY_WIRE;
    if (value === Number.NEGATIVE_INFINITY) return NEGATIVE_INFINITY_WIRE;
    return value + 0;
}

export function numberOfWire(value: SceneJsonValue): number | undefined {
    if (typeof value === "number") return value;
    return typeof value === "string" ? NON_FINITE_BY_WIRE.get(value) : undefined;
}

export function numberText(value: EditorFieldValue): string {
    if (typeof value === "number") return String(value);
    if (typeof value === "string") return value;
    return fallbackText(value);
}

export function float32Text(value: number): string {
    if (!Number.isFinite(value) || Math.fround(value) !== value) return String(value);
    for (let digits = 1; digits < FLOAT32_MAX_SIGNIFICANT_DIGITS; digits++) {
        const shorter = Number(value.toPrecision(digits));
        if (Math.fround(shorter) === value) return String(shorter);
    }
    return String(value);
}

function float32ComponentText(value: SceneJsonValue): string {
    return typeof value === "number" ? float32Text(value) : numberText(value);
}

export function parseNumberText(text: string): ParsedFieldText {
    const trimmed = text.trim();
    if (NON_FINITE_BY_WIRE.has(trimmed)) return valid(trimmed);
    const parsed = Number(trimmed);
    if (trimmed.length === 0 || !Number.isFinite(parsed)) {
        return invalid(`"${trimmed}" is not a number (digits, ${NOT_A_NUMBER_WIRE}, ${POSITIVE_INFINITY_WIRE} or ${NEGATIVE_INFINITY_WIRE})`);
    }
    return valid(parsed + 0);
}

export function parseFiniteNumberText(text: string): ParsedFieldText {
    const trimmed = text.trim();
    const parsed = Number(trimmed);
    if (trimmed.length === 0 || !Number.isFinite(parsed)) return invalid(`"${trimmed}" is not a finite number`);
    return valid(parsed + 0);
}

export function parseIntegerText(text: string): ParsedFieldText {
    const trimmed = text.trim();
    const parsed = Number(trimmed);
    if (trimmed.length === 0 || !Number.isInteger(parsed)) return invalid(`"${trimmed}" is not a whole number`);
    return valid(parsed + 0);
}

function vec3Components(value: EditorFieldValue): SceneJsonValue[] | undefined {
    return Array.isArray(value) && value.length === VEC3_COMPONENT_COUNT ? value : undefined;
}

export function vec3Texts(value: EditorFieldValue): string[] {
    const components = vec3Components(value);
    if (components === undefined) return Array.from({length: VEC3_COMPONENT_COUNT}, () => fallbackText(value));
    return components.map(float32ComponentText);
}

export function vec3WithComponentText(value: EditorFieldValue, index: number, text: string): ParsedFieldText {
    const components = vec3Components(value);
    if (components === undefined) return invalid(`The current value ${fallbackText(value)} is not three numbers`);
    const parsed = parseNumberText(text);
    if (!parsed.valid) return parsed;
    const updated = [...components];
    updated[index] = parsed.value;
    return valid(updated);
}

export function eulerDegreesOfQuaternion(value: EditorFieldValue): EulerDegrees {
    if (!Array.isArray(value) || value.length !== QUATERNION_COMPONENT_COUNT) return UNREADABLE_ROTATION;
    const [x, y, z, w] = value.map(numberOfWire);
    if (x === undefined || y === undefined || z === undefined || w === undefined) return UNREADABLE_ROTATION;
    const euler = asFloat32Array(Quaternions.quatToEulerZYXInto(Vec3.alloc(), Vec4.alloc(x, y, z, w), IN_DEGREES));
    return [euler[0], euler[1], euler[2]];
}

export function quaternionOfEulerDegrees(degrees: EulerDegrees): SceneJsonValue {
    const [x, y, z] = degrees;
    const quaternion = Quaternions.eulerToQuatInto(Vec4.alloc(), Vec3.alloc(x, y, z), ZYX_ORDER, IN_DEGREES);
    return Array.from(asFloat32Array(quaternion), wireNumber);
}

export function eulerDegreeText(degrees: number): string {
    return String(Number(degrees.toFixed(EULER_DISPLAY_DECIMALS)) + 0);
}

export function parseEulerDegreeTexts(texts: readonly string[]): ParsedEulerDegrees {
    const degrees: number[] = [];
    for (const text of texts) {
        const parsed = parseFiniteNumberText(text);
        if (!parsed.valid) return parsed;
        degrees.push(parsed.value as number);
    }
    if (degrees.length !== VEC3_COMPONENT_COUNT) return {valid: false, reason: `A rotation needs ${VEC3_COMPONENT_COUNT} angles`};
    return {valid: true, degrees: [degrees[0], degrees[1], degrees[2]]};
}

function normalizedHexColor(text: string): string | undefined {
    const match = HEX_COLOR_TEXT.exec(text.trim());
    return match === null ? undefined : HEX_COLOR_PREFIX + match[1].toLowerCase();
}

export function rgbText(value: EditorFieldValue): string {
    return typeof value === "string" ? normalizedHexColor(value) ?? FALLBACK_RGB_TEXT : FALLBACK_RGB_TEXT;
}

export function parseRgbText(text: string): ParsedFieldText {
    const hex = normalizedHexColor(text);
    return hex === undefined ? invalid(`"${text.trim()}" is not a "#rrggbb" colour`) : valid(hex);
}

export function textColorParts(value: EditorFieldValue): TextColorParts {
    if (value === DEFAULT_TEXT_COLOR_WIRE) return {mode: "default", text: ""};
    if (isSceneJsonObject(value) && typeof value.palette === "number") return {mode: "palette", text: String(value.palette)};
    if (typeof value === "string") return {mode: "rgb", text: rgbText(value)};
    return {mode: "rgb", text: fallbackText(value)};
}

export function textForTextColorMode(mode: TextColorMode, currentText: string): string {
    switch (mode) {
        case "default":
            return "";
        case "palette":
            return parseTextColorParts({mode, text: currentText}).valid ? currentText : String(DEFAULT_PALETTE_INDEX);
        case "rgb":
            return normalizedHexColor(currentText) ?? DEFAULT_RGB_TEXT;
    }
}

export function parseTextColorParts(parts: TextColorParts): ParsedFieldText {
    switch (parts.mode) {
        case "default":
            return valid(DEFAULT_TEXT_COLOR_WIRE);
        case "palette": {
            const trimmed = parts.text.trim();
            const index = Number(trimmed);
            if (trimmed.length === 0 || !Number.isInteger(index) || index < 0 || index >= PALETTE_INDEX_LIMIT) {
                return invalid(`"${trimmed}" is not a palette index in [0, ${PALETTE_INDEX_LIMIT - 1}]`);
            }
            return valid({palette: index});
        }
        case "rgb":
            return parseRgbText(parts.text);
    }
}

export function stringText(value: EditorFieldValue): string {
    if (typeof value === "string") return value;
    if (value === null) return "";
    return fallbackText(value);
}

export function parseStringText(text: string, {nullable}: StringNullability): SceneJsonValue {
    return nullable && text.length === 0 ? null : text;
}

export function textLinesText(value: EditorFieldValue): string {
    if (Array.isArray(value) && value.every(line => typeof line === "string")) return value.join(LINE_SEPARATOR);
    return fallbackText(value);
}

export function parseTextLinesText(text: string): SceneJsonValue {
    return text.length === 0 ? [] : text.split(LINE_BREAK);
}

export function entityOptionValue(value: EditorFieldValue): string {
    return typeof value === "number" ? String(value) : NO_ENTITY_OPTION_VALUE;
}

export function parseEntityOptionValue(text: string): SceneJsonValue {
    return text === NO_ENTITY_OPTION_VALUE ? null : Number(text);
}

export function isInlineAssetSummary(value: EditorFieldValue): value is InlineSpriteImageSummary {
    if (!isSceneJsonObject(value)) return false;
    const inline = value.inline;
    return isSceneJsonObject(inline) && typeof inline.width === "number" && typeof inline.height === "number";
}

export function assetText(value: EditorFieldValue): string {
    if (value === null) return "";
    if (isInlineAssetSummary(value)) return `(inline ${value.inline.width}x${value.inline.height})`;
    if (isSceneJsonObject(value) && typeof value.path === "string") return value.path;
    return fallbackText(value);
}

export function parseAssetPathText(text: string): SceneJsonValue {
    const path = text.trim();
    return path.length === 0 ? null : {path};
}
