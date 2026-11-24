import type {Entity} from "../../engine/core";
import {describe, expect, test} from "../../engine/testing/harness";
import {decodePng} from "../../engine/assets/image/png";
import {inflate} from "../../engine/assets/image/inflate";
import {parseSpritePatternFile} from "../../engine/rendering/2d/spritePatternFile";
import {encodeBase64} from "../../engine/scene/base64";
import type {EditorComponentDetails, EditorRequest} from "../editorProtocol";
import type {ProjectEntry} from "../project/projectFileSystem";
import type {ProjectFileOperations} from "./fileUndo";
import {
    extractableImageFieldKeys,
    extractedImagePath,
    extractedImagePathProblem,
    imageExtraction,
    imageExtractionCommand,
    imageFileFormatOf,
    inlineImageOf,
    inlineImagePng,
    inlinePatternOf,
    PATTERN_IMAGE_FILE,
    patternFileFieldKeys,
    patternFilePathOf,
    patternFileText,
    patternInlining,
    PNG_IMAGE_FILE,
} from "./imageExtraction";
import {EntityRefs, FieldsCommand} from "./undoStack";
import type {EditorRequester, UndoContext} from "./undoStack";

const ENTITY = 5 as Entity;
const WIDTH = 3;
const HEIGHT = 2;
const RGBA = Uint8Array.from({length: WIDTH * HEIGHT * 4}, (_, i) => (i * 41 + 7) & 255);
const INLINE = {width: WIDTH, height: HEIGHT, rgbaBase64: encodeBase64(RGBA)};
const PATH = "assets/Player.png";
const PATTERN_PATH = "assets/Player.pattern.json";
const INLINE_PATTERN = {rows: ["#o", "oo"], palette: [{char: "#", rgb: "#ff0000"}, {char: "o", rgb: "#00ff00"}]};

class MemoryFiles implements ProjectFileOperations {
    public readonly files = new Map<string, Uint8Array>();

    public async list(): Promise<readonly ProjectEntry[]> {
        return [...this.files].map(([path, contents]): ProjectEntry => ({path, kind: "file", size: contents.length, mtimeMs: 0}));
    }

    public async read(path: string): Promise<Uint8Array> {
        const contents = this.files.get(path);
        if (contents === undefined) throw new Error(`no file ${path}`);
        return contents;
    }

    public async write(path: string, contents: Uint8Array | string): Promise<void> {
        this.files.set(path, typeof contents === "string" ? new TextEncoder().encode(contents) : contents);
    }

    public async remove(path: string): Promise<void> {
        this.files.delete(path);
    }

    public async rename(): Promise<void> {
        throw new Error("not used");
    }

    public async makeDirectory(): Promise<void> {
    }
}

function recordingContext(): {readonly context: UndoContext, readonly requests: EditorRequest[], readonly files: MemoryFiles} {
    const requests: EditorRequest[] = [];
    const client = {request: async (request: EditorRequest) => {
        requests.push(request);
        return {values: []};
    }} as unknown as EditorRequester;
    const files = new MemoryFiles();
    return {context: {client, refs: new EntityRefs(), files}, requests, files};
}

