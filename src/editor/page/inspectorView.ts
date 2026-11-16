import type {Entity} from "../../engine/core";
import type {SceneJsonObject, SceneJsonValue} from "../../engine/scene";
import type {EditorComponentDescription, EditorEntityDetails, EditorFieldDescription} from "../editorProtocol";
import {AddComponentPopup, requiredEntityFields} from "./addComponentPopup";
import {createButton, createElement, isFocusWithin} from "./dom";
import type {EditorWorkspace} from "./editorWorkspace";
import {fieldLabelElement} from "./fieldEditorBase";
import type {FieldEditor, FieldEditorServices} from "./fieldEditorBase";
import {workspaceFieldServices} from "./fieldEditorServices";
import {createFieldEditor} from "./fieldEditors";
import {entityLabel} from "./fieldValueText";
import {fieldValuesOf, missingInSome, sharedBoolean, sharedComponents} from "./multiSelection";
import type {SharedComponent} from "./multiSelection";
import {isComponentOverridden, overriddenFieldKeys, pathWithinInstance} from "./prefabInstancePaths";
import {showPopupMenu} from "./popupMenu";
import {ProjectFilePreview} from "./projectPreview";
import type {MenuItem} from "./popupMenu";
import {MAX_INSPECTED_ENTITIES} from "./editorRefresh";
import type {RotationEulerCache} from "./rotationEulerCache";
import {entityValueShapeOf} from "./undoStack";

const NO_SELECTION_TEXT = "Select an entity in the Hierarchy or the Scene view.";
const LOADING_TEXT = "Loading…";
const INFERRED_BADGE_TEXT = "inferred (not saved)";
const READ_ONLY_BADGE_TEXT = "read-only";
const NO_FIELDS_TEXT = "No fields";
const MIXED_NAME_PLACEHOLDER = "—";
const COLLAPSED_CLASS = "collapsed";
const OVERRIDDEN_CLASS = "overridden";
const POPUP_REOPEN_GUARD_MS = 250;

interface InspectedSelection {
    readonly entities: readonly Entity[];
    readonly details: readonly EditorEntityDetails[];
    readonly overrides: readonly string[];
    readonly entityPath: string | undefined;
}

class ComponentView {
    public readonly element: HTMLElement;
    private readonly header: HTMLElement;
    private readonly body: HTMLElement;
    private readonly editors = new Map<string, {readonly editor: FieldEditor, readonly row: HTMLElement}>();
    private shared: SharedComponent | undefined;

    public constructor(
        private readonly inspector: InspectorView,
        private readonly entities: readonly Entity[],
        private readonly typeName: string,
        private readonly schema: EditorComponentDescription | undefined,
        inspectable: boolean,
        inferred: boolean,
    ) {
        const document = inspector.document;
        const editable = inspectable && schema !== undefined && schema.persistence === "fields";
        this.element = createElement(document, "section", editable ? "component" : "component read-only");
        this.header = createElement(document, "header", "component-header");
        const toggle = createElement(document, "button", "component-toggle");
        toggle.type = "button";
        toggle.title = `Show or hide ${typeName}`;
        toggle.append(createElement(document, "span", "component-arrow"), createElement(document, "span", "component-name", typeName));
        toggle.addEventListener("click", () => this.setCollapsed(!this.element.classList.contains(COLLAPSED_CLASS)));
        this.header.append(toggle);
        if (inferred) this.header.append(createElement(document, "span", "component-badge inferred", INFERRED_BADGE_TEXT));
        if (!editable) this.header.append(createElement(document, "span", "component-badge", READ_ONLY_BADGE_TEXT));
        const menu = createButton(document, {className: "component-menu", text: "⋮", title: `${typeName} actions`, onClick: event => this.openMenu(event)});
        menu.disabled = !editable;
        this.header.append(menu);
        this.body = createElement(document, "div", "component-body");
        this.element.append(this.header, this.body);
        this.setCollapsed(inspector.isCollapsed(typeName));
        if (!editable || schema === undefined) return;
        if (schema.fields.length === 0) this.body.append(createElement(document, "p", "component-empty", NO_FIELDS_TEXT));
        for (const field of schema.fields) this.body.append(this.fieldRow(field));
    }

