import type {Entity} from "../../engine/core";
import {DATA_ASSET_FILE_SUFFIX} from "../../engine/scene/dataAssetDocument";
import type {SceneJsonObject} from "../../engine/scene";
import type {EditorResourceDescription} from "../editorProtocol";
import {dataAssetTypeOf, filesWithSuffixes} from "./assetChoices";
import {
    dataAssetText,
    describeFieldChanges,
    groupDataAssetsByType,
    hasFieldChanges,
    isDraftDirty,
    knownFields,
    openDataAssetDraft,
    savedDraft,
    withDraftField,
} from "./dataAssetDrafts";
import type {DataAssetDraft, DataAssetListing} from "./dataAssetDrafts";
import {createButton, createElement, errorText} from "./dom";
import type {EditorWorkspace} from "./editorWorkspace";
import {fieldLabelElement} from "./fieldEditorBase";
import type {FieldEditor, FieldEditorServices} from "./fieldEditorBase";
import {workspaceFieldServices} from "./fieldEditorServices";
import {createFieldEditor} from "./fieldEditors";
import {baseNameOf, normalizeProjectPath, parentFolderOf} from "./projectFiles";
import type {RotationEulerCache} from "./rotationEulerCache";

export const DIRTY_MARKER = " *";

const NOTHING_SELECTED_TEXT = "Select a data asset on the left. Create one from the Project panel: right-click a folder, then Create > Data Asset.";
const NO_DATA_ASSETS_TEXT = "No *.asset.json files in the project yet.";
const LOADING_TEXT = "Loading…";
const NO_FIELDS_TEXT = "No fields";
const UNREADABLE_GROUP_TEXT = "Not a data asset";
const CHANGED_ON_DISK_TEXT = "The file changed on disk since you started editing it: Save overwrites it, Revert loads the new version.";
const NO_ENTITIES: readonly Entity[] = [];
const NO_DEFAULTS: SceneJsonObject = {};
const SELECTED_CLASS = "selected";
const DIRTY_CLASS = "dirty";
const UNREGISTERED_CLASS = "unregistered";

interface OpenedEditors {
    readonly path: string;
    readonly description: EditorResourceDescription;
    readonly editors: ReadonlyMap<string, FieldEditor>;
}

function unregisteredTypeText(type: string): string {
    return `${type} is not a resource type registered by this project's code, so this file cannot be edited here.`;
}

export class DataAssetsView {
    private readonly document: Document;
    private readonly list: HTMLElement;
    private readonly details: HTMLElement;
    private readonly note: HTMLElement;
    private readonly saveButton: HTMLButtonElement;
    private readonly revertButton: HTMLButtonElement;
    private readonly fieldServices: FieldEditorServices;
    private readonly drafts = new Map<string, DataAssetDraft>();
    private readonly problems = new Map<string, string>();
    private readonly changedOnDisk = new Set<string>();
    private readonly defaultsByType = new Map<string, Promise<SceneJsonObject>>();
    private readonly dirtyListeners = new Set<() => void>();
    private listings: readonly DataAssetListing[] = [];
    private selectedPath: string | undefined;
    private opened: OpenedEditors | undefined;
    private unsubscribeFiles: () => void = () => undefined;
    private visible = false;
    private listingStale = true;
    private scanning = false;
    private scanAgain = false;
    private wasDirty = false;

    public constructor(private readonly container: HTMLElement, private readonly workspace: EditorWorkspace, rotations: RotationEulerCache) {
        const document = container.ownerDocument;
        this.document = document;
        this.fieldServices = workspaceFieldServices(workspace, rotations);
        const toolbar = createElement(document, "div", "data-assets-toolbar");
        this.note = createElement(document, "span", "data-assets-note");
        this.saveButton = createButton(document, {className: "", text: "Save", title: "Write the selected data asset to its file (Ctrl+S while this panel has focus)", onClick: () => void this.save()});
        this.revertButton = createButton(document, {className: "", text: "Revert", title: "Discard your edits and load the file again", onClick: () => void this.revert()});
        toolbar.append(this.note, this.saveButton, this.revertButton, createButton(document, {
            className: "",
            text: "Refresh",
            title: "List the project's data assets again",
            onClick: () => this.markListingStale(),
        }));
        const body = createElement(document, "div", "data-assets-body");
        this.list = createElement(document, "div", "data-assets-list");
        this.list.setAttribute("role", "listbox");
        this.details = createElement(document, "div", "data-assets-details");
        body.append(this.list, this.details);
        container.replaceChildren(toolbar, body);
        workspace.on("openDataAsset", () => {
            const path = workspace.openedDataAsset;
            if (path !== undefined) void this.open(path);
        });
        workspace.on("schemas", () => this.schemasChanged());
        this.rebind();
    }

