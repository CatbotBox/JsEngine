import type {Key} from "../../engine/input/key";
import type {ProjectFileChange} from "../project/projectFileSystem";
import {askForChoice, openModal} from "./dialogs";
import type {Modal} from "./dialogs";
import {createButton, createElement, hasCommandModifier} from "./dom";
import {changedManifestFields} from "./projectManifestEdits";
import {ProjectSettingsModel} from "./projectSettingsModel";
import type {ProjectSettingsServices} from "./projectSettingsModel";
import {BindingListener, buildInputMapTab, buildManifestTab, buildRenderTab, PROJECT_SETTINGS_TAB_LABELS, PROJECT_SETTINGS_TABS} from "./projectSettingsTabs";
import type {ProjectSettingsTab, ProjectSettingsTabContext, ProjectSettingsTabName} from "./projectSettingsTabs";

export interface ProjectSettingsHost {
    readonly document: Document;
    readonly services: ProjectSettingsServices;
    readonly typeNames: () => readonly string[];
    readonly keyOfEvent?: (event: KeyboardEvent) => Key | undefined;
    readonly onFilesChanged: (listener: (change: ProjectFileChange) => void) => () => void;
}

type CloseChoice = "save" | "discard";

export const PROJECT_SETTINGS_TITLE = "Project Settings";

const DIRTY_MARKER = " *";
const SAVE_KEY = "s";
const ACTIVE_CLASS = "active";
const UNSAVED_TEXT = "Unsaved changes";
const INVALID_TEXT = "Fix the problems shown in red to save";
const SAVING_TEXT = "Saving…";
const CHANGED_ON_DISK_TEXT = "Changed on disk since you started editing: Save overwrites it, Revert loads the new version.";
const CLOSE_PROMPT = "The project settings have unsaved changes.";
const CLOSE_CHOICES = [
    {label: "Save", value: "save" as CloseChoice, primary: true},
    {label: "Discard", value: "discard" as CloseChoice},
];
const RENDER_FIELD = "targets";
const TARGET_AREA_PREFIX = `${RENDER_FIELD}.`;
const HAS_ERRORS_CLASS = "has-errors";

export class ProjectSettingsWindow {
    private readonly model: ProjectSettingsModel;
    private readonly modal: Modal;
    private readonly tabButtons = new Map<ProjectSettingsTabName, HTMLButtonElement>();
    private readonly body: HTMLElement;
    private readonly notice: HTMLElement;
    private readonly status: HTMLElement;
    private readonly saveButton: HTMLButtonElement;
    private readonly revertButton: HTMLButtonElement;
    private readonly bindingListener = new BindingListener();
    private readonly unsubscribe: () => void;
    private activeTab: ProjectSettingsTabName = "manifest";
    private shown: ProjectSettingsTab | undefined;
    private shownRevision = -1;
    private closing = false;
    private closed = false;

    private constructor(private readonly host: ProjectSettingsHost, private readonly onClosed: () => void) {
        const document = host.document;
        this.model = new ProjectSettingsModel(host.services);
        this.modal = openModal(document, PROJECT_SETTINGS_TITLE, () => void this.close());
        const dialog = this.modal.dialog;
        dialog.classList.add("project-settings-dialog");
        const tabs = createElement(document, "div", "editor-tabs project-settings-tabs");
        tabs.setAttribute("role", "tablist");
        for (const tab of PROJECT_SETTINGS_TABS) {
            const button = createButton(document, {className: "editor-tab", text: PROJECT_SETTINGS_TAB_LABELS[tab], title: `Show the ${PROJECT_SETTINGS_TAB_LABELS[tab]} settings`, onClick: () => this.showTab(tab)});
            button.setAttribute("role", "tab");
            this.tabButtons.set(tab, button);
            tabs.append(button);
        }
        this.notice = createElement(document, "p", "project-settings-notice");
        this.body = createElement(document, "div", "project-settings-body");
        this.status = createElement(document, "span", "project-settings-status");
        this.revertButton = createButton(document, {className: "", text: "Revert", title: "Discard your edits and load the files again", onClick: () => void this.revert()});
        this.saveButton = createButton(document, {className: "primary", text: "Save", title: "Write jsengine.project.json and the input map (Ctrl+S), then run jsengine generate", onClick: () => void this.save()});
        const close = createButton(document, {className: "", text: "Close", title: "Close Project Settings", onClick: () => void this.close()});
        this.modal.buttons.append(this.status, this.revertButton, this.saveButton, close);
        for (const element of [tabs, this.notice, this.body]) dialog.insertBefore(element, this.modal.buttons);
        dialog.addEventListener("keydown", event => {
            if (!hasCommandModifier(event) || event.key.toLowerCase() !== SAVE_KEY) return;
            event.preventDefault();
            void this.save();
        });
        this.model.onChange(() => this.modelChanged());
        this.unsubscribe = host.onFilesChanged(change => void this.model.filesChanged(change.paths));
        this.showTab(this.activeTab);
        void this.model.load();
    }

