import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import type {ProjectEntry, ProjectFileSystem} from "../project/projectFileSystem";
import type {EditorClient} from "./editorClient";
import type {EditorEventSource, EditorSession} from "./editorSession";
import {EditorWorkspace} from "./editorWorkspace";
import {MESH_PREVIEW_CLASS_NAME, MESH_PREVIEW_SIZE_PX} from "./meshPreview";
import {ProjectFilePreview} from "./projectPreview";
import {EMPTY_MESH_REASON, MAX_MESH_THUMBNAIL_BYTES} from "./projectThumbnails";

const PROJECT_NAME = "Preview fixture";
const NO_START_SCENE = null;
const IMAGE_CLASS_NAME = "project-preview-image";
const FACTS_CLASS_NAME = "project-preview-facts";
const MAX_SETTLE_TURNS = 20;
const PATTERN_FILE_TEXT = JSON.stringify({format: "jsengine-sprite-pattern", version: 1, rows: ["#.", "##"], palette: [{char: "#", rgb: "#00ff00"}]});
const CUBE_OBJ = [
    "v -1 -1 -1", "v 1 -1 -1", "v 1 1 -1", "v -1 1 -1", "v -1 -1 1", "v 1 -1 1", "v 1 1 1", "v -1 1 1",
    "f 1 2 3 4", "f 5 8 7 6", "f 1 5 6 2", "f 2 6 7 3", "f 3 7 8 4", "f 5 1 4 8",
].join("\n");
const POINTS_ONLY_OBJ = "v 0 0 0\nv 1 0 0";

interface FakeElement {
    readonly tagName: string;
    className: string;
    textContent: string | null;
    title: string;
    width: number;
    height: number;
    paints: number;
    readonly children: FakeElement[];
    readonly ownerDocument: Document;
}

function fakeDocument(): Document {
    const stored = new Map<string, string>();
    const localStorage = {getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value)};
    const document = {
        defaultView: {localStorage},
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        createElement: (tagName: string): FakeElement => {
            const element: FakeElement & Record<string, unknown> = {
                tagName,
                className: "",
                textContent: null,
                title: "",
                width: 0,
                height: 0,
                paints: 0,
                children: [],
                ownerDocument: document as unknown as Document,
                setAttribute: () => undefined,
                addEventListener: () => undefined,
                append: (...children: FakeElement[]) => void element.children.push(...children),
                replaceChildren: (...children: FakeElement[]) => void element.children.splice(0, element.children.length, ...children),
                getContext: () => ({
                    createImageData: (width: number, height: number) => ({data: new Uint8ClampedArray(width * height * 4)}),
                    putImageData: () => void element.paints++,
                }),
            };
            return element;
        },
    };
    return document as unknown as Document;
}

function ppm(width: number, height: number, rgb: readonly number[]): Uint8Array {
    const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`);
    const bytes = new Uint8Array(header.length + rgb.length);
    bytes.set(header);
    bytes.set(rgb, header.length);
    return bytes;
}

const workspaces: EditorWorkspace[] = [];

afterEach(() => {
    for (const workspace of workspaces.splice(0)) workspace.stop();
});

function previewOf(contents: ReadonlyMap<string, Uint8Array>): {preview: ProjectFilePreview, element: FakeElement, reads: string[]} {
    const reads: string[] = [];
    const read = async (path: string): Promise<Uint8Array> => {
        reads.push(path);
        const bytes = contents.get(path);
        if (bytes === undefined) throw new Error(`missing ${path}`);
        return bytes;
    };
    const files = {read, readText: async (path: string) => new TextDecoder().decode(await read(path))} as unknown as ProjectFileSystem;
    const events: EditorEventSource = {onEvent: () => () => undefined};
    const client = {request: () => new Promise(() => undefined), close: () => undefined} as unknown as EditorClient;
    const session: EditorSession = {client, events, files, project: {name: PROJECT_NAME, startScene: NO_START_SCENE}};
    const document = fakeDocument();
    const workspace = new EditorWorkspace(session, document);
    workspaces.push(workspace);
    const preview = new ProjectFilePreview(document, workspace);
    return {preview, element: preview.element as unknown as FakeElement, reads};
}

function fileEntry(path: string, size: number): ProjectEntry {
    return {path, kind: "file", size, mtimeMs: 1};
}

async function settled(element: FakeElement): Promise<void> {
    for (let turn = 0; turn < MAX_SETTLE_TURNS; turn++) {
        if (element.children.some(child => child.className === FACTS_CLASS_NAME)) return;
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    throw new Error("the preview never finished rendering");
}

function facts(element: FakeElement): Map<string, string> {
    const list = element.children.find(child => child.className === FACTS_CLASS_NAME)?.children ?? [];
    const pairs = new Map<string, string>();
    for (let index = 0; index + 1 < list.length; index += 2) pairs.set(list[index].textContent ?? "", list[index + 1].textContent ?? "");
    return pairs;
}

async function shown(path: string, bytes: Uint8Array, size = bytes.length): Promise<{element: FakeElement, reads: string[]}> {
    const {preview, element, reads} = previewOf(new Map([[path, bytes]]));
    preview.show(fileEntry(path, size));
    await settled(element);
    return {element, reads};
}

describe("project file preview", () => {
    test("an image file paints its decoded pixels onto the preview canvas", async () => {
        const {element} = await shown("art/red.ppm", ppm(3, 2, [255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]));
        const canvas = element.children.find(child => child.className === IMAGE_CLASS_NAME);
        expect([canvas?.tagName, canvas?.width, canvas?.height, canvas?.paints]).toEqual(["canvas", 3, 2, 1]);
        expect(facts(element).get("Dimensions")).toBe("3 × 2");
    });

    test("a sprite pattern file paints like an image", async () => {
        const {element} = await shown("art/ship.pattern.json", new TextEncoder().encode(PATTERN_FILE_TEXT));
        const canvas = element.children.find(child => child.className === IMAGE_CLASS_NAME);
        expect([canvas?.width, canvas?.height, canvas?.paints]).toEqual([2, 2, 1]);
    });

    test("a mesh renders into an orbitable canvas with its counts and size instead of a text excerpt", async () => {
        const {element} = await shown("models/cube.obj", new TextEncoder().encode(CUBE_OBJ));
        const canvas = element.children.find(child => child.className === MESH_PREVIEW_CLASS_NAME);
        expect([canvas?.tagName, canvas?.width, canvas?.height, canvas?.paints]).toEqual(["canvas", MESH_PREVIEW_SIZE_PX, MESH_PREVIEW_SIZE_PX, 1]);
        expect(element.children.some(child => child.tagName === "pre")).toBe(false);
        const meshFacts = facts(element);
        expect([meshFacts.get("Triangles"), meshFacts.get("Bounds")]).toEqual(["12", "2 × 2 × 2"]);
    });

    test("a mesh with no triangles says so, and one past the size limit is not read", async () => {
        const empty = await shown("models/points.obj", new TextEncoder().encode(POINTS_ONLY_OBJ));
        expect(empty.element.children.some(child => child.textContent === EMPTY_MESH_REASON)).toBe(true);
        const large = await shown("models/huge.obj", new Uint8Array(0), MAX_MESH_THUMBNAIL_BYTES + 1);
        expect(large.reads).toEqual([]);
        expect(large.element.children.some(child => child.tagName === "canvas")).toBe(false);
    });
});
