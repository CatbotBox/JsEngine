import type {Entity} from "../../engine/core";
import type {DecodedImage} from "../../engine/assets/image/decodedImage";
import {isInMeshCacheFolder} from "../../engine/assets/meshCache";
import {PROJECT_MANIFEST_FILE} from "../../engine/project/projectManifest";
import {DATA_ASSET_FILE_SUFFIX} from "../../engine/scene/dataAssetDocument";
import {SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION, sceneDocumentText} from "../../engine/scene/sceneDocument";
import type {ProjectEntry} from "../project/projectFileSystem";
import {PROJECT_ITEM_HOOK} from "../project/editorUiHooks";
import {askForChoice, askForText} from "./dialogs";
import {commandButton} from "./commandButtons";
import {showCommandMenu} from "./commandMenus";
import {createButton, createElement} from "./dom";
import type {EditorCommands} from "./editorCommands";
import {projectFolderMenu, projectItemMenu} from "./editorMenus";
import type {EditorWorkspace} from "./editorWorkspace";
import {
    captureFileTree,
    FileExistenceCommand,
    FileMoveCommand,
    newFileSnapshot,
    newFolderSnapshot,
    relocatedSnapshot,
    restoreFileTree,
    topmostPaths,
    treeSizeBytes,
} from "./fileUndo";
import type {FileMove, FileTreeSnapshot} from "./fileUndo";
import {parentLookupOf, topmostEntities} from "./hierarchyDrop";
import {clickedSelection, emptyListSelection, PLAIN_CLICK, retainedSelection, selectionModifiersOf} from "./listSelection";
import type {ListSelection, SelectionModifiers} from "./listSelection";
import {
    allProjectPaths,
    baseNameOf,
    buildProjectTree,
    duplicatePaths,
    fileNameProblem,
    findFolder,
    isAncestorFolder,
    joinProjectPath,
    normalizeProjectPath,
    opensInEditor,
    parentFolderOf,
    PREFAB_EXTENSION,
    PROJECT_ITEM_KIND_TITLES,
    projectFileKind,
    projectItemsOf,
    renamedPath,
    ROOT_FOLDER_PATH,
    SCENE_EXTENSION,
    uniqueChildPath,
} from "./projectFiles";
import type {ProjectFileKind, ProjectFolder, ProjectItemKind, ProjectItemRef} from "./projectFiles";
import {EXTERNAL_EDITOR_UNAVAILABLE_TEXT} from "./projectPreview";
import {isProjectSearchActive, PROJECT_SEARCH_PLACEHOLDER, projectSearchResults} from "./projectSearch";
import {DEFAULT_PREFAB_NAME, DEFAULT_SCRIPT_NAME, prefabTemplateText, SCRIPT_EXTENSION, scriptTemplate} from "./projectTemplates";
import {hasThumbnail, makeThumbnail, ThumbnailCache} from "./projectThumbnails";
import type {Thumbnail} from "./projectThumbnails";

export interface ProjectViewOptions {
    readonly rebuildsOnCodeChange: boolean;
}

