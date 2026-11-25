import type {Entity} from "../../engine/core";
import {deflate} from "../../engine/assets/image/deflate";
import {encodePng} from "../../engine/assets/image/png";
import {projectRelativePath} from "../../engine/project/projectPaths";
import type {SpritePatternSource} from "../../engine/rendering/2d/spritePattern";
import {
    decodeSpritePatternJson,
    encodeSpritePatternJson,
    isSpritePatternFile,
    isSpritePatternJson,
    parseSpritePatternFile,
    SPRITE_PATTERN_FILE_SUFFIX,
    spritePatternFileJson,
    spritePatternFileText,
} from "../../engine/rendering/2d/spritePatternFile";
import {decodeBase64} from "../../engine/scene/base64";
import {isSceneJsonObject} from "../../engine/scene/sceneDocument";
import type {SceneJsonValue} from "../../engine/scene";
import type {EditorComponentDetails, EditorFieldValue} from "../editorProtocol";
import {FileExistenceCommand, newFileSnapshot} from "./fileUndo";
import {assetPathOf, inlineImageSize} from "./fieldValueText";
import {uniqueChildPath} from "./projectFiles";
import {CompositeCommand, FieldsCommand, HOLDS_NO_ENTITIES} from "./undoStack";
import type {EntityRefs, FieldChange, UndoCommand} from "./undoStack";

export const EXTRACTED_IMAGE_FOLDER = "assets";
export const PNG_EXTENSION = ".png";

const RGBA_BYTES_PER_PIXEL = 4;

export interface ImageFieldTarget {
    readonly entities: readonly Entity[];
    readonly typeName: string;
    readonly key: string;
}

export interface InlineImage {
    readonly width: number;
    readonly height: number;
    readonly rgba: Uint8Array;
}

export interface ImageFileFormat {
    readonly extension: string;
    readonly title: string;

    holds(value: EditorFieldValue): boolean;

    fileContents(inline: SceneJsonValue): Uint8Array | string | undefined;
}

export interface ImageExtraction {
    readonly path: string;
    readonly contents: Uint8Array | string;
    readonly change: FieldChange;
}

function isImageExtent(value: SceneJsonValue | undefined): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function inlineImageOf(value: SceneJsonValue): InlineImage | undefined {
    if (!isSceneJsonObject(value)) return undefined;
    const {width, height, rgbaBase64} = value;
    if (!isImageExtent(width) || !isImageExtent(height) || typeof rgbaBase64 !== "string") return undefined;
    let rgba: Uint8Array;
    try {
        rgba = decodeBase64(rgbaBase64);
    } catch {
        return undefined;
    }
    return rgba.length === width * height * RGBA_BYTES_PER_PIXEL ? {width, height, rgba} : undefined;
}

export function inlineImagePng(image: InlineImage): Uint8Array {
    return encodePng(image.width, image.height, image.rgba, deflate);
}

function patternProblem(key: string, expectation: string): Error {
    return new Error(`${key} must be ${expectation}`);
}

export function inlinePatternOf(value: EditorFieldValue): SpritePatternSource | undefined {
    if (!isSceneJsonObject(value) || !isSpritePatternJson(value)) return undefined;
    try {
        return decodeSpritePatternJson(value, patternProblem);
    } catch {
        return undefined;
    }
}

export function patternFileText(pattern: SpritePatternSource): string {
    return spritePatternFileText(spritePatternFileJson(pattern));
}

export const PNG_IMAGE_FILE: ImageFileFormat = {
    extension: PNG_EXTENSION,
    title: "PNG",
    holds: value => inlineImageSize(value) !== undefined,
    fileContents: inline => {
        const image = inlineImageOf(inline);
        return image === undefined ? undefined : inlineImagePng(image);
    },
};

export const PATTERN_IMAGE_FILE: ImageFileFormat = {
    extension: SPRITE_PATTERN_FILE_SUFFIX,
    title: "sprite pattern",
    holds: value => inlinePatternOf(value) !== undefined,
    fileContents: inline => {
        const pattern = inlinePatternOf(inline);
        return pattern === undefined ? undefined : patternFileText(pattern);
    },
};

const IMAGE_FILE_FORMATS: readonly ImageFileFormat[] = [PNG_IMAGE_FILE, PATTERN_IMAGE_FILE];

export function imageFileFormatOf(value: EditorFieldValue): ImageFileFormat | undefined {
    return IMAGE_FILE_FORMATS.find(format => format.holds(value));
}

export function patternFilePathOf(value: EditorFieldValue): string | undefined {
    const path = assetPathOf(value);
    return path !== undefined && isSpritePatternFile(path) ? path : undefined;
}

function inspectableFieldKeys(component: EditorComponentDetails | undefined, matches: (value: EditorFieldValue) => boolean): string[] {
    if (component === undefined || !component.inspectable) return [];
    return Object.entries(component.fields).filter(([, value]) => matches(value)).map(([key]) => key);
}

export function extractableImageFieldKeys(component: EditorComponentDetails | undefined): string[] {
    return inspectableFieldKeys(component, value => imageFileFormatOf(value) !== undefined);
}

export function patternFileFieldKeys(component: EditorComponentDetails | undefined): string[] {
    return inspectableFieldKeys(component, value => patternFilePathOf(value) !== undefined);
}

export function extractedImagePath(existing: ReadonlySet<string>, stem: string, format: ImageFileFormat): string {
    return uniqueChildPath(existing, EXTRACTED_IMAGE_FOLDER, stem, format.extension);
}

export function extractedImagePathProblem(path: string, existing: ReadonlySet<string>, format: ImageFileFormat): string | undefined {
    const relative = projectRelativePath(path.trim());
    if (relative === undefined) return `Give a path inside the project folder, such as ${EXTRACTED_IMAGE_FOLDER}/sprite${format.extension}`;
    if (!relative.toLowerCase().endsWith(format.extension)) return `The file name ends with ${format.extension}`;
    if (existing.has(relative)) return `${relative} already exists`;
    return undefined;
}

export function imageExtraction(entity: Entity, typeName: string, key: string, inline: SceneJsonValue, path: string, format: ImageFileFormat): ImageExtraction {
    const contents = format.fileContents(inline);
    if (contents === undefined) throw new Error(`${typeName}.${key} does not hold an inline image to save as ${format.title}`);
    return {
        path,
        contents,
        change: {entity, typeName, key, before: inline, after: {path}, entityShape: HOLDS_NO_ENTITIES},
    };
}

export function imageExtractionCommand(refs: EntityRefs, label: string, extraction: ImageExtraction): UndoCommand {
    return new CompositeCommand(label, [
        new FileExistenceCommand(label, [newFileSnapshot(extraction.path, extraction.contents)], true),
        FieldsCommand.record(refs, label, [extraction.change]),
    ]);
}

export function patternInlining(entity: Entity, typeName: string, key: string, path: string, fileText: string): FieldChange {
    const pattern = parseSpritePatternFile(fileText, path);
    return {entity, typeName, key, before: {path}, after: encodeSpritePatternJson(pattern), entityShape: HOLDS_NO_ENTITIES};
}