    public get dirty(): boolean {
        return [...this.drafts.values()].some(isDraftDirty);
    }

    public onDirtyChanged(listener: () => void): () => void {
        this.dirtyListeners.add(listener);
        return () => this.dirtyListeners.delete(listener);
    }

    public rebind(): void {
        this.unsubscribeFiles();
        this.unsubscribeFiles = this.workspace.session.files.onChange(change => this.filesChanged(change.paths));
        this.markListingStale();
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
        if (visible && this.listingStale) void this.scan();
    }

    public hasFocus(): boolean {
        const active = this.document.activeElement;
        return active !== null && this.container.contains(active);
    }

    public async open(path: string): Promise<void> {
        const normalized = normalizeProjectPath(path);
        this.selectedPath = normalized;
        if (!this.listings.some(listing => listing.path === normalized)) this.markListingStale();
        this.render();
        if (!this.drafts.has(normalized)) await this.loadDraft(normalized);
        this.render();
    }

    public async save(): Promise<void> {
        const path = this.selectedPath;
        const draft = path === undefined ? undefined : this.drafts.get(path);
        if (path === undefined || draft === undefined) return;
        const description = this.workspace.resourceSchemas.get(draft.type);
        if (description === undefined) {
            this.workspace.notice("warn", unregisteredTypeText(draft.type));
            return;
        }
        try {
            const fields = knownFields(description, draft.fields, await this.defaultsOf(draft.type));
            await this.workspace.session.files.write(path, dataAssetText(draft.type, fields));
            this.drafts.set(path, savedDraft(this.drafts.get(path) ?? draft, fields));
            this.changedOnDisk.delete(path);
            this.workspace.notice("info", `Saved the data asset ${path}`);
        } catch (error) {
            this.workspace.reportError(error);
        }
        this.render();
    }

    private async revert(): Promise<void> {
        const path = this.selectedPath;
        if (path === undefined) return;
        await this.reloadDraft(path);
    }

    private async reloadDraft(path: string): Promise<void> {
        this.drafts.delete(path);
        this.changedOnDisk.delete(path);
        if (this.selectedPath === path) await this.loadDraft(path);
        this.render();
    }

    private markListingStale(): void {
        this.listingStale = true;
        if (this.visible) void this.scan();
    }

    private filesChanged(paths: readonly string[]): void {
        this.markListingStale();
        for (const path of new Set(paths.map(normalizeProjectPath))) {
            const draft = this.drafts.get(path);
            if (draft === undefined && !this.problems.has(path)) continue;
            this.problems.delete(path);
            if (draft !== undefined && isDraftDirty(draft)) void this.noteChangedOnDisk(path, draft);
            else void this.reloadDraft(path);
        }
    }

    private async noteChangedOnDisk(path: string, draft: DataAssetDraft): Promise<void> {
        const text = await this.workspace.session.files.readText(path).catch(() => undefined);
        if (text === dataAssetText(draft.type, draft.savedFields)) return;
        this.changedOnDisk.add(path);
        this.render();
    }

    private schemasChanged(): void {
        this.defaultsByType.clear();
        this.opened = undefined;
        for (const [path, draft] of [...this.drafts]) {
            if (!isDraftDirty(draft)) this.drafts.delete(path);
        }
        const selected = this.selectedPath;
        if (selected !== undefined && !this.drafts.has(selected)) void this.loadDraft(selected).then(() => this.render());
        this.render();
    }