const ICON_TEXT: Readonly<Record<ProjectItemKind, string>> = {folder: "DIR", scene: "SCN", prefab: "PFB", dataAsset: "DATA", mesh: "OBJ", image: "IMG", pattern: "PAT", code: "CODE", other: "FILE"};
const DRAG_TEXT_TYPE = "text/plain";
const DROP_TARGET_CLASS = "drop-target";
const SELECTED_CLASS = "selected";
const NEW_FOLDER_NAME = "New Folder";
const NEW_FOLDER_TEXT = "New Folder";
const NEW_SCENE_TEXT = "New Scene";
const IN_SHOWN_FOLDER_HINT = "in the folder shown here";
const REFRESH_HINT = "list the project's files again";
const NEW_SCENE_NAME = "New Scene";
const EMPTY_FOLDER_TEXT = "This folder is empty. Drag an entity here to make a prefab.";
const NO_SEARCH_RESULTS_TEXT = "No files match the search.";
const SEARCH_RESULTS_TEXT = "Search results";
const START_SCENE_CLASS = "start-scene";
const START_SCENE_TITLE = "the start scene";
const THUMBNAIL_CLASS = "project-thumbnail";
const NO_THUMBNAIL_CLASS = "no-thumbnail";
const ITEM_PATH_ATTRIBUTE = PROJECT_ITEM_HOOK;
const BYTES_PER_MEGABYTE = 1024 * 1024;
const MAX_UNDOABLE_DELETE_BYTES = 256 * BYTES_PER_MEGABYTE;
const UNDOABLE_DELETE_TEXT = "Undo (Ctrl+Z) restores it.";
const PERMANENT_DELETE_TEXT = "This cannot be undone.";
const PLAYING_DELETE_REASON = "File changes made while the game runs are not undoable.";
const TOO_LARGE_DELETE_REASON = `More than ${MAX_UNDOABLE_DELETE_BYTES / BYTES_PER_MEGABYTE} MB, so it is not kept for undo.`;
const REBUILD_HINT = "the editor rebuilds the game code and runs jsengine generate when the project server sees the new file";
const NO_REBUILD_HINT = "this editor has no project server, so run jsengine generate and rebuild the project to use it";
const KEY_DELETE = "Delete";
const KEY_RENAME = "F2";
const KEY_ENTER = "Enter";
const KEY_ESCAPE = "Escape";
const KEY_DUPLICATE = "d";
const KEY_SELECT_ALL = "a";
const NEXT_KEYS: ReadonlySet<string> = new Set(["ArrowRight", "ArrowDown"]);
const PREVIOUS_KEYS: ReadonlySet<string> = new Set(["ArrowLeft", "ArrowUp"]);
const NO_INDEX = -1;
const FIRST_INDEX = 0;
const NEXT_STEP = 1;
const PREVIOUS_STEP = -1;

function canvasOf(document: Document, image: DecodedImage, className: string): HTMLCanvasElement {
    const canvas = createElement(document, "canvas", className);
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (context !== null) {
        const pixels = context.createImageData(image.width, image.height);
        pixels.data.set(image.rgba);
        context.putImageData(pixels, 0, 0);
    }
    return canvas;
}

function itemCountText(count: number, single: string): string {
    return count === 1 ? single : `${count} items`;
}

export class ProjectView {
    private readonly tree: HTMLElement;
    private readonly grid: HTMLElement;
    private readonly breadcrumb: HTMLElement;
    private readonly search: HTMLInputElement;
    private readonly expanded = new Set<string>([ROOT_FOLDER_PATH]);
    private readonly thumbnails = new ThumbnailCache<Thumbnail>();
    private thumbnailQueue: Promise<unknown> = Promise.resolve();
    private entries: readonly ProjectEntry[] = [];
    private root: ProjectFolder = buildProjectTree([]);
    private shownFolder = ROOT_FOLDER_PATH;
    private selection: ListSelection<string> = emptyListSelection();
    private visibleItems: readonly ProjectItemRef[] = [];
    private unsubscribeFiles: () => void = () => undefined;
    private loading = false;
    private loadAgain = false;
    private shownStartScene: string | null = null;

    public constructor(container: HTMLElement, private readonly workspace: EditorWorkspace, private readonly commands: EditorCommands, private readonly options: ProjectViewOptions) {
        const document = container.ownerDocument;
        const toolbar = createElement(document, "div", "project-toolbar");
        this.breadcrumb = createElement(document, "div", "project-breadcrumb");
        this.search = createElement(document, "input", "field-input project-search");
        this.search.type = "search";
        this.search.placeholder = PROJECT_SEARCH_PLACEHOLDER;
        this.search.setAttribute("aria-label", "Search project files");
        this.search.addEventListener("input", () => this.render());
        this.search.addEventListener("keydown", event => {
            if (event.key !== KEY_ESCAPE || this.search.value.length === 0) return;
            event.preventDefault();
            event.stopPropagation();
            this.search.value = "";
            this.render();
        });
        toolbar.append(
            this.breadcrumb,
            this.search,
            commandButton(document, commands.registry, commands.assets.createFolder, {className: "", text: NEW_FOLDER_TEXT, hint: IN_SHOWN_FOLDER_HINT}),
            commandButton(document, commands.registry, commands.assets.createScene, {className: "", text: NEW_SCENE_TEXT, hint: IN_SHOWN_FOLDER_HINT}),
            commandButton(document, commands.registry, commands.assets.refresh, {className: "", hint: REFRESH_HINT}),
        );
        const body = createElement(document, "div", "project-body");
        this.tree = createElement(document, "div", "project-tree");
        this.tree.setAttribute("role", "tree");
        this.grid = createElement(document, "div", "project-grid");
        this.grid.setAttribute("role", "listbox");
        this.grid.setAttribute("aria-multiselectable", "true");
        this.grid.tabIndex = 0;
        body.append(this.tree, this.grid);
        container.replaceChildren(toolbar, body);
        this.installFolderDrop(this.grid, () => this.shownFolder);
        this.grid.addEventListener("click", event => {
            if (event.target !== this.grid || event.ctrlKey || event.metaKey || event.shiftKey) return;
            this.setSelection(emptyListSelection());
        });
        this.grid.addEventListener("contextmenu", event => {
            if (event.target !== this.grid) return;
            event.preventDefault();
            this.showFolderMenu(event, this.shownFolder);
        });
        this.grid.addEventListener("keydown", event => this.onKeyDown(event));
        workspace.on("reveal", () => {
            const path = workspace.revealedPath;
            if (path !== undefined) this.reveal(path);
        });
        workspace.on("document", () => {
            if (workspace.scenes.startScene !== this.shownStartScene) this.render();
        });
        workspace.on("files", () => void this.reload());
        this.rebind();
    }

