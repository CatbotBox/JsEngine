import type {Entity} from "../../engine/core";
import type {SceneJsonValue} from "../../engine/scene";
import type {EditorEntitySummary, EditorFieldValue} from "../editorProtocol";
import {matchesFileSuffix} from "./assetChoices";
import {showChoicePopup} from "./choicePopup";
import type {Choice} from "./choicePopup";
import {createButton, createElement} from "./dom";
import {
    DROP_TARGET_CLASS,
    ENTITY_CHOICE_LIMIT,
    FieldEditorBase,
    fillSelect,
    MIXED_OPTION_VALUE,
    selectValue,
    showText,
    textInput,
} from "./fieldEditorBase";
import type {FieldEditorContext} from "./fieldEditorBase";
import {assetPathOf, assetText, entityLabel, entityOptionValue, inlineImageSize, NO_ENTITY_OPTION_VALUE, parseAssetPathText, parseEntityOptionValue} from "./fieldValueText";
import {mixedValueOf} from "./multiSelection";

const NO_ENTITY_LABEL = "(none)";
const NO_ASSET_LABEL = "(none)";
const ASSET_PATH_PLACEHOLDER = "path/to/file";
const PICK_ENTITY_TEXT = "◎";
const PICK_ASSET_TEXT = "…";
const OPEN_DATA_ASSET_TEXT = "Open";
const CREATE_DATA_ASSET_TEXT = "New";
const ARMED_CLASS = "armed";
const DROPPED_ENTITY_COUNT = 1;
const DROP_EFFECT = "copy";
const NO_ASSET: SceneJsonValue = null;

