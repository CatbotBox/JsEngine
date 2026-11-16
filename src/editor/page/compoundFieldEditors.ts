import type {SceneJsonValue} from "../../engine/scene";
import type {EditorFieldDescription, EditorFieldValue, ListFieldDescription, StructFieldDescription} from "../editorProtocol";
import {
    canMoveListItem,
    isListItemPath,
    listItemAt,
    listItemPath,
    MOVE_DOWN,
    MOVE_UP,
    sharedListLength,
    structMemberOf,
    structMemberPath,
    withAppendedListItem,
    withListItem,
    withMovedListItem,
    withoutListItem,
    withStructMember,
} from "./compoundValues";
import type {MoveDirection} from "./compoundValues";
import {createButton, createElement} from "./dom";
import {FieldEditorBase, fieldLabelElement, MIXED_CLASS, nestedFieldContext} from "./fieldEditorBase";
import type {FieldEditor, FieldEditorContext, FieldEditorFactory} from "./fieldEditorBase";

const DIFFERENT_LENGTHS_TEXT = "— (the lists differ in length)";
const UNNAMED_STRUCT_TEXT = "Fields";
const NO_MEMBERS_TEXT = "No fields";
const MOVE_UP_TEXT = "↑";
const MOVE_DOWN_TEXT = "↓";
const REMOVE_TEXT = "✕";
const ADD_TEXT = "+ Add";
const NO_VALUE: SceneJsonValue = null;

interface ListRow {
    readonly element: HTMLElement;
    readonly editor: FieldEditor;
    readonly up: HTMLButtonElement;
    readonly down: HTMLButtonElement;
}

function itemCountText(count: number): string {
    return count === 1 ? "1 item" : `${count} items`;
}

abstract class CompoundFieldEditor extends FieldEditorBase {
    public override show(values: readonly EditorFieldValue[]): void {
        this.values = values;
        this.render(values);
    }

    protected override rendersAfterCommit(): boolean {
        return true;
    }

    protected commitStructure(map: (current: EditorFieldValue) => SceneJsonValue): void {
        this.afterTyping(() => void this.commitEach(map));
    }
}

export class ListFieldEditor extends CompoundFieldEditor {
    private readonly count: HTMLElement;
    private readonly rowsElement: HTMLElement;
    private rows: ListRow[] = [];

    public constructor(context: FieldEditorContext, document: Document, private readonly list: ListFieldDescription, private readonly create: FieldEditorFactory) {
        super(context, document);
        const header = createElement(document, "div", "list-header");
        this.count = createElement(document, "span", "list-count");
        const add = createButton(document, {
            className: "list-add",
            text: ADD_TEXT,
            title: `Add an item to ${this.fieldLabel}`,
            onClick: () => this.commitStructure(current => withAppendedListItem(current, this.list.elementDefault)),
        });
        header.append(this.count, add);
        this.rowsElement = createElement(document, "div", "list-rows");
        this.element.append(header, this.rowsElement);
    }

    public override showEntityChoices(): void {
        for (const row of this.rows) row.editor.showEntityChoices();
    }

    protected render(values: readonly EditorFieldValue[]): void {
        const length = sharedListLength(values);
        this.count.classList.toggle(MIXED_CLASS, length === undefined);
        if (length === undefined) {
            this.count.textContent = values.length === 0 ? "" : DIFFERENT_LENGTHS_TEXT;
            this.resize(0);
            return;
        }
        this.count.textContent = itemCountText(length);
        this.resize(length);
        this.rows.forEach((row, index) => {
            row.editor.show(values.map(value => listItemAt(value, index)));
            row.up.disabled = !canMoveListItem(length, index, MOVE_UP);
            row.down.disabled = !canMoveListItem(length, index, MOVE_DOWN);
        });
    }

    private resize(length: number): void {
        while (this.rows.length > length) this.rows.pop()!.element.remove();
        while (this.rows.length < length) {
            const row = this.createRow(this.rows.length);
            this.rows.push(row);
            this.rowsElement.append(row.element);
        }
    }

    private createRow(index: number): ListRow {
        const document = this.document;
        const field: EditorFieldDescription = {...this.list.element, key: listItemPath(this.context.field.key, index)};
        const label = fieldLabelElement(document, String(index), field);
        label.classList.add("list-index");
        const editor = this.create(document, nestedFieldContext(this.context, field, label, (_before, after, coalesceKey) => this.commitItem(index, after, coalesceKey)));
        const up = this.moveButton(index, MOVE_UP, MOVE_UP_TEXT, "up");
        const down = this.moveButton(index, MOVE_DOWN, MOVE_DOWN_TEXT, "down");
        const remove = createButton(document, {
            className: "list-row-button",
            text: REMOVE_TEXT,
            title: `Remove item ${index}`,
            onClick: () => this.commitStructure(current => withoutListItem(current, index)),
        });
        const buttons = createElement(document, "span", "list-row-buttons");
        buttons.append(up, down, remove);
        const element = createElement(document, "div", "list-row");
        element.append(label, editor.element, buttons);
        return {element, editor, up, down};
    }

    private moveButton(index: number, direction: MoveDirection, text: string, name: string): HTMLButtonElement {
        return createButton(this.document, {
            className: "list-row-button",
            text,
            title: `Move item ${index} ${name}`,
            onClick: () => this.commitStructure(current => withMovedListItem(current, index, direction)),
        });
    }

    private async commitItem(index: number, after: readonly SceneJsonValue[], coalesceKey: string | undefined): Promise<readonly EditorFieldValue[] | undefined> {
        const stored = await this.commitValues((current, entityIndex) => withListItem(current, index, after[entityIndex] ?? NO_VALUE), coalesceKey);
        return stored?.map(value => listItemAt(value, index));
    }
}

export class StructFieldEditor extends CompoundFieldEditor {
    private readonly members: {readonly key: string, readonly editor: FieldEditor}[];

    public constructor(context: FieldEditorContext, document: Document, struct: StructFieldDescription, create: FieldEditorFactory) {
        super(context, document);
        const foldout = createElement(document, "details", "struct-foldout");
        foldout.open = !isListItemPath(context.field.key);
        const summary = createElement(document, "summary", "struct-summary", struct.typeName ?? UNNAMED_STRUCT_TEXT);
        const body = createElement(document, "div", "struct-members");
        this.members = struct.fields.map(member => {
            const field: EditorFieldDescription = {...member, key: structMemberPath(context.field.key, member.key)};
            const label = fieldLabelElement(document, member.key, field);
            const editor = create(document, nestedFieldContext(context, field, label, (_before, after, coalesceKey) => this.commitMember(member.key, after, coalesceKey)));
            const row = createElement(document, "div", "field-row");
            row.append(label, editor.element);
            body.append(row);
            return {key: member.key, editor};
        });
        if (struct.fields.length === 0) body.append(createElement(document, "p", "component-empty", NO_MEMBERS_TEXT));
        foldout.append(summary, body);
        this.element.append(foldout);
    }

    public override showEntityChoices(): void {
        for (const member of this.members) member.editor.showEntityChoices();
    }

    protected render(values: readonly EditorFieldValue[]): void {
        for (const {key, editor} of this.members) editor.show(values.map(value => structMemberOf(value, key)));
    }

    private async commitMember(key: string, after: readonly SceneJsonValue[], coalesceKey: string | undefined): Promise<readonly EditorFieldValue[] | undefined> {
        const stored = await this.commitValues((current, entityIndex) => withStructMember(current, key, after[entityIndex] ?? NO_VALUE), coalesceKey);
        return stored?.map(value => structMemberOf(value, key));
    }
}