    public rebind(): void {
        this.unsubscribeFiles();
        this.workspace.inspectFile(undefined);
        this.unsubscribeFiles = this.workspace.session.files.onChange(change => {
            void this.reload();
            for (const path of change.paths) {
                const normalized = normalizeProjectPath(path);
                if (projectFileKind(normalized) === "prefab") {
                    this.workspace.scenes.prefabChanged(normalized);
                    void this.workspace.updateInstancesOf(normalized);
                }
                if (normalized === PROJECT_MANIFEST_FILE) void this.workspace.scenes.manifestChanged();
            }
            void this.workspace.reloadDataAssets(change.paths);
            void this.workspace.reloadPrefabs(change.paths);
        });
        void this.reload();
    }

    public reveal(path: string): void {
        const normalized = normalizeProjectPath(path);
        this.search.value = "";
        this.shownFolder = parentFolderOf(normalized);
        this.selection = {selected: [normalized], anchor: normalized};
        for (let folder = this.shownFolder; ; folder = parentFolderOf(folder)) {
            this.expanded.add(folder);
            if (folder === ROOT_FOLDER_PATH) break;
        }
        this.render();
        this.grid.querySelector(`.${SELECTED_CLASS}`)?.scrollIntoView({block: "nearest"});
    }

    public get currentFolder(): string {
        return this.shownFolder;
    }

    public get selectedPaths(): readonly string[] {
        return this.selection.selected;
    }

    public async reload(): Promise<void> {
        if (this.loading) {
            this.loadAgain = true;
            return;
        }
        this.loading = true;
        try {
            this.entries = (await this.workspace.session.files.list()).filter(entry => !isInMeshCacheFolder(entry.path));
            this.root = buildProjectTree(this.entries);
            if (findFolder(this.root, this.shownFolder) === undefined) this.shownFolder = ROOT_FOLDER_PATH;
            const present = allProjectPaths(this.entries);
            this.selection = retainedSelection(this.selection, path => present.has(path));
            this.render();
        } catch (error) {
            this.workspace.reportError(error);
        } finally {
            this.loading = false;
            if (this.loadAgain) {
                this.loadAgain = false;
                void this.reload();
            }
        }
    }

    private render(): void {
        this.shownStartScene = this.workspace.scenes.startScene;
        this.renderBreadcrumb();
        this.tree.replaceChildren(this.folderNode(this.root, 0));
        this.renderGrid();
        this.syncInspectedFile();
    }

    private syncInspectedFile(): void {
        const inspected = this.workspace.inspectedFile;
        if (inspected !== undefined) this.workspace.inspectFile(this.fileEntry(inspected.path));
    }

    private fileEntry(path: string): ProjectEntry | undefined {
        const normalized = normalizeProjectPath(path);
        return this.entries.find(entry => entry.kind === "file" && normalizeProjectPath(entry.path) === normalized);
    }

    private kindOf(path: string): ProjectItemKind {
        return this.fileEntry(path) === undefined ? "folder" : projectFileKind(path);
    }

