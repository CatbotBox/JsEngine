import type {Entity} from "../../engine/core";
import type {SceneJsonObject, SceneJsonValue} from "../../engine/scene";
import type {
    EditorComponentDescription,
    EditorComponentDetails,
    EditorEntityDetails,
    EditorEntitySummary,
    EditorFieldDescription,
    EditorFieldValue,
} from "../editorProtocol";
import {createFieldEditor} from "./fieldEditors";
import type {FieldEditor} from "./fieldEditors";
import {entityLabel} from "./fieldValueText";
import type {RotationEulerCache} from "./rotationEulerCache";

export interface ComponentPanelActions {
    setField(entity: Entity, typeName: string, key: string, value: SceneJsonValue): Promise<EditorFieldValue | undefined>;

    addComponent(entity: Entity, typeName: string, values: SceneJsonObject): void;

    removeComponent(entity: Entity, typeName: string): void;

    setEnabled(entity: Entity, enabled: boolean): void;

    reportInvalid(message: string): void;
}

const NO_SELECTION_TEXT = "Select an entity in the tree, or create one with New entity.";
const ADD_COMPONENT_PLACEHOLDER = "Add component…";
const NO_FIELDS_TEXT = "No fields";
const READ_ONLY_TEXT = "read-only";
const NO_VALUES: SceneJsonObject = {};

interface InspectorContext {
    readonly document: Document;
    readonly entity: Entity;
    readonly schemasByName: ReadonlyMap<string, EditorComponentDescription>;
    readonly actions: ComponentPanelActions;
    readonly rotations: RotationEulerCache;

    entities(): readonly EditorEntitySummary[];
}

function element<K extends keyof HTMLElementTagNameMap>(document: Document, tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const created = document.createElement(tag);
    created.className = className;
    if (text !== undefined) created.textContent = text;
    return created;
}

function button(document: Document, className: string, text: string, title: string, onClick: () => void): HTMLButtonElement {
    const created = element(document, "button", className, text);
    created.type = "button";
    created.title = title;
    created.addEventListener("click", onClick);
    return created;
}

function isFocusWithin(container: HTMLElement): boolean {
    const active = container.ownerDocument.activeElement;
    return active !== null && container.contains(active);
}

function requiredEntityFields(schema: EditorComponentDescription): EditorFieldDescription[] {
    return schema.fields.filter(field => field.kind === "entity" && !field.nullable);
}

function editableSchema(context: InspectorContext, component: EditorComponentDetails): EditorComponentDescription | undefined {
    const schema = context.schemasByName.get(component.typeName);
    return component.inspectable && schema?.persistence === "fields" ? schema : undefined;
}

class ComponentView {
    public readonly element: HTMLFieldSetElement;
    private readonly editors = new Map<string, FieldEditor>();

    public constructor(private readonly context: InspectorContext, component: EditorComponentDetails) {
        const {document, entity, actions} = context;
        const typeName = component.typeName;
        const schema = editableSchema(context, component);
        this.element = element(document, "fieldset", schema === undefined ? "component read-only" : "component");
        const legend = element(document, "legend", "component-legend");
        legend.append(element(document, "span", "component-name", typeName));
        if (schema === undefined) {
            legend.append(element(document, "span", "component-badge", READ_ONLY_TEXT));
            this.element.append(legend);
            return;
        }
        legend.append(button(document, "component-remove", "Remove", `Remove ${typeName}`, () => actions.removeComponent(entity, typeName)));
        this.element.append(legend);
        if (schema.fields.length === 0) this.element.append(element(document, "p", "component-empty", NO_FIELDS_TEXT));
        for (const field of schema.fields) this.element.append(this.fieldRow(typeName, field));
    }

    public show(component: EditorComponentDetails): void {
        for (const [key, editor] of this.editors) {
            const value = component.fields[key];
            if (value !== undefined) editor.show(value);
        }
    }