    public show(shared: SharedComponent, overriddenKeys: ReadonlySet<string>, componentOverridden: boolean): void {
        this.shared = shared;
        this.header.classList.toggle(OVERRIDDEN_CLASS, componentOverridden);
        for (const [key, {editor, row}] of this.editors) {
            editor.show(fieldValuesOf(shared, key));
            row.classList.toggle(OVERRIDDEN_CLASS, overriddenKeys.has(key));
        }
    }

    public showEntityChoices(): void {
        for (const {editor} of this.editors.values()) editor.showEntityChoices();
    }

    private setCollapsed(collapsed: boolean): void {
        this.element.classList.toggle(COLLAPSED_CLASS, collapsed);
        this.inspector.setCollapsed(this.typeName, collapsed);
    }

    private fieldRow(field: EditorFieldDescription): HTMLElement {
        const document = this.inspector.document;
        const row = createElement(document, "div", "field-row");
        const label = fieldLabelElement(document, field.key, field);
        const workspace = this.inspector.workspace;
        const entityShape = entityValueShapeOf(field);
        const editor = createFieldEditor(document, {
            typeName: this.typeName,
            field,
            entities: this.entities,
            label,
            services: this.inspector.fieldServices,
            commit: async (before, after, coalesceKey) => {
                const changes = this.entities.map((entity, index) => ({
                    entity,
                    typeName: this.typeName,
                    key: field.key,
                    before: before[index] as SceneJsonValue,
                    after: after[index],
                    entityShape,
                }));
                const result = await workspace.setFields(changes, `Edit ${this.typeName}.${field.key}`, coalesceKey);
                return result?.values;
            },
        });
        this.editors.set(field.key, {editor, row});
        row.append(label, editor.element);
        return row;
    }

    private openMenu(event: MouseEvent): void {
        const workspace = this.inspector.workspace;
        const typeName = this.typeName;
        const first = this.shared?.perEntity[0];
        const resettable = this.schema !== undefined && requiredEntityFields(this.schema).length === 0;
        const clipboard = workspace.componentClipboard;
        const items: MenuItem[] = [
            {label: "Reset", disabled: !resettable, run: () => void workspace.resetComponent(this.entities, typeName)},
            {label: "Remove Component", run: () => void workspace.removeComponent(this.entities, typeName)},
            "separator",
            {label: "Copy Component Values", disabled: first === undefined, run: () => first !== undefined && workspace.copyComponentValues(first)},
            {label: "Paste Component Values", disabled: clipboard?.typeName !== typeName, run: () => void workspace.pasteComponentValues(this.entities, typeName)},
        ];
        showPopupMenu(this.inspector.document, event.clientX, event.clientY, items);
    }
}

export class InspectorView {
    public readonly document: Document;
    public readonly fieldServices: FieldEditorServices;
    private readonly placeholder: HTMLElement;
    private readonly root: HTMLElement;
    private readonly enabled: HTMLInputElement;
    private readonly nameInput: HTMLInputElement;
    private readonly handle: HTMLElement;
    private readonly prefabBar: HTMLElement;
    private readonly prefabLabel: HTMLElement;
    private readonly componentList: HTMLElement;
    private readonly addButton: HTMLButtonElement;
    private readonly addHost: HTMLElement;
    private readonly requiredForm: HTMLElement;
    private readonly collapsedTypes = new Set<string>();
    private views = new Map<string, ComponentView>();
    private shownKey: string | undefined;
    private popup: AddComponentPopup | undefined;
    private inspected: InspectedSelection | undefined;
    private schemasStale = false;
    private popupClosedAtMs = Number.NEGATIVE_INFINITY;
    private readonly filePreview: ProjectFilePreview;

