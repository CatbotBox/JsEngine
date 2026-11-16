import type {Entity} from "../../engine/core";
import type {SceneJsonValue} from "../../engine/scene";
import type {EditorMode, EditorResourceDescription, EditorResourceDetails, EditorSettingsEntity, SetFieldResult} from "../editorProtocol";
import {createButton, createElement} from "./dom";
import {CoalescedRefresh, ENTITY_LIST_POLL_INTERVAL_MS, SELECTED_ENTITY_PLAY_POLL_INTERVAL_MS} from "./editorRefresh";
import type {EditorWorkspace} from "./editorWorkspace";
import {fieldLabelElement} from "./fieldEditorBase";
import type {FieldEditor, FieldEditorServices} from "./fieldEditorBase";
import {workspaceFieldServices} from "./fieldEditorServices";
import {createFieldEditor} from "./fieldEditors";
import {entityLabel} from "./fieldValueText";
import type {RotationEulerCache} from "./rotationEulerCache";

const NO_SETTINGS_TEXT = "No entity holds a Settings component.";
const NO_RESOURCES_TEXT = "The world holds no registered resource.";
const READ_ONLY_TEXT = "read-only while editing";
const LIVE_TEXT = "live";
const EDITING_NOTE = "Resources are read-only while editing; press Play to see and change them live.";
const PLAYING_NOTE = "Resources are live: changes apply to the running game and are discarded when it stops.";
const NO_FIELDS_TEXT = "No fields";
const SELECTED_CLASS = "selected";
const DISABLED_CLASS = "disabled";
const LIVE_CLASS = "live";
const NO_ENTITIES: readonly Entity[] = [];
const COMPONENT_NAME_SEPARATOR = ", ";

type IntervalHandle = ReturnType<typeof setInterval>;

function isEditing(mode: EditorMode): boolean {
    return mode === "edit";
}

class ResourceView {
    public readonly element: HTMLElement;
    private readonly source: HTMLElement;
    private readonly badge: HTMLElement;
    private readonly fields: HTMLFieldSetElement;
    private readonly editors = new Map<string, FieldEditor>();

    public constructor(private readonly settings: SettingsView, private readonly description: EditorResourceDescription) {
        const document = settings.document;
        const typeName = description.typeName;
        this.element = createElement(document, "section", "settings-resource");
        const header = createElement(document, "header", "settings-resource-header");
        this.source = createElement(document, "span", "settings-resource-source");
        this.badge = createElement(document, "span", "component-badge");
        header.append(createElement(document, "span", "settings-resource-name", typeName), this.source, this.badge);
        this.fields = createElement(document, "fieldset", "settings-resource-fields");
        this.fields.setAttribute("aria-label", `${typeName} fields`);
        if (description.fields.length === 0) this.fields.append(createElement(document, "p", "component-empty", NO_FIELDS_TEXT));
        for (const field of description.fields) {
            const label = fieldLabelElement(document, field.key, field);
            const editor = createFieldEditor(document, {
                typeName,
                field,
                entities: NO_ENTITIES,
                label,
                services: settings.fieldServices,
                commit: async (_before, after) => {
                    const value = after[0];
                    if (value === undefined) return undefined;
                    const result = await settings.setResourceField(typeName, field.key, value);
                    return result === undefined ? undefined : [result.value];
                },
            });
            const row = createElement(document, "div", "field-row");
            row.append(label, editor.element);
            this.fields.append(row);
            this.editors.set(field.key, editor);
        }
        this.element.append(header, this.fields);
    }

    public get typeName(): string {
        return this.description.typeName;
    }

    public show(details: EditorResourceDetails, readOnly: boolean): void {
        this.source.textContent = details.dataAssetPath === null ? "" : details.dataAssetPath;
        this.source.title = details.dataAssetPath === null ? "" : `Loaded from the data asset ${details.dataAssetPath}`;
        this.showReadOnly(readOnly);
        for (const [key, editor] of this.editors) {
            const value = details.fields[key];
            if (value !== undefined) editor.show([value]);
        }
    }

    public showReadOnly(readOnly: boolean): void {
        this.fields.disabled = readOnly;
        this.badge.textContent = readOnly ? READ_ONLY_TEXT : LIVE_TEXT;
        this.badge.classList.toggle(LIVE_CLASS, !readOnly);
    }

    public showEntityChoices(): void {
        for (const editor of this.editors.values()) editor.showEntityChoices();
    }
}

export class SettingsView {
    public readonly document: Document;
    public readonly fieldServices: FieldEditorServices;
    private readonly note: HTMLElement;
    private readonly entityList: HTMLElement;
    private readonly resourceList: HTMLElement;
    private readonly resourcesEmpty: HTMLElement;
    private readonly refresher = new CoalescedRefresh(() => this.refresh());
    private resourceViews = new Map<string, ResourceView>();
    private entityRows: {readonly entity: Entity, readonly element: HTMLElement}[] = [];
    private entitiesKey: string | undefined;
    private visible = false;
    private timer: IntervalHandle | undefined;
    private shownMode: EditorMode | undefined;
    private editGeneration = 0;