    public showEntityChoices(): void {
        for (const editor of this.editors.values()) editor.showEntityChoices();
    }

    private fieldRow(typeName: string, field: EditorFieldDescription): HTMLElement {
        const {document, entity, actions, rotations} = this.context;
        const row = element(document, "div", "field-row");
        const editor = createFieldEditor(document, {
            entity,
            typeName,
            field,
            rotations,
            entities: () => this.context.entities(),
            commit: value => actions.setField(entity, typeName, field.key, value),
            reportInvalid: message => actions.reportInvalid(message),
        });
        this.editors.set(field.key, editor);
        row.append(element(document, "span", "field-name", field.key), editor.element);
        return row;
    }
}

class AddComponentControl {
    public readonly element: HTMLElement;
    private readonly select: HTMLSelectElement;
    private readonly requiredForm: HTMLElement;
    private shownTypeNames = "";

    public constructor(private readonly context: InspectorContext) {
        const document = context.document;
        this.element = element(document, "div", "add-component");
        this.select = element(document, "select", "field-input");
        this.select.setAttribute("aria-label", "Add component");
        this.select.addEventListener("change", () => this.choose());
        this.requiredForm = element(document, "div", "required-values");
        this.requiredForm.hidden = true;
        this.element.append(this.select, this.requiredForm);
    }

    public update(present: readonly EditorComponentDetails[]): void {
        const presentNames = new Set(present.map(component => component.typeName));
        const addable = [...this.context.schemasByName.values()]
            .filter(schema => schema.persistence === "fields" && !presentNames.has(schema.typeName))
            .map(schema => schema.typeName);
        const key = addable.join("\n");
        if (key === this.shownTypeNames || isFocusWithin(this.select)) return;
        this.shownTypeNames = key;
        const document = this.context.document;
        const placeholder = element(document, "option", "", ADD_COMPONENT_PLACEHOLDER);
        placeholder.value = "";
        this.select.replaceChildren(placeholder, ...addable.map(typeName => {
            const option = element(document, "option", "", typeName);
            option.value = typeName;
            return option;
        }));
        this.select.disabled = addable.length === 0;
    }

    private choose(): void {
        const typeName = this.select.value;
        this.select.value = "";
        this.select.blur();
        const schema = this.context.schemasByName.get(typeName);
        if (schema === undefined) return;
        const required = requiredEntityFields(schema);
        if (required.length === 0) {
            this.hideRequiredForm();
            this.context.actions.addComponent(this.context.entity, typeName, NO_VALUES);
            return;
        }
        this.showRequiredForm(typeName, required);
    }

    private showRequiredForm(typeName: string, required: readonly EditorFieldDescription[]): void {
        const {document, entity} = this.context;
        const candidates = this.context.entities().filter(summary => summary.entity !== entity);
        const selects = required.map(field => {
            const select = element(document, "select", "field-input");
            select.setAttribute("aria-label", `${typeName}.${field.key}`);
            select.append(...candidates.map(summary => {
                const option = element(document, "option", "", entityLabel(summary.entity, summary.name));
                option.value = String(summary.entity);
                return option;
            }));
            const row = element(document, "label", "field-row");
            row.append(element(document, "span", "field-name", field.key), select);
            return {field, select, row};
        });
        const add = button(document, "required-add", `Add ${typeName}`, `Add ${typeName} with these values`, () => {
            const values: SceneJsonObject = {};
            for (const {field, select} of selects) values[field.key] = Number(select.value);
            this.hideRequiredForm();
            this.context.actions.addComponent(entity, typeName, values);
        });
        add.disabled = candidates.length === 0;
        const cancel = button(document, "required-cancel", "Cancel", "Do not add it", () => this.hideRequiredForm());
        const heading = element(document, "p", "required-heading", `${typeName} needs:`);
        this.requiredForm.replaceChildren(heading, ...selects.map(({row}) => row), add, cancel);
        this.requiredForm.hidden = false;
    }

