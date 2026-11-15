import type {DecodedImage} from "../../engine/assets/image/decodedImage";
import {inflate} from "../../engine/assets/image/inflate";
import {decodeJpeg} from "../../engine/assets/image/jpeg";
import {decodePng} from "../../engine/assets/image/png";
import {decodePpm} from "../../engine/assets/image/ppm";
import {parseSceneDocument} from "../../engine/scene/sceneDocument";
import type {ProjectEntry} from "../project/projectFileSystem";
import {groupOutline, outlineCode} from "./codeOutline";
import type {OutlineGroup, OutlineSymbol} from "./codeOutline";
import {createElement, errorText} from "./dom";
import type {EditorWorkspace} from "./editorWorkspace";
import {documentRootCount} from "./prefabInstancePaths";
import {baseNameOf, extensionOf, PROJECT_FILE_KIND_TITLES, projectFileKind} from "./projectFiles";
import type {ProjectFileKind} from "./projectFiles";

type Fact = readonly [label: string, value: string];

interface PreviewContent {
    readonly facts: readonly Fact[];
    readonly body: readonly Node[];
}

export const EXTERNAL_EDITOR_UNAVAILABLE_TEXT = "Opening files in an external editor needs the desktop app or the dev server";

const IMAGE_DECODERS: Readonly<Record<string, (bytes: Uint8Array) => DecodedImage>> = {
    ".png": bytes => decodePng(bytes, {inflate}),
    ".jpg": decodeJpeg,
    ".jpeg": decodeJpeg,
    ".ppm": decodePpm,
};
const TEXT_EXCERPT_KINDS: ReadonlySet<ProjectFileKind> = new Set(["mesh", "other"]);
const BYTES_PER_KILOBYTE = 1024;
const SIZE_UNITS: readonly string[] = ["KB", "MB", "GB"];
const SIZE_DECIMALS = 1;
const MAX_IMAGE_PREVIEW_BYTES = 16 * BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const MAX_OUTLINE_BYTES = 2 * BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const MAX_TEXT_EXCERPT_BYTES = 64 * BYTES_PER_KILOBYTE;
const TEXT_EXCERPT_LINES = 12;
const UNKNOWN_MTIME_MS = 0;
const NUL_CHARACTER = "\u0000";
const LINE_BREAK = /\r?\n/;
const LINE_FEED = "\n";
const EMPTY_PANE_TEXT = "Select a file to see what it contains.";
const LOADING_TEXT = "Loading…";
const NO_OUTLINE_TEXT = "No components, systems, resources or exports found.";
const OPEN_EXTERNALLY_HINT = "Double-click to open in your editor";
const OPEN_DOCUMENT_HINT = "Double-click to open";
const NOT_REGISTERED_TEXT = "not registered";

function formatFileSize(bytes: number): string {
    if (bytes < BYTES_PER_KILOBYTE) return `${bytes} B`;
    let value = bytes / BYTES_PER_KILOBYTE;
    let unit = 0;
    while (value >= BYTES_PER_KILOBYTE && unit < SIZE_UNITS.length - 1) {
        value /= BYTES_PER_KILOBYTE;
        unit++;
    }
    return `${value.toFixed(SIZE_DECIMALS)} ${SIZE_UNITS[unit]}`;
}

function tooLargeText(limit: number): string {
    return `Larger than ${formatFileSize(limit)}; not previewed.`;
}

export class ProjectFilePreview {
    public readonly element: HTMLElement;
    private shown: ProjectEntry | undefined;
    private displayedPath: string | undefined;
    private generation = 0;

    public constructor(document: Document, private readonly workspace: EditorWorkspace) {
        this.element = createElement(document, "aside", "project-preview");
        this.element.setAttribute("aria-live", "polite");
        workspace.on("schemas", () => {
            if (this.shown !== undefined && projectFileKind(this.shown.path) === "code") this.refresh();
        });
        this.clear();
    }

    public show(entry: ProjectEntry | undefined): void {
        if (entry === undefined) {
            if (this.shown !== undefined) this.clear();
            return;
        }
        const shown = this.shown;
        if (shown !== undefined && shown.path === entry.path && shown.size === entry.size && shown.mtimeMs === entry.mtimeMs) return;
        this.shown = entry;
        this.refresh();
    }

    public clear(): void {
        this.generation++;
        this.shown = undefined;
        this.displayedPath = undefined;
        this.element.replaceChildren(createElement(this.element.ownerDocument, "p", "project-preview-empty", EMPTY_PANE_TEXT));
    }

    private refresh(): void {
        const entry = this.shown;
        if (entry === undefined) return;
        const generation = ++this.generation;
        const kind = projectFileKind(entry.path);
        if (this.displayedPath !== entry.path) {
            const document = this.element.ownerDocument;
            this.element.replaceChildren(this.header(document, entry, kind), createElement(document, "p", "project-preview-empty", LOADING_TEXT));
            this.displayedPath = entry.path;
        }
        void this.render(entry, kind, generation);
    }