describe("inline image extraction", () => {
    test("an inline image encodes to a PNG that decodes to the same pixels", () => {
        const image = inlineImageOf(INLINE);
        expect(image?.width).toBe(WIDTH);
        const decoded = decodePng(inlineImagePng(image!), {inflate});
        expect([decoded.width, decoded.height]).toEqual([WIDTH, HEIGHT]);
        expect(Array.from(decoded.rgba)).toEqual(Array.from(RGBA));
    });

    test("only a well-formed inline encoding counts as an image", () => {
        expect(inlineImageOf({path: PATH})).toBeUndefined();
        expect(inlineImageOf(null)).toBeUndefined();
        expect(inlineImageOf({...INLINE, width: WIDTH + 1})).toBeUndefined();
        expect(inlineImageOf({...INLINE, rgbaBase64: "not base64!"})).toBeUndefined();
        expect(inlineImageOf({...INLINE, height: -1})).toBeUndefined();
    });

    test("the default file goes in assets, named after the entity, and never over an existing file", () => {
        expect(extractedImagePath(new Set(), "Player", PNG_IMAGE_FILE)).toBe(PATH);
        expect(extractedImagePath(new Set(), "Player", PATTERN_IMAGE_FILE)).toBe(PATTERN_PATH);
        const taken = new Set([PATH]);
        const next = extractedImagePath(taken, "Player", PNG_IMAGE_FILE);
        expect(next.startsWith("assets/Player")).toBe(true);
        expect(next.endsWith(".png")).toBe(true);
        expect(taken.has(next)).toBe(false);
    });

    test("a chosen path must be a new PNG inside the project", () => {
        const existing = new Set([PATH]);
        expect(extractedImagePathProblem("assets/Enemy.png", existing, PNG_IMAGE_FILE)).toBeUndefined();
        expect(extractedImagePathProblem("sprites/Enemy.PNG", existing, PNG_IMAGE_FILE)).toBeUndefined();
        expect(extractedImagePathProblem(PATH, existing, PNG_IMAGE_FILE)).toBe(`${PATH} already exists`);
        expect(extractedImagePathProblem("assets/Enemy.jpg", existing, PNG_IMAGE_FILE)).toBe("The file name ends with .png");
        expect(extractedImagePathProblem("../Enemy.png", existing, PNG_IMAGE_FILE)?.startsWith("Give a path inside the project folder")).toBe(true);
        expect(extractedImagePathProblem(PATTERN_PATH, existing, PATTERN_IMAGE_FILE)).toBeUndefined();
        expect(extractedImagePathProblem("assets/Enemy.json", existing, PATTERN_IMAGE_FILE)).toBe("The file name ends with .pattern.json");
    });

    test("an inline pixel image saves as a PNG and an inline pattern as a sprite pattern file", () => {
        expect(imageFileFormatOf(INLINE)).toBe(PNG_IMAGE_FILE);
        expect(imageFileFormatOf({inline: {width: WIDTH, height: HEIGHT}})).toBe(PNG_IMAGE_FILE);
        expect(imageFileFormatOf(INLINE_PATTERN)).toBe(PATTERN_IMAGE_FILE);
        expect(imageFileFormatOf({path: PATH})).toBeUndefined();
        expect(imageFileFormatOf({rows: ["#"], palette: [{char: "#", rgb: "red"}]})).toBeUndefined();
        expect(inlinePatternOf({rows: "#", palette: []})).toBeUndefined();
        expect(inlinePatternOf(null)).toBeUndefined();
    });

    test("inline image and pattern fields of an inspectable component are offered for extraction, pattern file fields for inlining", () => {
        const component: EditorComponentDetails = {
            typeName: "Sprite", inspectable: true, inferred: false,
            fields: {image: {inline: {width: WIDTH, height: HEIGHT}}, mask: {path: PATH}, outline: INLINE_PATTERN, shadow: {path: PATTERN_PATH}, tint: "#ffffff"},
        };
        expect(extractableImageFieldKeys(component)).toEqual(["image", "outline"]);
        expect(extractableImageFieldKeys({...component, inspectable: false})).toEqual([]);
        expect(extractableImageFieldKeys(undefined)).toEqual([]);
        expect(patternFileFieldKeys(component)).toEqual(["shadow"]);
        expect(patternFileFieldKeys({...component, inspectable: false})).toEqual([]);
        expect(patternFilePathOf({path: "art/Ship.PATTERN.JSON"})).toBe("art/Ship.PATTERN.JSON");
        expect(patternFilePathOf({path: PATH})).toBeUndefined();
    });

    test("the edit swaps the inline value for the file, and undo restores the pixels before removing the file", async () => {
        const extraction = imageExtraction(ENTITY, "Sprite", "image", INLINE, PATH, PNG_IMAGE_FILE);
        expect(extraction.change.before).toEqual(INLINE);
        expect(extraction.change.after).toEqual({path: PATH});
        const {context, requests, files} = recordingContext();
        await files.write(PATH, extraction.contents);
        const command = imageExtractionCommand(context.refs, "Extract Sprite.image", extraction);

        await command.undo(context);
        expect(requests).toEqual([{op: "setFields", edits: [{entity: ENTITY, typeName: "Sprite", key: "image", value: INLINE}]}]);
        expect(files.files.has(PATH)).toBe(false);

        await command.redo(context);
        expect(Array.from(files.files.get(PATH)!)).toEqual(Array.from(extraction.contents as Uint8Array));
        expect(requests[1]).toEqual({op: "setFields", edits: [{entity: ENTITY, typeName: "Sprite", key: "image", value: {path: PATH}}]});
    });

    test("extracting a value that is not an inline image fails naming the field", () => {
        expect(() => imageExtraction(ENTITY, "Sprite", "image", {path: PATH}, PATH, PNG_IMAGE_FILE)).toThrow("Sprite.image does not hold an inline image to save as PNG");
        expect(() => imageExtraction(ENTITY, "Sprite", "image", INLINE, PATTERN_PATH, PATTERN_IMAGE_FILE)).toThrow("Sprite.image does not hold an inline image to save as sprite pattern");
    });

    test("an inline pattern extracts to a pattern file that reads back to the same pattern, and undo restores the pattern before removing the file", async () => {
        const extraction = imageExtraction(ENTITY, "Sprite", "image", INLINE_PATTERN, PATTERN_PATH, PATTERN_IMAGE_FILE);
        expect(extraction.contents).toBe(patternFileText(inlinePatternOf(INLINE_PATTERN)!));
        expect(parseSpritePatternFile(extraction.contents, PATTERN_PATH)).toEqual(inlinePatternOf(INLINE_PATTERN)!);
        expect(extraction.change.after).toEqual({path: PATTERN_PATH});
        const {context, requests, files} = recordingContext();
        await files.write(PATTERN_PATH, extraction.contents);
        const command = imageExtractionCommand(context.refs, "Extract Sprite.image", extraction);

        await command.undo(context);
        expect(requests).toEqual([{op: "setFields", edits: [{entity: ENTITY, typeName: "Sprite", key: "image", value: INLINE_PATTERN}]}]);
        expect(files.files.has(PATTERN_PATH)).toBe(false);

        await command.redo(context);
        expect(new TextDecoder().decode(files.files.get(PATTERN_PATH)!)).toBe(extraction.contents);
    });
});

describe("pattern file inlining", () => {
    test("a pattern file path becomes the file's rows and palette, and undo puts the path back", async () => {
        const change = patternInlining(ENTITY, "Sprite", "image", PATTERN_PATH, patternFileText(inlinePatternOf(INLINE_PATTERN)!));
        expect(change.before).toEqual({path: PATTERN_PATH});
        expect(change.after).toEqual(INLINE_PATTERN);
        const {context, requests} = recordingContext();
        const command = FieldsCommand.record(context.refs, "Inline Sprite.image", [change]);
        await command.undo(context);
        await command.redo(context);
        expect(requests).toEqual([
            {op: "setFields", edits: [{entity: ENTITY, typeName: "Sprite", key: "image", value: {path: PATTERN_PATH}}]},
            {op: "setFields", edits: [{entity: ENTITY, typeName: "Sprite", key: "image", value: INLINE_PATTERN}]},
        ]);
    });

    test("a file that is not a sprite pattern fails naming the file", () => {
        expect(() => patternInlining(ENTITY, "Sprite", "image", PATTERN_PATH, "{}")).toThrow(`Sprite pattern "${PATTERN_PATH}": format must be`);
    });
});
