import type {Entity} from "../../engine/core";
import {SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "../../engine/scene/sceneDocument";
import type {ProjectEntry} from "../project/projectFileSystem";
import {askForChoice, askForText} from "./dialogs";
import {createButton, createElement} from "./dom";
import type {EditorWorkspace} from "./editorWorkspace";
import {parentLookupOf, topmostEntities} from "./hierarchyDrop";
import {MENU_SEPARATOR, showPopupMenu} from "./popupMenu";
import type {MenuItem} from "./popupMenu";
import {sceneDocumentText} from "./prefabInstancePaths";
import {
    allProjectPaths,
    baseNameOf,
    buildProjectTree,
    fileNameProblem,
    findFolder,
    isAncestorFolder,
    isAssetKind,
    joinProjectPath,
    normalizeProjectPath,
    parentFolderOf,
    projectFileKind,
    renamedPath,
    ROOT_FOLDER_PATH,
    SCENE_EXTENSION,
    uniqueChildPath,
} from "./projectFiles";
import type {ProjectFileKind, ProjectFolder} from "./projectFiles";

type ItemKind = ProjectFileKind | "folder";

const ICON_TEXT: Readonly<Record<ItemKind, string>> = {folder: "DIR", scene: "SCN", prefab: "PFB", mesh: "OBJ", image: "IMG", other: "FILE"};
const KIND_TITLES: Readonly<Record<ItemKind, string>> = {folder: "Folder", scene: "Scene", prefab: "Prefab", mesh: "Mesh", image: "Image", other: "File"};
const DRAG_TEXT_TYPE = "text/plain";
const DROP_TARGET_CLASS = "drop-target";
const SELECTED_CLASS = "selected";
const NEW_FOLDER_NAME = "New Folder";
const NEW_SCENE_NAME = "New Scene";
const EMPTY_FOLDER_TEXT = "This folder is empty. Drag an entity here to make a prefab.";

export class ProjectView {
    private readonly tree: HTMLElement;
    private readonly grid: HTMLElement;
    private readonly breadcrumb: HTMLElement;
    private readonly expanded = new Set<string>([ROOT_FOLDER_PATH]);
    private entries: readonly ProjectEntry[] = [];
    private root: ProjectFolder = buildProjectTree([]);
    private currentFolder = ROOT_FOLDER_PATH;
    private selectedPath: string | undefined;
    private unsubscribeFiles: () => void = () => undefined;
    private loading = false;
    private loadAgain = false;

    public constructor(container: HTMLElement, private readonly workspace: EditorWorkspace) {
        const document = container.ownerDocument;
        const toolbar = createElement(document, "div", "project-toolbar");
        this.breadcrumb = createElement(document, "div", "project-breadcrumb");
        toolbar.append(
            this.breadcrumb,
            createButton(document, {className: "", text: "New Folder", title: "Create a folder here", onClick: () => void this.createFolder(this.currentFolder)}),
            createButton(document, {className: "", text: "New Scene", title: "Create an empty scene file here", onClick: () => void this.createScene(this.currentFolder)}),
            createButton(document, {className: "", text: "Refresh", title: "List the project's files again", onClick: () => void this.reload()}),
        );
        const body = createElement(document, "div", "project-body");
        this.tree = createElement(document, "div", "project-tree");
        this.tree.setAttribute("role", "tree");
        this.grid = createElement(document, "div", "project-grid");
        this.grid.setAttribute("role", "listbox");
        body.append(this.tree, this.grid);
        container.replaceChildren(toolbar, body);
        this.installFolderDrop(this.grid, () => this.currentFolder);
        this.grid.addEventListener("contextmenu", event => {
            if (event.target !== this.grid) return;
            event.preventDefault();
            this.showFolderMenu(event, this.currentFolder);
        });
        workspace.on("reveal", () => {
            const path = workspace.revealedPath;
            if (path !== undefined) this.reveal(path);
        });
        this.rebind();
    }

    public rebind(): void {
        this.unsubscribeFiles();
        this.unsubscribeFiles = this.workspace.session.files.onChange(change => {
            void this.reload();
            for (const path of change.paths) {
                const normalized = normalizeProjectPath(path);
                if (projectFileKind(normalized) === "prefab") void this.workspace.updateInstancesOf(normalized);
            }
        });
        void this.reload();
    }

    public reveal(path: string): void {
        const normalized = normalizeProjectPath(path);
        this.currentFolder = parentFolderOf(normalized);
        this.selectedPath = normalized;
        for (let folder = this.currentFolder; ; folder = parentFolderOf(folder)) {
            this.expanded.add(folder);
            if (folder === ROOT_FOLDER_PATH) break;
        }
        this.render();
        this.grid.querySelector(`.${SELECTED_CLASS}`)?.scrollIntoView({block: "nearest"});
    }

    private async reload(): Promise<void> {
        if (this.loading) {
            this.loadAgain = true;
            return;
        }
        this.loading = true;
        try {
            this.entries = await this.workspace.session.files.list();
            this.root = buildProjectTree(this.entries);
            if (findFolder(this.root, this.currentFolder) === undefined) this.currentFolder = ROOT_FOLDER_PATH;
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
        this.renderBreadcrumb();
        this.tree.replaceChildren(this.folderNode(this.root, 0));
        this.renderGrid();
    }

    private renderBreadcrumb(): void {
        const document = this.breadcrumb.ownerDocument;
        const parts = this.currentFolder === ROOT_FOLDER_PATH ? [] : this.currentFolder.split("/");
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
        row.classList.toggle(SELECTED_CLASS, folder.path === this.currentFolder);
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

    private renderGrid(): void {
        const document = this.grid.ownerDocument;
        const folder = findFolder(this.root, this.currentFolder) ?? this.root;
        const items: HTMLElement[] = [
            ...folder.folders.map(child => this.gridItem(document, child.path, "folder")),
            ...folder.files.map(entry => this.gridItem(document, normalizeProjectPath(entry.path), projectFileKind(entry.path))),
        ];
        if (items.length === 0) items.push(createElement(document, "p", "project-empty", EMPTY_FOLDER_TEXT));
        this.grid.replaceChildren(...items);
    }

    private gridItem(document: Document, path: string, kind: ItemKind): HTMLElement {
        const item = createElement(document, "div", `project-item kind-${kind}`);
        item.setAttribute("role", "option");
        item.tabIndex = -1;
        item.title = `${KIND_TITLES[kind]}: ${path}`;
        item.classList.toggle(SELECTED_CLASS, path === this.selectedPath);
        item.append(createElement(document, "span", `file-icon kind-${kind}`, ICON_TEXT[kind]), createElement(document, "span", "project-item-name", baseNameOf(path)));
        item.addEventListener("click", () => {
            this.selectedPath = path;
            for (const selected of this.grid.querySelectorAll(`.${SELECTED_CLASS}`)) selected.classList.remove(SELECTED_CLASS);
            item.classList.add(SELECTED_CLASS);
        });
        item.addEventListener("dblclick", () => this.activate(path, kind));
        item.addEventListener("contextmenu", event => {
            event.preventDefault();
            this.showItemMenu(event, path, kind);
        });
        if (kind === "folder") {
            this.installFolderDrop(item, () => path);
        } else {
            item.draggable = true;
            item.addEventListener("dragstart", event => {
                this.workspace.drag = {kind: "asset", path, fileKind: kind};
                if (event.dataTransfer === null) return;
                event.dataTransfer.effectAllowed = "copyMove";
                event.dataTransfer.setData(DRAG_TEXT_TYPE, path);
            });
            item.addEventListener("dragend", () => this.workspace.drag = undefined);
        }
        return item;
    }

    private openFolder(path: string): void {
        this.currentFolder = path;
        this.expanded.add(path);
        this.render();
    }

    private activate(path: string, kind: ItemKind): void {
        if (kind === "folder") this.openFolder(path);
        else if (kind === "scene" || kind === "prefab") void this.workspace.openDocument(path);
    }

    private installFolderDrop(element: HTMLElement, folderOf: () => string): void {
        const accepts = (): boolean => {
            const drag = this.workspace.drag;
            if (drag === undefined) return false;
            if (drag.kind === "entities") return drag.entities.length > 0;
            return !isAncestorFolder(drag.path, folderOf()) && parentFolderOf(drag.path) !== folderOf();
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
            else void this.moveFile(drag.path, folder);
        });
    }

    private async createPrefabs(entities: readonly Entity[], folder: string): Promise<void> {
        for (const entity of topmostEntities(entities, parentLookupOf(this.workspace.links()))) await this.workspace.createPrefab(entity, folder);
    }

    private async moveFile(path: string, folder: string): Promise<void> {
        const target = joinProjectPath(folder, baseNameOf(path));
        if (allProjectPaths(this.entries).has(target)) {
            this.workspace.notice("warn", `${target} already exists`);
            return;
        }
        await this.renameTo(path, target);
    }

    private showFolderMenu(event: MouseEvent, folder: string): void {
        const items: MenuItem[] = [
            {label: "New Folder", run: () => void this.createFolder(folder)},
            {label: "New Scene", run: () => void this.createScene(folder)},
        ];
        if (folder !== ROOT_FOLDER_PATH) {
            items.push(MENU_SEPARATOR,
                {label: "Rename", run: () => void this.rename(folder)},
                {label: "Delete", run: () => void this.remove(folder)});
        }
        showPopupMenu(this.grid.ownerDocument, event.clientX, event.clientY, items);
    }

    private showItemMenu(event: MouseEvent, path: string, kind: ItemKind): void {
        if (kind === "folder") {
            this.showFolderMenu(event, path);
            return;
        }
        const items: MenuItem[] = [];
        if (kind === "scene" || kind === "prefab") items.push({label: "Open", run: () => void this.workspace.openDocument(path)});
        if (isAssetKind(kind)) items.push({label: "Add to Scene", run: () => void this.workspace.instantiateAsset(path, {target: {parent: null, before: null}})});
        if (items.length > 0) items.push(MENU_SEPARATOR);
        items.push({label: "Rename", run: () => void this.rename(path)}, {label: "Delete", run: () => void this.remove(path)});
        showPopupMenu(this.grid.ownerDocument, event.clientX, event.clientY, items);
    }

    private async createFolder(parent: string): Promise<void> {
        const name = await askForText(this.grid.ownerDocument, {title: "New folder", label: "Folder name", initialValue: NEW_FOLDER_NAME, confirmText: "Create", validate: value => this.nameProblem(parent, value)});
        if (name === undefined) return;
        const path = joinProjectPath(parent, name.trim());
        try {
            await this.workspace.session.files.makeDirectory(path);
            this.expanded.add(parent);
            await this.reload();
        } catch (error) {
            this.workspace.reportError(error);
        }
    }

    private async createScene(folder: string): Promise<void> {
        const name = await askForText(this.grid.ownerDocument, {title: "New scene", label: "Scene name", initialValue: NEW_SCENE_NAME, confirmText: "Create", validate: value => this.nameProblem(folder, `${value.trim()}${SCENE_EXTENSION}`)});
        if (name === undefined) return;
        const path = uniqueChildPath(allProjectPaths(this.entries), folder, name.trim(), SCENE_EXTENSION);
        try {
            await this.workspace.session.files.write(path, sceneDocumentText({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: []}));
            await this.reload();
            this.reveal(path);
        } catch (error) {
            this.workspace.reportError(error);
        }
    }

    private nameProblem(folder: string, name: string): string | undefined {
        const problem = fileNameProblem(name);
        if (problem !== undefined) return problem;
        return allProjectPaths(this.entries).has(joinProjectPath(folder, name.trim())) ? `${name.trim()} already exists here` : undefined;
    }

    private async rename(path: string): Promise<void> {
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
        await this.renameTo(path, renamedPath(path, name));
    }

    private async renameTo(path: string, target: string): Promise<void> {
        try {
            await this.workspace.session.files.rename(path, target);
            const open = this.workspace.documentPath;
            if (open !== null && isAncestorFolder(path, open)) this.workspace.setDocument(target + open.slice(path.length), this.workspace.dirty);
            if (this.selectedPath === path) this.selectedPath = target;
            await this.reload();
        } catch (error) {
            this.workspace.reportError(error);
        }
    }

    private async remove(path: string): Promise<void> {
        const confirmed = await askForChoice(this.grid.ownerDocument, {
            title: "Delete",
            message: `Delete ${path}? This cannot be undone.`,
            choices: [{label: "Delete", value: true, primary: true}],
        });
        if (confirmed !== true) return;
        try {
            await this.workspace.session.files.remove(path);
            if (this.selectedPath !== undefined && isAncestorFolder(path, this.selectedPath)) this.selectedPath = undefined;
            if (isAncestorFolder(path, this.currentFolder) && path !== ROOT_FOLDER_PATH) this.currentFolder = parentFolderOf(path);
            await this.reload();
        } catch (error) {
            this.workspace.reportError(error);
        }
    }
}