    public constructor(private readonly container: HTMLElement, public readonly workspace: EditorWorkspace, public readonly rotations: RotationEulerCache) {
        const document = container.ownerDocument;
        this.document = document;
        this.fieldServices = workspaceFieldServices(workspace, rotations);
        this.placeholder = createElement(document, "p", "inspector-placeholder", NO_SELECTION_TEXT);
        this.root = createElement(document, "div", "entity-inspector");
        const header = createElement(document, "header", "entity-header");
        this.enabled = createElement(document, "input", "field-input checkbox");
        this.enabled.type = "checkbox";
        this.enabled.title = "Enabled";
        this.enabled.setAttribute("aria-label", "Enabled");
        this.enabled.addEventListener("change", () => void workspace.setEnabled(this.inspected?.entities ?? [], this.enabled.checked));
        this.nameInput = createElement(document, "input", "field-input entity-name");
        this.nameInput.type = "text";
        this.nameInput.spellcheck = false;
        this.nameInput.setAttribute("aria-label", "Name");
        this.nameInput.addEventListener("change", () => this.renameInspected());
        this.nameInput.addEventListener("keydown", event => {
            if (event.key === "Enter") this.nameInput.blur();
        });
        this.handle = createElement(document, "span", "entity-handle");
        header.append(this.enabled, this.nameInput, this.handle);

        this.prefabBar = createElement(document, "div", "prefab-bar");
        this.prefabLabel = createElement(document, "span", "prefab-label");
        this.prefabBar.append(
            this.prefabLabel,
            createButton(document, {className: "", text: "Open", title: "Open the prefab file for editing", onClick: () => this.withPrefab(path => void workspace.openDocument(path))}),
            createButton(document, {className: "", text: "Select", title: "Show the prefab file in the Project view", onClick: () => this.withPrefab(path => workspace.reveal(path))}),
            createButton(document, {className: "", text: "Apply", title: "Write this instance's overrides into the prefab file and update every instance", onClick: () => this.withPrefabRoot(root => void workspace.applyPrefab(root))}),
            createButton(document, {className: "", text: "Revert", title: "Discard this instance's overrides", onClick: () => this.withPrefabRoot(root => void workspace.revertPrefab(root))}),
        );

        this.componentList = createElement(document, "div", "component-list");
        const addArea = createElement(document, "div", "add-component");
        this.addButton = createButton(document, {className: "add-component-button", text: "Add Component", title: "Add a component to the selection", onClick: () => this.toggleAddPopup()});
        this.addHost = createElement(document, "div", "add-component-host");
        this.requiredForm = createElement(document, "div", "required-values");
        this.requiredForm.hidden = true;
        addArea.append(this.addButton, this.addHost, this.requiredForm);
        this.root.append(header, this.prefabBar, this.componentList, addArea);
        this.filePreview = new ProjectFilePreview(document, workspace);
        container.replaceChildren(this.placeholder);

        workspace.on("inspectedFile", () => this.inspectedFileChanged());
        workspace.on("details", () => this.render());
        workspace.on("selection", () => this.selectionChanged());
        workspace.on("entities", () => this.showEntityChoices());
        workspace.on("schemas", () => {
            this.schemasStale = true;
            this.render();
        });
    }

    public isCollapsed(typeName: string): boolean {
        return this.collapsedTypes.has(typeName);
    }

    public setCollapsed(typeName: string, collapsed: boolean): void {
        if (collapsed) this.collapsedTypes.add(typeName);
        else this.collapsedTypes.delete(typeName);
    }

    private inspectedFileChanged(): void {
        const entry = this.workspace.inspectedFile;
        this.filePreview.show(entry);
        if (entry === undefined) {
            this.showPlaceholder(NO_SELECTION_TEXT);
            this.render();
            return;
        }
        this.showPlaceholder(NO_SELECTION_TEXT);
        this.container.replaceChildren(this.filePreview.element);
    }