    private renderBreadcrumb(): void {
        const document = this.breadcrumb.ownerDocument;
        if (isProjectSearchActive(this.search.value)) {
            this.breadcrumb.replaceChildren(createElement(document, "span", "crumb", SEARCH_RESULTS_TEXT));
            return;
        }
        const parts = this.shownFolder === ROOT_FOLDER_PATH ? [] : this.shownFolder.split("/");
        const crumbs: HTMLElement[] = [this.crumb(document, this.workspace.session.files.rootLabel, ROOT_FOLDER_PATH)];
        parts.forEach((part, index) => crumbs.push(createElement(document, "span", "crumb-separator", "/"), this.crumb(document, part, parts.slice(0, index + 1).join("/"))));
        this.breadcrumb.replaceChildren(...crumbs);
    }

    private crumb(document: Document, text: string, folder: string): HTMLElement {
        const crumb = createButton(document, {className: "crumb", text, title: folder === ROOT_FOLDER_PATH ? "Project root" : folder, onClick: () => this.openFolder(folder)});
        this.installFolderDrop(crumb, () => folder);
        return crumb;
    }

    private folderNode(folder: ProjectFolder, depth: number): HTMLElement {
        const document = this.tree.ownerDocument;
        const node = createElement(document, "div", "project-folder-node");
        const row = createElement(document, "div", "project-folder-row");
        row.setAttribute("role", "treeitem");
        row.classList.toggle(SELECTED_CLASS, folder.path === this.shownFolder && !isProjectSearchActive(this.search.value));
        row.style.paddingLeft = `${depth}em`;
        const open = this.expanded.has(folder.path);
        const arrow = createElement(document, "span", folder.folders.length === 0 ? "tree-arrow leaf" : open ? "tree-arrow expanded" : "tree-arrow");
        arrow.addEventListener("click", event => {
            event.stopPropagation();
            if (open) this.expanded.delete(folder.path);
            else this.expanded.add(folder.path);
            this.render();
        });
        row.append(arrow, createElement(document, "span", "file-icon kind-folder", ICON_TEXT.folder), createElement(document, "span", "project-folder-name", folder.path === ROOT_FOLDER_PATH ? this.workspace.session.files.rootLabel : folder.name));
        row.addEventListener("click", () => this.openFolder(folder.path));
        row.addEventListener("contextmenu", event => {
            event.preventDefault();
            this.showFolderMenu(event, folder.path);
        });
        this.installFolderDrop(row, () => folder.path);
        node.append(row);
        if (open) for (const child of folder.folders) node.append(this.folderNode(child, depth + 1));
        return node;
    }

    private shownItems(): ProjectItemRef[] {
        if (isProjectSearchActive(this.search.value)) return projectSearchResults(projectItemsOf(this.entries), this.search.value);
        const folder = findFolder(this.root, this.shownFolder) ?? this.root;
        return [
            ...folder.folders.map((child): ProjectItemRef => ({path: child.path, kind: "folder"})),
            ...folder.files.map((entry): ProjectItemRef => ({path: normalizeProjectPath(entry.path), kind: projectFileKind(entry.path)})),
        ];
    }

    private renderGrid(): void {
        const document = this.grid.ownerDocument;
        this.visibleItems = this.shownItems();
        const elements = this.visibleItems.map(item => this.gridItem(document, item));
        if (elements.length === 0) elements.push(createElement(document, "p", "project-empty", isProjectSearchActive(this.search.value) ? NO_SEARCH_RESULTS_TEXT : EMPTY_FOLDER_TEXT));
        this.grid.replaceChildren(...elements);
    }

    private gridItem(document: Document, item: ProjectItemRef): HTMLElement {
        const {path, kind} = item;
        const element = createElement(document, "div", `project-item kind-${kind}`);
        element.setAttribute("role", "option");
        element.setAttribute(ITEM_PATH_ATTRIBUTE, path);
        element.tabIndex = -1;
        const start = path === this.workspace.scenes.startScene;
        element.title = start ? `${PROJECT_ITEM_KIND_TITLES[kind]}: ${path} (${START_SCENE_TITLE})` : `${PROJECT_ITEM_KIND_TITLES[kind]}: ${path}`;
        const selected = this.selection.selected.includes(path);
        element.classList.toggle(SELECTED_CLASS, selected);
        element.setAttribute("aria-selected", String(selected));
        element.classList.toggle(START_SCENE_CLASS, start);
        element.append(this.itemIcon(document, item), createElement(document, "span", "project-item-name", baseNameOf(path)));
        element.addEventListener("click", event => {
            event.stopPropagation();
            this.clickItem(path, selectionModifiersOf(event));
        });
        element.addEventListener("dblclick", () => this.activate(path, kind));
        element.addEventListener("contextmenu", event => {
            event.preventDefault();
            event.stopPropagation();
            if (!this.selection.selected.includes(path)) this.clickItem(path, PLAIN_CLICK);
            this.showItemMenu(event, path, kind);
        });
        if (kind === "folder") this.installFolderDrop(element, () => path);
        else this.installFileDrag(element, path, kind);
        return element;
    }