    private async render(entry: ProjectEntry, kind: ProjectFileKind, generation: number): Promise<void> {
        const document = this.element.ownerDocument;
        let content: PreviewContent;
        try {
            content = await this.contentOf(document, entry, kind);
        } catch (error) {
            content = {facts: [], body: [createElement(document, "p", "project-preview-error", errorText(error))]};
        }
        if (generation !== this.generation) return;
        const facts: Fact[] = [["Kind", PROJECT_FILE_KIND_TITLES[kind]], ["Size", formatFileSize(entry.size)]];
        if (entry.mtimeMs !== UNKNOWN_MTIME_MS) facts.push(["Modified", new Date(entry.mtimeMs).toLocaleString()]);
        facts.push(...content.facts);
        const parts: Node[] = [this.header(document, entry, kind), this.factList(document, facts), ...content.body];
        const hint = this.hintOf(kind);
        if (hint !== undefined) parts.push(createElement(document, "p", "project-preview-hint", hint));
        this.element.replaceChildren(...parts);
    }

    private header(document: Document, entry: ProjectEntry, kind: ProjectFileKind): HTMLElement {
        const header = createElement(document, "div", "project-preview-header", baseNameOf(entry.path));
        header.title = `${PROJECT_FILE_KIND_TITLES[kind]}: ${entry.path}`;
        return header;
    }

    private factList(document: Document, facts: readonly Fact[]): HTMLElement {
        const list = createElement(document, "dl", "project-preview-facts");
        for (const [label, value] of facts) list.append(createElement(document, "dt", "", label), createElement(document, "dd", "", value));
        return list;
    }

    private hintOf(kind: ProjectFileKind): string | undefined {
        if (kind === "scene" || kind === "prefab") return OPEN_DOCUMENT_HINT;
        if (kind !== "code") return undefined;
        return this.workspace.session.files.openExternally === undefined ? EXTERNAL_EDITOR_UNAVAILABLE_TEXT : OPEN_EXTERNALLY_HINT;
    }

    private async contentOf(document: Document, entry: ProjectEntry, kind: ProjectFileKind): Promise<PreviewContent> {
        const files = this.workspace.session.files;
        switch (kind) {
            case "image": {
                if (entry.size > MAX_IMAGE_PREVIEW_BYTES) return {facts: [], body: [createElement(document, "p", "project-preview-empty", tooLargeText(MAX_IMAGE_PREVIEW_BYTES))]};
                const decode = IMAGE_DECODERS[extensionOf(entry.path).toLowerCase()];
                if (decode === undefined) return {facts: [], body: []};
                const image = decode(await files.read(entry.path));
                return {facts: [["Dimensions", `${image.width} × ${image.height}`]], body: [this.imageCanvas(document, image)]};
            }
            case "code": {
                if (entry.size > MAX_OUTLINE_BYTES) return {facts: [], body: [createElement(document, "p", "project-preview-empty", tooLargeText(MAX_OUTLINE_BYTES))]};
                const groups = groupOutline(outlineCode(await files.readText(entry.path)));
                return {facts: [], body: groups.length === 0 ? [createElement(document, "p", "project-preview-empty", NO_OUTLINE_TEXT)] : groups.map(group => this.outlineGroup(document, group))};
            }
            case "scene":
            case "prefab": {
                const parsed = parseSceneDocument(await files.readText(entry.path));
                return {facts: [["Entities", String(parsed.entities.length)], ["Root entities", String(documentRootCount(parsed))]], body: []};
            }
            default:
                return TEXT_EXCERPT_KINDS.has(kind) && entry.size <= MAX_TEXT_EXCERPT_BYTES ? {facts: [], body: this.textExcerpt(document, await files.readText(entry.path))} : {facts: [], body: []};
        }
    }

    private imageCanvas(document: Document, image: DecodedImage): HTMLElement {
        const canvas = createElement(document, "canvas", "project-preview-image");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        if (context !== null && image.width > 0 && image.height > 0) {
            const pixels = context.createImageData(image.width, image.height);
            pixels.data.set(image.rgba);
            context.putImageData(pixels, 0, 0);
        }
        return canvas;
    }

    private outlineGroup(document: Document, group: OutlineGroup): HTMLElement {
        const section = createElement(document, "section", "project-preview-outline");
        const list = createElement(document, "ul", "project-preview-symbols");
        for (const symbol of group.symbols) list.append(this.outlineItem(document, symbol));
        section.append(createElement(document, "h4", "project-preview-heading", `${group.title} (${group.symbols.length})`), list);
        return section;
    }

    private outlineItem(document: Document, symbol: OutlineSymbol): HTMLElement {
        const item = createElement(document, "li", "project-preview-symbol");
        item.append(createElement(document, "span", "symbol-name", symbol.name));
        const typeName = symbol.typeName;
        if (typeName !== undefined && typeName !== symbol.name) item.append(createElement(document, "span", "symbol-type", `"${typeName}"`));
        if (symbol.kind === "component" && typeName !== undefined) {
            const schema = this.workspace.schemas.get(typeName);
            const badge = createElement(document, "span", schema === undefined ? "symbol-badge" : "symbol-badge registered", schema?.category ?? NOT_REGISTERED_TEXT);
            badge.title = schema === undefined ? `${typeName} is not registered in the running project` : `Registered as ${typeName}${schema.inferred ? " (inferred, not saved)" : ""}`;
            item.append(badge);
        }
        item.append(createElement(document, "span", "symbol-line", `:${symbol.line}`));
        return item;
    }

    private textExcerpt(document: Document, text: string): Node[] {
        if (text.includes(NUL_CHARACTER)) return [];
        return [createElement(document, "pre", "project-preview-text", text.split(LINE_BREAK).slice(0, TEXT_EXCERPT_LINES).join(LINE_FEED))];
    }
}