    public constructor(container: HTMLElement, private readonly workspace: EditorWorkspace, rotations: RotationEulerCache) {
        const document = container.ownerDocument;
        this.document = document;
        this.fieldServices = workspaceFieldServices(workspace, rotations, () => isEditing(workspace.mode));
        const toolbar = createElement(document, "div", "settings-toolbar");
        this.note = createElement(document, "span", "settings-note");
        toolbar.append(this.note, createButton(document, {className: "", text: "Refresh", title: "Read the settings and resources again", onClick: () => this.refresher.trigger()}));
        const body = createElement(document, "div", "settings-body");
        const entities = createElement(document, "section", "settings-entities");
        entities.append(createElement(document, "h3", "settings-heading", "Settings entities"));
        this.entityList = createElement(document, "div", "settings-entity-list");
        this.entityList.setAttribute("role", "listbox");
        entities.append(this.entityList);
        const resources = createElement(document, "section", "settings-resources");
        resources.append(createElement(document, "h3", "settings-heading", "Resources"));
        this.resourcesEmpty = createElement(document, "p", "settings-empty", NO_RESOURCES_TEXT);
        this.resourcesEmpty.hidden = true;
        this.resourceList = createElement(document, "div", "settings-resource-list");
        resources.append(this.resourcesEmpty, this.resourceList);
        body.append(entities, resources);
        container.replaceChildren(toolbar, body);

        workspace.on("state", () => this.stateChanged());
        workspace.on("sceneLoaded", () => this.refresher.trigger());
        workspace.on("selection", () => this.showSelection());
        workspace.on("entities", () => {
            for (const view of this.resourceViews.values()) view.showEntityChoices();
        });
        workspace.on("schemas", () => {
            this.resourceViews = new Map();
            this.resourceList.replaceChildren();
            this.refresher.trigger();
        });
        this.stateChanged();
    }

    public setVisible(visible: boolean): void {
        if (this.visible === visible) return;
        this.visible = visible;
        this.restartPolling();
        if (visible) this.refresher.trigger();
    }

    public setResourceField(typeName: string, key: string, value: SceneJsonValue): Promise<SetFieldResult | undefined> {
        this.editGeneration++;
        return this.workspace.setResourceField(typeName, key, value);
    }

    private stateChanged(): void {
        const mode = this.workspace.mode;
        if (mode === this.shownMode) return;
        this.shownMode = mode;
        this.note.textContent = isEditing(mode) ? EDITING_NOTE : PLAYING_NOTE;
        for (const view of this.resourceViews.values()) view.showReadOnly(isEditing(mode));
        this.restartPolling();
        this.refresher.trigger();
    }

    private restartPolling(): void {
        if (this.timer !== undefined) clearInterval(this.timer);
        this.timer = undefined;
        if (!this.visible) return;
        const intervalMs = isEditing(this.workspace.mode) ? ENTITY_LIST_POLL_INTERVAL_MS : SELECTED_ENTITY_PLAY_POLL_INTERVAL_MS;
        this.timer = setInterval(() => this.refresher.trigger(), intervalMs);
    }

    private async refresh(): Promise<void> {
        const workspace = this.workspace;
        if (!this.visible || workspace.closed) return;
        const generation = this.editGeneration;
        try {
            const listed = await workspace.request({op: "listSettings"});
            const details = await Promise.all(listed.resources.map(resource => this.resourceDetails(resource.typeName)));
            if (generation !== this.editGeneration) return;
            this.showEntities(listed.entities);
            this.showResources(details.filter((entry): entry is EditorResourceDetails => entry !== undefined));
        } catch (error) {
            workspace.reportError(error);
        }
    }

    private async resourceDetails(typeName: string): Promise<EditorResourceDetails | undefined> {
        try {
            return await this.workspace.request({op: "getResource", typeName});
        } catch {
            return undefined;
        }
    }

    private showEntities(entities: readonly EditorSettingsEntity[]): void {
        const key = entities.map(entry => `${entry.entity}:${entry.name ?? ""}:${entry.enabled}:${entry.settingsComponentTypeNames.join(",")}`).join("\n");
        if (key === this.entitiesKey) return;
        this.entitiesKey = key;
        const document = this.document;
        this.entityRows = entities.map(entry => {
            const element = createElement(document, "button", "settings-entity");
            element.type = "button";
            element.setAttribute("role", "option");
            element.classList.toggle(DISABLED_CLASS, !entry.enabled);
            const components = entry.settingsComponentTypeNames.join(COMPONENT_NAME_SEPARATOR);
            element.title = `Select ${entityLabel(entry.entity, entry.name)} to edit ${components} in the Inspector`;
            element.append(createElement(document, "span", "settings-entity-name", entityLabel(entry.entity, entry.name)), createElement(document, "span", "settings-entity-components", components));
            element.addEventListener("click", () => this.workspace.select([entry.entity]));
            return {entity: entry.entity, element};
        });
        this.entityList.replaceChildren(...(this.entityRows.length === 0 ? [createElement(document, "p", "settings-empty", NO_SETTINGS_TEXT)] : this.entityRows.map(row => row.element)));
        this.showSelection();
    }

    private showSelection(): void {
        const selected = new Set(this.workspace.selection);
        for (const row of this.entityRows) {
            const isSelected = selected.has(row.entity);
            row.element.classList.toggle(SELECTED_CLASS, isSelected);
            row.element.setAttribute("aria-selected", String(isSelected));
        }
    }

    private showResources(details: readonly EditorResourceDetails[]): void {
        const present = new Set(details.map(entry => entry.typeName));
        for (const [typeName, view] of this.resourceViews) {
            if (present.has(typeName)) continue;
            view.element.remove();
            this.resourceViews.delete(typeName);
        }
        const readOnly = isEditing(this.workspace.mode);
        let position = 0;
        for (const entry of details) {
            let view = this.resourceViews.get(entry.typeName);
            if (view === undefined) {
                const description = this.workspace.resourceSchemas.get(entry.typeName);
                if (description === undefined) continue;
                view = new ResourceView(this, description);
                this.resourceViews.set(entry.typeName, view);
            }
            view.show(entry, readOnly);
            const atPosition = this.resourceList.children.item(position);
            if (atPosition !== view.element) this.resourceList.insertBefore(view.element, atPosition);
            position++;
        }
        this.resourcesEmpty.hidden = this.resourceViews.size > 0;
    }
}