    private itemIcon(document: Document, item: ProjectItemRef): HTMLElement {
        const icon = createElement(document, "span", `file-icon kind-${item.kind}`, ICON_TEXT[item.kind]);
        if (item.kind === "folder" || !hasThumbnail(item.path)) return icon;
        const entry = this.fileEntry(item.path);
        if (entry === undefined) return icon;
        const ready = this.thumbnails.peek(entry);
        if (ready !== undefined) return this.thumbnailElement(document, ready, icon);
        void this.thumbnails.get(entry, () => this.queuedThumbnail(entry)).then(thumbnail => {
            if (icon.isConnected) icon.replaceWith(this.thumbnailElement(document, thumbnail, icon));
        });
        return icon;
    }

    private queuedThumbnail(entry: ProjectEntry): Promise<Thumbnail> {
        const made = this.thumbnailQueue.then(() => makeThumbnail(entry, path => this.workspace.session.files.read(path)))
            .catch((error: unknown): Thumbnail => ({kind: "icon", reason: error instanceof Error ? error.message : String(error)}));
        this.thumbnailQueue = made;
        return made;
    }

    private thumbnailElement(document: Document, thumbnail: Thumbnail, icon: HTMLElement): HTMLElement {
        if (thumbnail.kind === "icon") {
            icon.classList.add(NO_THUMBNAIL_CLASS);
            icon.title = thumbnail.reason;
            return icon;
        }
        return canvasOf(document, thumbnail.image, THUMBNAIL_CLASS);
    }

    private clickItem(path: string, modifiers: SelectionModifiers): void {
        this.setSelection(clickedSelection(this.visibleItems.map(item => item.path), this.selection, path, modifiers));
    }

    private setSelection(selection: ListSelection<string>): void {
        this.selection = selection;
        for (const element of this.grid.querySelectorAll<HTMLElement>(`[${ITEM_PATH_ATTRIBUTE}]`)) {
            const selected = selection.selected.includes(element.getAttribute(ITEM_PATH_ATTRIBUTE) ?? "");
            element.classList.toggle(SELECTED_CLASS, selected);
            element.setAttribute("aria-selected", String(selected));
        }
        const primary = selection.selected[selection.selected.length - 1];
        this.workspace.inspectFile(primary === undefined ? undefined : this.fileEntry(primary));
        this.commands.registry.changed();
    }

    private onKeyDown(event: KeyboardEvent): void {
        const commandKey = event.ctrlKey || event.metaKey;
        const selected = this.selection.selected;
        const primary = selected[selected.length - 1];
        let handled = true;
        if (event.key === KEY_DELETE && !commandKey) this.commands.assets.remove.runWith(selected);
        else if (event.key === KEY_RENAME && primary !== undefined) this.commands.assets.rename.runWith(primary);
        else if (event.key === KEY_ENTER && primary !== undefined) this.activate(primary, this.kindOf(primary));
        else if (commandKey && event.key.toLowerCase() === KEY_DUPLICATE) this.commands.assets.duplicate.runWith(selected);
        else if (commandKey && event.key.toLowerCase() === KEY_SELECT_ALL) this.setSelection({selected: this.visibleItems.map(item => item.path), anchor: this.selection.anchor});
        else if (NEXT_KEYS.has(event.key) || PREVIOUS_KEYS.has(event.key)) this.step(NEXT_KEYS.has(event.key) ? NEXT_STEP : PREVIOUS_STEP, event.shiftKey);
        else handled = false;
        if (!handled) return;
        event.preventDefault();
        event.stopPropagation();
    }

    private step(direction: number, extend: boolean): void {
        const paths = this.visibleItems.map(item => item.path);
        if (paths.length === 0) return;
        const primary = this.selection.selected[this.selection.selected.length - 1];
        const index = primary === undefined ? NO_INDEX : paths.indexOf(primary);
        const next = index === NO_INDEX ? FIRST_INDEX : Math.min(paths.length - 1, Math.max(FIRST_INDEX, index + direction));
        this.clickItem(paths[next], {toggle: false, extend});
        this.itemElement(paths[next])?.focus();
    }

