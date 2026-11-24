import type {Entity} from "../../engine/core";
import {describe, expect, test} from "../../engine/testing/harness";
import {decodePng} from "../../engine/assets/image/png";
import {inflate} from "../../engine/assets/image/inflate";
import {encodeBase64} from "../../engine/scene/base64";
import type {EditorComponentDetails, EditorRequest} from "../editorProtocol";
import type {ProjectEntry} from "../project/projectFileSystem";
import type {ProjectFileOperations} from "./fileUndo";
import {
    extractedImagePath,
    extractedImagePathProblem,
    imageExtraction,
    imageExtractionCommand,
    inlineImageFieldKeys,
    inlineImageOf,
    inlineImagePng,
} from "./imageExtraction";
import {EntityRefs} from "./undoStack";
import type {EditorRequester, UndoContext} from "./undoStack";

const ENTITY = 5 as Entity;
const WIDTH = 3;
const HEIGHT = 2;
const RGBA = Uint8Array.from({length: WIDTH * HEIGHT * 4}, (_, i) => (i * 41 + 7) & 255);
const INLINE = {width: WIDTH, height: HEIGHT, rgbaBase64: encodeBase64(RGBA)};
const PATH = "assets/Player.png";

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
        expect(extractedImagePath(new Set(), "Player")).toBe(PATH);
        const taken = new Set([PATH]);
        const next = extractedImagePath(taken, "Player");
        expect(next.startsWith("assets/Player")).toBe(true);
        expect(next.endsWith(".png")).toBe(true);
        expect(taken.has(next)).toBe(false);
    });

    test("a chosen path must be a new PNG inside the project", () => {
        const existing = new Set([PATH]);
        expect(extractedImagePathProblem("assets/Enemy.png", existing)).toBeUndefined();
        expect(extractedImagePathProblem("sprites/Enemy.PNG", existing)).toBeUndefined();
        expect(extractedImagePathProblem(PATH, existing)).toBe(`${PATH} already exists`);
        expect(extractedImagePathProblem("assets/Enemy.jpg", existing)).toBe("The file name ends with .png");
        expect(extractedImagePathProblem("../Enemy.png", existing)?.startsWith("Give a path inside the project folder")).toBe(true);
    });

    test("only summarised inline image fields of an inspectable component are offered", () => {
        const component: EditorComponentDetails = {
            typeName: "Sprite", inspectable: true, inferred: false,
            fields: {image: {inline: {width: WIDTH, height: HEIGHT}}, mask: {path: PATH}, tint: "#ffffff"},
        };
        expect(inlineImageFieldKeys(component)).toEqual(["image"]);
        expect(inlineImageFieldKeys({...component, inspectable: false})).toEqual([]);
        expect(inlineImageFieldKeys(undefined)).toEqual([]);
    });

    test("the edit swaps the inline value for the file, and undo restores the pixels before removing the file", async () => {
        const extraction = imageExtraction(ENTITY, "Sprite", "image", INLINE, PATH);
        expect(extraction.change.before).toEqual(INLINE);
        expect(extraction.change.after).toEqual({path: PATH});
        const {context, requests, files} = recordingContext();
        await files.write(PATH, extraction.png);
        const command = imageExtractionCommand(context.refs, "Extract Sprite.image", extraction);

        await command.undo(context);
        expect(requests).toEqual([{op: "setFields", edits: [{entity: ENTITY, typeName: "Sprite", key: "image", value: INLINE}]}]);
        expect(files.files.has(PATH)).toBe(false);

        await command.redo(context);
        expect(Array.from(files.files.get(PATH)!)).toEqual(Array.from(extraction.png));
        expect(requests[1]).toEqual({op: "setFields", edits: [{entity: ENTITY, typeName: "Sprite", key: "image", value: {path: PATH}}]});
    });

    test("extracting a value that is not an inline image fails naming the field", () => {
        expect(() => imageExtraction(ENTITY, "Sprite", "image", {path: PATH}, PATH)).toThrow("Sprite.image does not hold an inline image");
    });
});
