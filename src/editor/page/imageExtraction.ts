import type {Entity} from "../../engine/core";
import {deflate} from "../../engine/assets/image/deflate";
import {encodePng} from "../../engine/assets/image/png";
import {projectRelativePath} from "../../engine/project/projectPaths";
import {decodeBase64} from "../../engine/scene/base64";
import {isSceneJsonObject} from "../../engine/scene/sceneDocument";
import type {SceneJsonValue} from "../../engine/scene";
import type {EditorComponentDetails} from "../editorProtocol";
import {FileExistenceCommand, newFileSnapshot} from "./fileUndo";
import {isInlineAssetSummary} from "./fieldValueText";
import {uniqueChildPath} from "./projectFiles";
import {CompositeCommand, FieldsCommand, HOLDS_NO_ENTITIES} from "./undoStack";
import type {EntityRefs, FieldChange, UndoCommand} from "./undoStack";

export const EXTRACTED_IMAGE_FOLDER = "assets";
export const PNG_EXTENSION = ".png";

const RGBA_BYTES_PER_PIXEL = 4;

export interface InlineImageTarget {
    readonly entities: readonly Entity[];
    readonly typeName: string;
    readonly key: string;
}

export interface InlineImage {
    readonly width: number;
    readonly height: number;
    readonly rgba: Uint8Array;
}

export interface ImageExtraction {
    readonly path: string;
    readonly png: Uint8Array;
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

export function inlineImageFieldKeys(component: EditorComponentDetails | undefined): string[] {
    if (component === undefined || !component.inspectable) return [];
    return Object.entries(component.fields).filter(([, value]) => isInlineAssetSummary(value)).map(([key]) => key);
}

export function extractedImagePath(existing: ReadonlySet<string>, stem: string): string {
    return uniqueChildPath(existing, EXTRACTED_IMAGE_FOLDER, stem, PNG_EXTENSION);
}

export function extractedImagePathProblem(path: string, existing: ReadonlySet<string>): string | undefined {
    const relative = projectRelativePath(path.trim());
    if (relative === undefined) return `Give a path inside the project folder, such as ${EXTRACTED_IMAGE_FOLDER}/sprite${PNG_EXTENSION}`;
    if (!relative.toLowerCase().endsWith(PNG_EXTENSION)) return `The file name ends with ${PNG_EXTENSION}`;
    if (existing.has(relative)) return `${relative} already exists`;
    return undefined;
}

export function imageExtraction(entity: Entity, typeName: string, key: string, inline: SceneJsonValue, path: string): ImageExtraction {
    const image = inlineImageOf(inline);
    if (image === undefined) throw new Error(`${typeName}.${key} does not hold an inline image`);
    return {
        path,
        png: inlineImagePng(image),
        change: {entity, typeName, key, before: inline, after: {path}, entityShape: HOLDS_NO_ENTITIES},
    };
}

export function imageExtractionCommand(refs: EntityRefs, label: string, extraction: ImageExtraction): UndoCommand {
    return new CompositeCommand(label, [
        new FileExistenceCommand(label, [newFileSnapshot(extraction.path, extraction.png)], true),
        FieldsCommand.record(refs, label, [extraction.change]),
    ]);
}