    private selectionChanged(): void {
        if (this.workspace.inspectedFile !== undefined) return;
        if (this.workspace.selection.length === 0) {
            this.showPlaceholder(NO_SELECTION_TEXT);
            return;
        }
        if (this.shownKey !== this.workspace.selection.slice(0, MAX_INSPECTED_ENTITIES).join(",")) this.showPlaceholder(LOADING_TEXT);
    }

    private showPlaceholder(text: string): void {
        this.placeholder.textContent = text;
        this.shownKey = undefined;
        this.inspected = undefined;
        this.views = new Map();
        this.componentList.replaceChildren();
        this.closeAddPopup();
        this.hideRequiredForm();
        this.container.replaceChildren(this.placeholder);
    }

    private render(): void {
        if (this.workspace.inspectedFile !== undefined) return;
        const {details, overrides, overridesRoot} = this.workspace.selectionDetails;
        if (details.length === 0) {
            if (this.workspace.selection.length === 0) this.showPlaceholder(NO_SELECTION_TEXT);
            return;
        }
        const entities = details.map(entry => entry.entity);
        const key = entities.join(",");
        const primary = entities[0];
        const entityPath = overridesRoot === undefined || entities.length !== 1 ? undefined
            : pathWithinInstance(primary, overridesRoot, entity => this.workspace.summaryOf(entity));
        this.inspected = {entities, details, overrides: overrides?.overrides ?? [], entityPath};
        if (key !== this.shownKey || (this.schemasStale && !isFocusWithin(this.componentList))) {
            this.shownKey = key;
            this.schemasStale = false;
            this.views = new Map();
            this.componentList.replaceChildren();
            this.closeAddPopup();
            this.hideRequiredForm();
            this.container.replaceChildren(this.root);
        }
        this.showHeader(details, overrides?.sourcePath);
        this.showComponents(this.inspected);
    }

    private showHeader(details: readonly EditorEntityDetails[], prefabPath: string | undefined): void {
        const enabled = sharedBoolean(details.map(entry => entry.enabled));
        if (this.document.activeElement !== this.enabled) {
            this.enabled.indeterminate = enabled === undefined;
            this.enabled.checked = enabled === true;
        }
        this.root.classList.toggle("disabled", enabled === false);
        if (this.document.activeElement !== this.nameInput) {
            const names = new Set(details.map(entry => entry.name));
            const single = details.length === 1 ? details[0] : undefined;
            this.nameInput.value = names.size === 1 ? [...names][0] ?? "" : "";
            this.nameInput.placeholder = names.size === 1 ? (single === undefined ? "" : entityLabel(single.entity, null)) : MIXED_NAME_PLACEHOLDER;
        }
        this.handle.textContent = details.length === 1 ? `#${details[0].entity}` : `${details.length} selected`;
        this.prefabBar.hidden = prefabPath === undefined || details.length !== 1;
        if (prefabPath !== undefined) {
            const count = this.inspected?.overrides.length ?? 0;
            this.prefabLabel.textContent = `Prefab ${prefabPath}`;
            this.prefabLabel.title = `${count === 1 ? "1 override" : `${count} overrides`}`;
        }
    }

    private showComponents(inspected: InspectedSelection): void {
        const shared = sharedComponents(inspected.details);
        const present = new Set(shared.map(component => component.typeName));
        for (const [typeName, view] of this.views) {
            if (present.has(typeName)) continue;
            view.element.remove();
            this.views.delete(typeName);
        }
        shared.forEach((component, index) => {
            let view = this.views.get(component.typeName);
            if (view === undefined) {
                view = new ComponentView(this, inspected.entities, component.typeName, this.workspace.schemas.get(component.typeName), component.inspectable, component.inferred);
                this.views.set(component.typeName, view);
            }
            const path = inspected.entityPath;
            view.show(component,
                path === undefined ? new Set() : overriddenFieldKeys(inspected.overrides, path, component.typeName),
                path !== undefined && isComponentOverridden(inspected.overrides, path, component.typeName));
            const atIndex = this.componentList.children.item(index);
// Move a panel only when it is out of place: moving the panel that holds focus blurs its input.
            if (atIndex !== view.element) this.componentList.insertBefore(view.element, atIndex);
        });
        this.popup?.render();
    }