    private defaultsOf(type: string): Promise<SceneJsonObject> {
        let defaults = this.defaultsByType.get(type);
        if (defaults === undefined) {
            defaults = this.workspace.request({op: "defaultResourceFields", typeName: type}).then(result => result.fields, () => NO_DEFAULTS);
            this.defaultsByType.set(type, defaults);
        }
        return defaults;
    }

    private async loadDraft(path: string): Promise<void> {
        try {
            const text = await this.workspace.session.files.readText(path);
            const type = dataAssetTypeOf(text);
            const description = type === undefined ? undefined : this.workspace.resourceSchemas.get(type);
            const defaults = description === undefined ? NO_DEFAULTS : await this.defaultsOf(description.typeName);
            this.drafts.set(path, openDataAssetDraft(path, text, description, defaults));
            this.problems.delete(path);
        } catch (error) {
            this.drafts.delete(path);
            this.problems.set(path, errorText(error));
        }
    }

    private async scan(): Promise<void> {
        if (this.scanning) {
            this.scanAgain = true;
            return;
        }
        this.scanning = true;
        this.listingStale = false;
        try {
            const files = this.workspace.session.files;
            const paths = filesWithSuffixes(await files.list(), [DATA_ASSET_FILE_SUFFIX]);
            this.listings = await Promise.all(paths.map(async path => {
                try {
                    return {path, type: dataAssetTypeOf(await files.readText(path))};
                } catch {
                    return {path, type: undefined};
                }
            }));
            this.render();
        } catch (error) {
            this.workspace.reportError(error);
        } finally {
            this.scanning = false;
            if (this.scanAgain) {
                this.scanAgain = false;
                void this.scan();
            }
        }
    }

    private render(): void {
        this.renderList();
        this.renderDetails();
        this.renderToolbar();
        this.announceDirty();
    }

    private announceDirty(): void {
        const dirty = this.dirty;
        if (dirty === this.wasDirty) return;
        this.wasDirty = dirty;
        for (const listener of [...this.dirtyListeners]) listener();
    }

    private renderToolbar(): void {
        const path = this.selectedPath;
        const draft = path === undefined ? undefined : this.drafts.get(path);
        const registered = draft !== undefined && this.workspace.resourceSchemas.has(draft.type);
        const dirty = draft !== undefined && isDraftDirty(draft);
        this.saveButton.disabled = !registered || !(dirty || hasFieldChanges(draft.changes) || this.changedOnDisk.has(path!));
        this.revertButton.disabled = !dirty && !(path !== undefined && this.changedOnDisk.has(path));
        this.note.textContent = path === undefined ? "" : `${path}${dirty ? DIRTY_MARKER : ""}`;
        this.note.title = path ?? "";
    }

    private renderList(): void {
        const document = this.document;
        const listed = new Map(this.listings.map(listing => [listing.path, listing]));
        for (const [path, draft] of this.drafts) {
            if (!listed.has(path)) listed.set(path, {path, type: draft.type});
        }
        const groups = groupDataAssetsByType([...listed.values()]);
        if (groups.length === 0) {
            this.list.replaceChildren(createElement(document, "p", "data-assets-empty", this.listingStale ? LOADING_TEXT : NO_DATA_ASSETS_TEXT));
            return;
        }
        const children: HTMLElement[] = [];
        for (const group of groups) {
            const heading = createElement(document, "h3", "data-assets-type", group.type ?? UNREADABLE_GROUP_TEXT);
            const unregistered = group.type !== undefined && !this.workspace.resourceSchemas.has(group.type);
            heading.classList.toggle(UNREGISTERED_CLASS, unregistered);
            if (unregistered) heading.title = unregisteredTypeText(group.type!);
            children.push(heading);
            for (const path of group.paths) children.push(this.listItem(path));
        }
        this.list.replaceChildren(...children);
    }