    public static open(host: ProjectSettingsHost, onClosed: () => void): ProjectSettingsWindow {
        return new ProjectSettingsWindow(host, onClosed);
    }

    public get dirty(): boolean {
        return this.model.dirty;
    }

    public focus(): void {
        this.tabButtons.get(this.activeTab)?.focus();
    }

    public async close(): Promise<boolean> {
        if (this.closed || this.closing) return this.closed;
        if (this.model.dirty) {
            this.closing = true;
            const choice = await askForChoice<CloseChoice>(this.host.document, {title: PROJECT_SETTINGS_TITLE, message: CLOSE_PROMPT, choices: CLOSE_CHOICES});
            this.closing = false;
            if (choice === undefined) return false;
            if (choice === "save" && !await this.model.save()) return false;
        }
        this.closed = true;
        this.bindingListener.cancel();
        this.unsubscribe();
        this.modal.close();
        this.onClosed();
        return true;
    }

    private context(): ProjectSettingsTabContext {
        return {
            document: this.host.document,
            model: this.model,
            typeNames: this.host.typeNames,
            ...(this.host.keyOfEvent === undefined ? {} : {keyOfEvent: this.host.keyOfEvent}),
            rebuild: () => this.rebuild(),
        };
    }

    private showTab(tab: ProjectSettingsTabName): void {
        this.activeTab = tab;
        for (const [name, button] of this.tabButtons) {
            const active = name === tab;
            button.classList.toggle(ACTIVE_CLASS, active);
            button.setAttribute("aria-selected", String(active));
        }
        this.rebuild();
    }

    private rebuild(): void {
        this.bindingListener.cancel();
        const context = this.context();
        switch (this.activeTab) {
            case "manifest":
                this.shown = buildManifestTab(context);
                break;
            case "inputMap":
                this.shown = buildInputMapTab(context, this.bindingListener);
                break;
            case "render":
                this.shown = buildRenderTab(context);
                break;
        }
        this.shownRevision = this.model.revision;
        this.body.replaceChildren(this.shown.element);
        this.showState();
    }

    private modelChanged(): void {
        if (this.closed) return;
        if (this.model.revision !== this.shownRevision) this.rebuild();
        else this.showState();
    }

    private showState(): void {
        const model = this.model;
        this.shown?.showState();
        const manifest = model.manifest;
        const changedFields = manifest?.kind === "loaded" ? changedManifestFields(manifest.savedText, manifest.draft) : [];
        const dirtyTabs: Readonly<Record<ProjectSettingsTabName, boolean>> = {
            manifest: changedFields.length > 0,
            inputMap: model.inputMapDirty,
            render: changedFields.includes(RENDER_FIELD),
        };
        const problemAreas = [...(model.manifestCheck()?.problems.keys() ?? [])];
        const tabProblems: Readonly<Record<ProjectSettingsTabName, boolean>> = {
            manifest: problemAreas.some(area => !area.startsWith(TARGET_AREA_PREFIX)),
            inputMap: model.inputMapProblems().size > 0,
            render: problemAreas.some(area => area.startsWith(TARGET_AREA_PREFIX)),
        };
        for (const [tab, button] of this.tabButtons) {
            button.textContent = PROJECT_SETTINGS_TAB_LABELS[tab] + (dirtyTabs[tab] ? DIRTY_MARKER : "");
            button.classList.toggle(HAS_ERRORS_CLASS, tabProblems[tab]);
        }
        this.saveButton.disabled = !model.savable;
        this.revertButton.disabled = !model.dirty && model.changedOnDisk.size === 0;
        this.status.textContent = model.saving ? SAVING_TEXT : model.dirty ? (model.savable ? UNSAVED_TEXT : INVALID_TEXT) : "";
        this.notice.textContent = model.changedOnDisk.size > 0 ? CHANGED_ON_DISK_TEXT : "";
        this.notice.hidden = model.changedOnDisk.size === 0;
    }

    private async save(): Promise<void> {
        if (!this.model.savable) return;
        await this.model.save();
    }

    private async revert(): Promise<void> {
        await this.model.load();
    }
}