    private showEntityChoices(): void {
        for (const view of this.views.values()) view.showEntityChoices();
    }

    private renameInspected(): void {
        const entities = this.inspected?.entities ?? [];
        const text = this.nameInput.value.trim();
        for (const entity of entities) void this.workspace.rename(entity, text.length === 0 ? null : text);
    }

    private withPrefab(action: (path: string) => void): void {
        const path = this.workspace.selectionDetails.overrides?.sourcePath;
        if (path !== undefined) action(path);
    }

    private withPrefabRoot(action: (root: Entity) => void): void {
        const root = this.workspace.selectionDetails.overridesRoot;
        if (root !== undefined) action(root);
    }

    private presentInAll(): Set<string> {
        const details = this.inspected?.details ?? [];
        const names = new Set(details.flatMap(entry => entry.components.map(component => component.typeName)));
        return new Set([...names].filter(typeName => !missingInSome(details, typeName)));
    }

    private toggleAddPopup(): void {
        if (this.popup !== undefined) {
            this.closeAddPopup();
            return;
        }
        if (performance.now() - this.popupClosedAtMs < POPUP_REOPEN_GUARD_MS) return;
        const popup = new AddComponentPopup(this.document, () => this.workspace.schemas.values(), this.presentInAll(), {
            choose: typeName => this.chooseComponent(typeName),
            closed: () => {
                if (this.popup !== popup) return;
                this.popup = undefined;
                this.popupClosedAtMs = performance.now();
            },
        });
        this.popup = popup;
        this.addHost.replaceChildren(popup.element);
        popup.focus();
        void this.workspace.loadSchemas().then(() => popup.render());
    }

    private closeAddPopup(): void {
        this.popup?.close();
        this.popup = undefined;
    }

    private chooseComponent(typeName: string): void {
        const schema = this.workspace.schemas.get(typeName);
        const entities = this.inspected?.entities ?? [];
        if (schema === undefined || entities.length === 0) return;
        const required = requiredEntityFields(schema);
        if (required.length === 0) {
            void this.workspace.addComponent(entities, typeName);
            return;
        }
        this.showRequiredForm(entities, typeName, required);
    }

    private showRequiredForm(entities: readonly Entity[], typeName: string, required: readonly EditorFieldDescription[]): void {
        const document = this.document;
        const excluded = new Set(entities);
        const candidates = this.workspace.entities.filter(summary => !excluded.has(summary.entity));
        const selects = required.map(field => {
            const select = createElement(document, "select", "field-input");
            select.setAttribute("aria-label", `${typeName}.${field.key}`);
            for (const summary of candidates) {
                const option = createElement(document, "option", "", entityLabel(summary.entity, summary.name));
                option.value = String(summary.entity);
                select.append(option);
            }
            const row = createElement(document, "label", "field-row");
            row.append(createElement(document, "span", "field-name", field.key), select);
            return {field, select, row};
        });
        const add = createButton(document, {className: "primary", text: `Add ${typeName}`, title: `Add ${typeName} with these values`, onClick: () => {
            const values: SceneJsonObject = {};
            for (const {field, select} of selects) values[field.key] = Number(select.value);
            this.hideRequiredForm();
            void this.workspace.addComponent(entities, typeName, values);
        }});
        add.disabled = candidates.length === 0;
        const cancel = createButton(document, {className: "", text: "Cancel", title: "Do not add it", onClick: () => this.hideRequiredForm()});
        this.requiredForm.replaceChildren(createElement(document, "p", "required-heading", `${typeName} needs:`), ...selects.map(({row}) => row), add, cancel);
        this.requiredForm.hidden = false;
    }

    private hideRequiredForm(): void {
        this.requiredForm.replaceChildren();
        this.requiredForm.hidden = true;
    }
}