    private itemElement(path: string): HTMLElement | undefined {
        return [...this.grid.querySelectorAll<HTMLElement>(`[${ITEM_PATH_ATTRIBUTE}]`)].find(element => element.getAttribute(ITEM_PATH_ATTRIBUTE) === path);
    }

    private openFolder(path: string): void {
        this.search.value = "";
        this.shownFolder = path;
        this.expanded.add(path);
        this.render();
    }

    private activate(path: string, kind: ProjectItemKind): void {
        if (kind === "folder") this.openFolder(path);
        else if (opensInEditor(kind) || kind === "code") this.open(path, kind);
    }

    public open(path: string, kind: ProjectFileKind): void {
        if (kind === "scene" || kind === "prefab") void this.workspace.scenes.open(path);
        else if (kind === "dataAsset") this.workspace.openDataAsset(path);
        else void this.openExternally(path);
    }

    private async openExternally(path: string): Promise<void> {
        const files = this.workspace.session.files;
        if (files.openExternally === undefined) {
            this.workspace.notice("warn", EXTERNAL_EDITOR_UNAVAILABLE_TEXT);
            return;
        }
        try {
            await files.openExternally(path);
        } catch (error) {
            this.workspace.reportError(error);
        }
    }

    public async showInExplorer(path: string): Promise<void> {
        const files = this.workspace.session.files;
        if (files.showInFolder === undefined) return;
        try {
            await files.showInFolder(path);
        } catch (error) {
            this.workspace.reportError(error);
        }
    }

    private movedPathsFor(path: string): readonly string[] {
        return this.selection.selected.includes(path) ? topmostPaths(this.selection.selected) : [path];
    }

    private installFileDrag(element: HTMLElement, path: string, kind: ProjectFileKind): void {
        element.draggable = true;
        element.addEventListener("dragstart", event => {
            this.workspace.drag = {kind: "asset", path, fileKind: kind, movedPaths: this.movedPathsFor(path)};
            if (event.dataTransfer === null) return;
            event.dataTransfer.effectAllowed = "copyMove";
            event.dataTransfer.setData(DRAG_TEXT_TYPE, path);
        });
        element.addEventListener("dragend", () => this.workspace.drag = undefined);
    }