    private hideRequiredForm(): void {
        this.requiredForm.replaceChildren();
        this.requiredForm.hidden = true;
    }
}

class EntityInspector {
    public readonly element: HTMLElement;
    private readonly title: HTMLElement;
    private readonly enabled: HTMLInputElement;
    private readonly componentList: HTMLElement;
    private readonly addControl: AddComponentControl;
    private readonly views = new Map<string, ComponentView>();

    public constructor(private readonly context: InspectorContext) {
        const {document, entity, actions} = context;
        this.element = element(document, "section", "entity-inspector");
        const header = element(document, "header", "entity-header");
        this.title = element(document, "h2", "entity-title");
        const handle = element(document, "span", "entity-handle", `#${entity}`);
        this.enabled = element(document, "input", "field-input checkbox");
        this.enabled.type = "checkbox";
        this.enabled.addEventListener("change", () => actions.setEnabled(entity, this.enabled.checked));
        const enabledLabel = element(document, "label", "entity-enabled");
        enabledLabel.append(this.enabled, document.createTextNode(" Enabled"));
        header.append(this.title, handle, enabledLabel);
        this.componentList = element(document, "div", "component-list");
        this.addControl = new AddComponentControl(context);
        this.element.append(header, this.componentList, this.addControl.element);
    }

    public show(details: EditorEntityDetails): void {
        this.title.textContent = entityLabel(details.entity, details.name);
        if (this.context.document.activeElement !== this.enabled) this.enabled.checked = details.enabled;
        this.element.classList.toggle("disabled", !details.enabled);
        this.showComponents(details.components);
        this.addControl.update(details.components);
    }

    public showEntityChoices(): void {
        for (const view of this.views.values()) view.showEntityChoices();
    }

    private showComponents(components: readonly EditorComponentDetails[]): void {
        const present = new Set(components.map(component => component.typeName));
        for (const [typeName, view] of this.views) {
            if (present.has(typeName)) continue;
            view.element.remove();
            this.views.delete(typeName);
        }
        components.forEach((component, index) => {
            let view = this.views.get(component.typeName);
            if (view === undefined) {
                view = new ComponentView(this.context, component);
                this.views.set(component.typeName, view);
            }
            view.show(component);
            const atIndex = this.componentList.children.item(index);
            if (atIndex !== view.element) this.componentList.insertBefore(view.element, atIndex);
        });
    }
}

export class ComponentPanel {
    private readonly schemasByName: ReadonlyMap<string, EditorComponentDescription>;
    private readonly placeholder: HTMLElement;
    private inspector: EntityInspector | undefined;
    private inspected: Entity | undefined;
    private entities: readonly EditorEntitySummary[] = [];

    public constructor(
        private readonly container: HTMLElement,
        schemas: readonly EditorComponentDescription[],
        private readonly actions: ComponentPanelActions,
        private readonly rotations: RotationEulerCache,
    ) {
        this.schemasByName = new Map(schemas.map(schema => [schema.typeName, schema]));
        this.placeholder = element(container.ownerDocument, "p", "inspector-placeholder", NO_SELECTION_TEXT);
        container.replaceChildren(this.placeholder);
    }

    public showEntity(details: EditorEntityDetails | undefined): void {
        if (details === undefined) {
            this.inspector = undefined;
            this.inspected = undefined;
            this.container.replaceChildren(this.placeholder);
            return;
        }
        if (this.inspector === undefined || this.inspected !== details.entity) {
            this.inspected = details.entity;
            this.inspector = new EntityInspector({
                document: this.container.ownerDocument,
                entity: details.entity,
                schemasByName: this.schemasByName,
                actions: this.actions,
                rotations: this.rotations,
                entities: () => this.entities,
            });
            this.container.replaceChildren(this.inspector.element);
        }
        this.inspector.show(details);
    }

    public showEntityChoices(entities: readonly EditorEntitySummary[]): void {
        this.entities = entities;
        this.inspector?.showEntityChoices();
    }
}