    private listItem(path: string): HTMLElement {
        const document = this.document;
        const draft = this.drafts.get(path);
        const dirty = draft !== undefined && isDraftDirty(draft);
        const item = createElement(document, "button", "data-assets-item");
        item.type = "button";
        item.setAttribute("role", "option");
        const selected = path === this.selectedPath;
        item.classList.toggle(SELECTED_CLASS, selected);
        item.classList.toggle(DIRTY_CLASS, dirty);
        item.setAttribute("aria-selected", String(selected));
        item.title = path;
        const folder = parentFolderOf(path);
        item.append(createElement(document, "span", "data-assets-item-name", `${baseNameOf(path)}${dirty ? DIRTY_MARKER : ""}`));
        if (folder.length > 0) item.append(createElement(document, "span", "data-assets-item-folder", folder));
        item.addEventListener("click", () => void this.open(path));
        return item;
    }

    private renderDetails(): void {
        const document = this.document;
        const path = this.selectedPath;
        if (path === undefined) {
            this.opened = undefined;
            this.details.replaceChildren(createElement(document, "p", "data-assets-empty", NOTHING_SELECTED_TEXT));
            return;
        }
        const problem = this.problems.get(path);
        const draft = this.drafts.get(path);
        if (problem !== undefined || draft === undefined) {
            this.opened = undefined;
            this.details.replaceChildren(createElement(document, "p", problem === undefined ? "data-assets-empty" : "data-assets-warning", problem ?? LOADING_TEXT));
            return;
        }
        const description = this.workspace.resourceSchemas.get(draft.type);
        if (description === undefined) {
            this.opened = undefined;
            this.details.replaceChildren(this.header(draft), createElement(document, "p", "data-assets-warning", unregisteredTypeText(draft.type)));
            return;
        }
        const opened = this.opened;
        if (opened === undefined || opened.path !== path || opened.description !== description) this.buildEditors(draft, description);
        for (const [key, editor] of this.opened!.editors) {
            const value = draft.fields[key];
            if (value !== undefined) editor.show([value]);
        }
        this.showWarnings(draft);
    }

    private header(draft: DataAssetDraft): HTMLElement {
        const document = this.document;
        const header = createElement(document, "header", "data-assets-header");
        header.append(createElement(document, "span", "data-assets-header-type", draft.type), createElement(document, "span", "data-assets-header-path", draft.path));
        return header;
    }

    private showWarnings(draft: DataAssetDraft): void {
        const warnings = this.details.querySelector(".data-assets-warnings");
        if (warnings === null) return;
        const texts: string[] = [];
        if (hasFieldChanges(draft.changes)) texts.push(describeFieldChanges(draft.type, draft.changes));
        if (this.changedOnDisk.has(draft.path)) texts.push(CHANGED_ON_DISK_TEXT);
        warnings.replaceChildren(...texts.map(text => createElement(this.document, "p", "data-assets-warning", text)));
    }

    private buildEditors(draft: DataAssetDraft, description: EditorResourceDescription): void {
        const document = this.document;
        const path = draft.path;
        const fields = createElement(document, "div", "data-assets-fields");
        fields.setAttribute("aria-label", `${draft.type} fields in ${path}`);
        if (description.fields.length === 0) fields.append(createElement(document, "p", "component-empty", NO_FIELDS_TEXT));
        const editors = new Map<string, FieldEditor>();
        for (const field of description.fields) {
            const label = fieldLabelElement(document, field.key, field);
            const editor = createFieldEditor(document, {
                typeName: draft.type,
                field,
                entities: NO_ENTITIES,
                label,
                services: this.fieldServices,
                commit: async (_before, after) => {
                    const value = after[0];
                    const current = this.drafts.get(path);
                    if (value === undefined || current === undefined) return undefined;
                    this.drafts.set(path, withDraftField(current, field.key, value));
                    this.renderList();
                    this.renderToolbar();
                    this.announceDirty();
                    return [value];
                },
            });
            const row = createElement(document, "div", "field-row");
            row.append(label, editor.element);
            fields.append(row);
            editors.set(field.key, editor);
        }
        this.details.replaceChildren(this.header(draft), createElement(document, "div", "data-assets-warnings"), fields);
        this.opened = {path, description, editors};
    }
}