    private installFolderDrop(element: HTMLElement, folderOf: () => string): void {
        const accepts = (): boolean => {
            const drag = this.workspace.drag;
            if (drag === undefined) return false;
            if (drag.kind === "entities") return drag.entities.length > 0;
            const folder = folderOf();
            return drag.movedPaths.some(path => !isAncestorFolder(path, folder) && parentFolderOf(path) !== folder);
        };
        element.addEventListener("dragover", event => {
            if (!accepts()) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.dataTransfer !== null) event.dataTransfer.dropEffect = this.workspace.drag?.kind === "entities" ? "copy" : "move";
            element.classList.add(DROP_TARGET_CLASS);
        });
        element.addEventListener("dragleave", () => element.classList.remove(DROP_TARGET_CLASS));
        element.addEventListener("drop", event => {
            element.classList.remove(DROP_TARGET_CLASS);
            const drag = this.workspace.drag;
            if (drag === undefined || !accepts()) return;
            event.preventDefault();
            event.stopPropagation();
            this.workspace.drag = undefined;
            const folder = folderOf();
            if (drag.kind === "entities") void this.createPrefabs(drag.entities, folder);
            else void this.moveInto(drag.movedPaths, folder);
        });
    }

    private async createPrefabs(entities: readonly Entity[], folder: string): Promise<void> {
        for (const entity of topmostEntities(entities, parentLookupOf(this.workspace.links()))) await this.workspace.createPrefab(entity, folder);
    }

    private showFolderMenu(event: MouseEvent, folder: string): void {
        showCommandMenu(this.grid.ownerDocument, event.clientX, event.clientY, projectFolderMenu(this.commands, folder, folder === ROOT_FOLDER_PATH, this.selection.selected));
    }

    private showItemMenu(event: MouseEvent, path: string, kind: ProjectItemKind): void {
        if (kind === "folder") {
            this.showFolderMenu(event, path);
            return;
        }
        showCommandMenu(this.grid.ownerDocument, event.clientX, event.clientY, projectItemMenu(this.commands, {path, kind}, this.selection.selected));
    }

    private nameProblem(folder: string, name: string): string | undefined {
        const problem = fileNameProblem(name);
        if (problem !== undefined) return problem;
        return allProjectPaths(this.entries).has(joinProjectPath(folder, name.trim())) ? `${name.trim()} already exists here` : undefined;
    }

    private async createFile(label: string, path: string, contents: string): Promise<boolean> {
        const created = await this.workspace.run(async () => {
            await this.workspace.files.write(path, contents);
            this.workspace.record(new FileExistenceCommand(label, [newFileSnapshot(path, contents)], true));
            return true;
        });
        if (created !== true) return false;
        await this.reload();
        this.reveal(path);
        return true;
    }

    public async createFolder(parent: string): Promise<void> {
        const name = await askForText(this.grid.ownerDocument, {title: "New folder", label: "Folder name", initialValue: NEW_FOLDER_NAME, confirmText: "Create", validate: value => this.nameProblem(parent, value)});
        if (name === undefined) return;
        const path = joinProjectPath(parent, name.trim());
        const created = await this.workspace.run(async () => {
            await this.workspace.files.makeDirectory(path);
            this.workspace.record(new FileExistenceCommand("Create Folder", [newFolderSnapshot(path)], true));
            return true;
        });
        if (created !== true) return;
        this.expanded.add(parent);
        await this.reload();
    }

    public async createScene(folder: string): Promise<void> {
        const name = await askForText(this.grid.ownerDocument, {title: "New scene", label: "Scene name", initialValue: NEW_SCENE_NAME, confirmText: "Create", validate: value => this.nameProblem(folder, `${value.trim()}${SCENE_EXTENSION}`)});
        if (name === undefined) return;
        const path = uniqueChildPath(allProjectPaths(this.entries), folder, name.trim(), SCENE_EXTENSION);
        await this.createFile("Create Scene", path, sceneDocumentText({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: []}));
    }

    public async createPrefab(folder: string): Promise<void> {
        const name = await askForText(this.grid.ownerDocument, {
            title: "New prefab",
            label: "Prefab name",
            initialValue: DEFAULT_PREFAB_NAME,
            confirmText: "Create",
            validate: value => this.nameProblem(folder, `${value.trim()}${PREFAB_EXTENSION}`),
        });
        if (name === undefined) return;
        const path = uniqueChildPath(allProjectPaths(this.entries), folder, name.trim(), PREFAB_EXTENSION);
        await this.createFile("Create Prefab", path, prefabTemplateText(name.trim()));
    }

    public async createScript(folder: string): Promise<void> {
        const name = await askForText(this.grid.ownerDocument, {
            title: "New script",
            label: "Component name (the system is named after it)",
            initialValue: DEFAULT_SCRIPT_NAME,
            confirmText: "Create",
            validate: value => fileNameProblem(value),
        });
        if (name === undefined) return;
        const template = scriptTemplate(name);
        const path = uniqueChildPath(allProjectPaths(this.entries), folder, template.fileStem, SCRIPT_EXTENSION);
        if (!await this.createFile("Create Script", path, template.text)) return;
        this.workspace.notice("info", `Created ${path} with ${template.componentName} and ${template.systemName}; ${this.options.rebuildsOnCodeChange ? REBUILD_HINT : NO_REBUILD_HINT}`);
    }

    public async createDataAsset(folder: string, typeName: string): Promise<void> {
        const name = await askForText(this.grid.ownerDocument, {
            title: `New ${typeName} data asset`,
            label: "Data asset name",
            initialValue: typeName,
            confirmText: "Create",
            validate: value => this.nameProblem(folder, `${value.trim()}${DATA_ASSET_FILE_SUFFIX}`),
        });
        if (name === undefined) return;
        const path = uniqueChildPath(allProjectPaths(this.entries), folder, name.trim(), DATA_ASSET_FILE_SUFFIX);
        if (await this.workspace.createDataAsset(typeName, path)) await this.reload();
    }

    public async rename(path: string): Promise<void> {
        const folder = parentFolderOf(path);
        const current = baseNameOf(path);
        const name = await askForText(this.grid.ownerDocument, {
            title: "Rename",
            label: "New name",
            initialValue: current,
            confirmText: "Rename",
            validate: value => value.trim() === current ? undefined : this.nameProblem(folder, value),
        });
        if (name === undefined || name.trim() === current) return;
        await this.move("Rename", [{from: normalizeProjectPath(path), to: renamedPath(path, name)}]);
    }

    private async moveInto(paths: readonly string[], folder: string): Promise<void> {
        const existing = allProjectPaths(this.entries);
        const moves: FileMove[] = [];
        for (const path of topmostPaths(paths)) {
            if (isAncestorFolder(path, folder) || parentFolderOf(path) === folder) continue;
            const target = joinProjectPath(folder, baseNameOf(path));
            if (existing.has(target)) {
                this.workspace.notice("warn", `${target} already exists`);
                continue;
            }
            moves.push({from: path, to: target});
        }
        if (moves.length > 0) await this.move(moves.length === 1 ? "Move" : `Move ${moves.length} items`, moves);
    }

    private async move(label: string, moves: readonly FileMove[]): Promise<void> {
        const done: FileMove[] = [];
        await this.workspace.run(async () => {
            try {
                for (const move of moves) {
                    await this.workspace.files.rename(move.from, move.to);
                    done.push(move);
                }
            } finally {
                if (done.length > 0) this.workspace.record(new FileMoveCommand(label, done));
            }
        });
        const renamed = new Map(done.map(move => [move.from, move.to]));
        this.selection = {selected: this.selection.selected.map(path => renamed.get(path) ?? path), anchor: this.selection.anchor === undefined ? undefined : renamed.get(this.selection.anchor) ?? this.selection.anchor};
        await this.reload();
    }

    public async duplicate(paths: readonly string[]): Promise<void> {
        const items = topmostPaths(paths).map((path): ProjectItemRef => ({path, kind: this.kindOf(path)}));
        if (items.length === 0) return;
        const targets = duplicatePaths(allProjectPaths(this.entries), items);
        const created: FileTreeSnapshot[] = [];
        await this.workspace.run(async () => {
            try {
                for (const [index, item] of items.entries()) {
                    const copy = relocatedSnapshot(await captureFileTree(this.workspace.files, item.path), targets[index]);
                    await restoreFileTree(this.workspace.files, copy);
                    created.push(copy);
                }
            } finally {
                if (created.length > 0) this.workspace.record(new FileExistenceCommand(created.length === 1 ? "Duplicate" : `Duplicate ${created.length} items`, created, true));
            }
        });
        await this.reload();
        const copies = created.map(tree => tree.path);
        if (copies.length > 0) this.setSelection({selected: copies, anchor: copies[copies.length - 1]});
    }

    public async remove(paths: readonly string[]): Promise<void> {
        const targets = topmostPaths(paths);
        if (targets.length === 0) return;
        const bytes = targets.reduce((total, path) => total + treeSizeBytes(this.entries, path), 0);
        const undoable = this.workspace.recording && bytes <= MAX_UNDOABLE_DELETE_BYTES;
        const permanentReason = this.workspace.recording ? TOO_LARGE_DELETE_REASON : PLAYING_DELETE_REASON;
        const confirmed = await askForChoice(this.grid.ownerDocument, {
            title: "Delete",
            message: `Delete ${targets.length === 1 ? targets[0] : `${targets.length} items (${targets.join(", ")})`}? ${undoable ? UNDOABLE_DELETE_TEXT : `${permanentReason} ${PERMANENT_DELETE_TEXT}`}`,
            choices: [{label: "Delete", value: true, primary: true}],
        });
        if (confirmed !== true) return;
        const removed: FileTreeSnapshot[] = [];
        await this.workspace.run(async () => {
            try {
                for (const path of targets) {
                    const snapshot = undoable ? await captureFileTree(this.workspace.files, path) : undefined;
                    await this.workspace.files.remove(path);
                    if (snapshot !== undefined) removed.push(snapshot);
                }
            } finally {
                if (removed.length > 0) this.workspace.record(new FileExistenceCommand(`Delete ${itemCountText(removed.length, baseNameOf(removed[0].path))}`, removed, false));
            }
        });
        const removedShownFolder = targets.find(path => isAncestorFolder(path, this.shownFolder));
        if (removedShownFolder !== undefined) this.shownFolder = parentFolderOf(removedShownFolder);
        await this.reload();
    }
}