function installDrop<T>(element: HTMLElement, accepted: () => T | undefined, drop: (accepted: T) => void): void {
    element.addEventListener("dragover", event => {
        if (accepted() === undefined) return;
        event.preventDefault();
        if (event.dataTransfer !== null) event.dataTransfer.dropEffect = DROP_EFFECT;
        element.classList.add(DROP_TARGET_CLASS);
    });
    element.addEventListener("dragleave", () => element.classList.remove(DROP_TARGET_CLASS));
    element.addEventListener("drop", event => {
        element.classList.remove(DROP_TARGET_CLASS);
        const value = accepted();
        if (value === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        drop(value);
    });
}

export class EntityFieldEditor extends FieldEditorBase {
    private readonly select: HTMLSelectElement;
    private readonly pickButton: HTMLButtonElement;
    private shownKey: string | undefined;

    public constructor(context: FieldEditorContext, document: Document, private readonly nullable: boolean) {
        super(context, document);
        this.select = createElement(document, "select", "field-input");
        this.select.setAttribute("aria-label", this.fieldLabel);
        this.select.addEventListener("change", () => {
            if (this.select.value !== MIXED_OPTION_VALUE) this.commitAll(parseEntityOptionValue(this.select.value));
        });
        this.pickButton = createButton(document, {
            className: "field-pick",
            text: PICK_ENTITY_TEXT,
            title: `Pick ${this.fieldLabel} by clicking an entity in the Scene view (Esc cancels), or drop one from the Hierarchy`,
            onClick: () => void this.pick(),
        });
        this.element.append(this.select, this.pickButton);
        installDrop(this.element, () => this.draggedEntity(), entity => this.commitAll(entity));
    }

    public override showEntityChoices(): void {
        if (!this.hasFocus()) this.render(this.values);
    }

    protected render(values: readonly EditorFieldValue[]): void {
        const shared = mixedValueOf(values);
        const selected = shared === undefined || shared.mixed ? undefined : entityOptionValue(shared.value);
        const choices = this.services.entityChoices();
        const key = `${choices.length}:${selected}:${choices.slice(0, ENTITY_CHOICE_LIMIT).map(summary => `${summary.entity}=${summary.name ?? ""}`).join(",")}`;
        if (key !== this.shownKey) {
            this.shownKey = key;
            fillSelect(this.select, this.options(choices, selected));
        }
        selectValue(this.select, selected);
    }

    protected override hasFocus(): boolean {
        return this.document.activeElement === this.select;
    }

    private draggedEntity(): Entity | undefined {
        const dragged = this.services.draggedEntities();
        return dragged !== undefined && dragged.length === DROPPED_ENTITY_COUNT ? dragged[0] : undefined;
    }

    private async pick(): Promise<void> {
        this.pickButton.classList.add(ARMED_CLASS);
        try {
            const entity = await this.services.pickEntity();
            if (entity !== undefined) this.commitAll(entity);
        } finally {
            this.pickButton.classList.remove(ARMED_CLASS);
        }
    }

    private options(choices: readonly EditorEntitySummary[], selected: string | undefined): {value: string, label: string}[] {
        const options = choices.slice(0, ENTITY_CHOICE_LIMIT).map(summary => ({value: String(summary.entity), label: entityLabel(summary.entity, summary.name)}));
        if (this.nullable) options.unshift({value: NO_ENTITY_OPTION_VALUE, label: NO_ENTITY_LABEL});
        if (selected !== undefined && !options.some(option => option.value === selected)) {
            const pastLimit = choices.find(summary => String(summary.entity) === selected);
            options.push({
                value: selected,
                label: selected === NO_ENTITY_OPTION_VALUE ? NO_ENTITY_LABEL
                    : pastLimit === undefined ? `Entity ${selected} (not listed)` : entityLabel(pastLimit.entity, pastLimit.name),
            });
        }
        return options;
    }
}

export class AssetFieldEditor extends FieldEditorBase {
    private readonly input: HTMLInputElement;
    private readonly inline: HTMLElement;
    private readonly openButton: HTMLButtonElement | undefined;

    public constructor(context: FieldEditorContext, document: Document, private readonly assetType: string) {
        super(context, document);
        this.input = textInput(document, `${this.fieldLabel} file path`);
        this.input.dataset.placeholder = ASSET_PATH_PLACEHOLDER;
        this.input.addEventListener("change", () => this.commitAll(parseAssetPathText(this.input.value)));
        this.inline = createElement(document, "span", "field-read-only");
        const pick = createButton(document, {
            className: "field-pick",
            text: PICK_ASSET_TEXT,
            title: `Choose a ${assetType} file for ${this.fieldLabel}, or drop one from the Project view`,
            onClick: () => this.openPicker(),
        });
        this.element.append(this.input, this.inline, pick);
        if (this.services.isDataAssetType(assetType)) {
            this.openButton = createButton(document, {
                className: "field-pick",
                text: OPEN_DATA_ASSET_TEXT,
                title: `Open the ${assetType} data asset of ${this.fieldLabel} in the Data Assets window`,
                onClick: () => this.openDataAsset(),
            });
            const create = createButton(document, {
                className: "field-pick",
                text: CREATE_DATA_ASSET_TEXT,
                title: `Create a new ${assetType} data asset with default values and assign it to ${this.fieldLabel}`,
                onClick: () => void this.createDataAsset(),
            });
            this.element.append(this.openButton, create);
        }
        installDrop(this.element, () => this.droppablePath(), path => this.commitAll({path}));
    }

    protected render(values: readonly EditorFieldValue[]): void {
        const shared = mixedValueOf(values);
        const value = shared === undefined || shared.mixed ? undefined : shared.value;
        const inline = value !== undefined && inlineImageSize(value) !== undefined;
        this.input.hidden = inline;
        this.inline.hidden = !inline;
        if (inline) this.inline.textContent = assetText(value);
        else showText(this.input, value === undefined ? undefined : assetText(value));
        if (this.openButton !== undefined) this.openButton.disabled = assetPathOf(value) === undefined;
    }

    private openDataAsset(): void {
        const shared = mixedValueOf(this.values);
        const path = shared === undefined || shared.mixed ? undefined : assetPathOf(shared.value);
        if (path !== undefined) this.services.openDataAsset(path);
    }

    private async createDataAsset(): Promise<void> {
        if (this.services.isReadOnly()) return;
        const path = await this.services.createDataAsset(this.assetType);
        if (path !== undefined) this.commitAll({path});
    }

    protected override hasFocus(): boolean {
        return this.document.activeElement === this.input;
    }

    private droppablePath(): string | undefined {
        const dragged = this.services.draggedAsset();
        const suffixes = this.services.assetFileSuffixes(this.assetType);
        return dragged !== undefined && suffixes !== undefined && matchesFileSuffix(dragged.path, suffixes) ? dragged.path : undefined;
    }

    private openPicker(): void {
        showChoicePopup<SceneJsonValue>(this.document, this.element, {
            ariaLabel: `Choose ${this.fieldLabel}`,
            searchPlaceholder: "Search files",
            emptyText: `No ${this.assetType} files in the project`,
            loadChoices: async () => {
                const paths = await this.services.assetChoices(this.assetType);
                const files: Choice<SceneJsonValue>[] = paths.map(path => ({label: path, value: {path}}));
                return [{label: NO_ASSET_LABEL, value: NO_ASSET}, ...files];
            },
            choose: value => this.commitAll(value),
        });
    }
}
