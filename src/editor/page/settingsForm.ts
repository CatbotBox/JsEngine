import {createButton, createElement} from "./dom";

export interface FormRow {
    readonly row: HTMLElement;
    readonly problem: HTMLElement;
}

export interface StringListEditorOptions {
    readonly values: readonly string[];
    readonly placeholder: string;
    readonly suggestions?: HTMLDataListElement;
    readonly onChange: (values: readonly string[]) => void;
}

const REMOVE_TEXT = "×";
const ADD_TEXT = "Add";
const EMPTY_LIST_TEXT = "None";
const DATALIST_ID_PREFIX = "project-settings-list-";

let nextDatalistNumber = 1;

export function formRow(document: Document, label: string, control: HTMLElement, hint?: string): FormRow {
    const row = createElement(document, "div", "settings-form-row");
    const name = createElement(document, "label", "settings-form-label", label);
    const body = createElement(document, "div", "settings-form-control");
    body.append(control);
    if (hint !== undefined) body.append(createElement(document, "p", "settings-form-hint", hint));
    const problem = createElement(document, "div", "settings-form-problems");
    body.append(problem);
    row.append(name, body);
    return {row, problem};
}

export function showProblems(element: HTMLElement, problems: readonly string[] | undefined): void {
    const document = element.ownerDocument;
    element.replaceChildren(...(problems ?? []).map(problem => createElement(document, "p", "settings-form-problem", problem)));
}

export function datalistOf(document: Document, values: readonly string[]): HTMLDataListElement {
    const list = createElement(document, "datalist");
    list.id = `${DATALIST_ID_PREFIX}${nextDatalistNumber++}`;
    for (const value of values) {
        const option = createElement(document, "option");
        option.value = value;
        list.append(option);
    }
    return list;
}

export function textInput(document: Document, value: string, onInput: (value: string) => void, placeholder = ""): HTMLInputElement {
    const input = createElement(document, "input", "field-input");
    input.type = "text";
    input.spellcheck = false;
    input.value = value;
    input.placeholder = placeholder;
    input.addEventListener("input", () => onInput(input.value));
    return input;
}

export function selectOf(document: Document, choices: readonly {readonly value: string, readonly label: string}[], value: string, onChange: (value: string) => void): HTMLSelectElement {
    const select = createElement(document, "select", "field-input");
    for (const choice of choices) {
        const option = createElement(document, "option", "", choice.label);
        option.value = choice.value;
        select.append(option);
    }
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    return select;
}

export class StringListEditor {
    public readonly element: HTMLElement;
    private values: string[];

    public constructor(private readonly document: Document, private readonly options: StringListEditorOptions) {
        this.values = [...options.values];
        this.element = createElement(document, "div", "string-list-editor");
        this.render();
    }

    private changed(): void {
        this.options.onChange([...this.values]);
    }

    private render(focusIndex?: number): void {
        const document = this.document;
        const rows = this.values.map((value, index) => {
            const row = createElement(document, "div", "string-list-row");
            const input = textInput(document, value, text => {
                this.values[index] = text;
                this.changed();
            }, this.options.placeholder);
            if (this.options.suggestions !== undefined) input.setAttribute("list", this.options.suggestions.id);
            const remove = createButton(document, {className: "string-list-remove", text: REMOVE_TEXT, title: `Remove ${value.length > 0 ? value : "this row"}`, onClick: () => {
                this.values.splice(index, 1);
                this.changed();
                this.render();
            }});
            row.append(input, remove);
            return row;
        });
        const empty = this.values.length === 0 ? [createElement(document, "span", "string-list-empty", EMPTY_LIST_TEXT)] : [];
        const add = createButton(document, {className: "string-list-add", text: ADD_TEXT, title: `Add a row (${this.options.placeholder})`, onClick: () => {
            this.values.push("");
            this.changed();
            this.render(this.values.length - 1);
        }});
        this.element.replaceChildren(...rows, ...empty, add);
        if (focusIndex !== undefined) rows[focusIndex]?.querySelector("input")?.focus();
    }
}
