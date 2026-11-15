import type {EditorComponentDescription, EditorFieldDescription} from "../editorProtocol";
import {createElement} from "./dom";

export interface AddableComponent {
    readonly typeName: string;
    readonly inferred: boolean;
}

export interface AddableComponentGroup {
    readonly category: string;
    readonly components: readonly AddableComponent[];
}

export interface AddComponentPopupActions {
    choose(typeName: string): void;

    closed(): void;
}

const INFERRED_SUFFIX = " (inferred)";
const SEARCH_PLACEHOLDER = "Search components";
const NOTHING_TO_ADD_TEXT = "No more components to add";
const NO_MATCH_TEXT = "No component matches";
const HIGHLIGHT_CLASS = "highlighted";

export function isAddableSchema(schema: EditorComponentDescription): boolean {
    return schema.persistence === "fields";
}

export function requiredEntityFields(schema: EditorComponentDescription): EditorFieldDescription[] {
    return schema.fields.filter(field => field.kind === "entity" && !field.nullable);
}

export function addableComponentGroups(schemas: Iterable<EditorComponentDescription>, presentInAll: ReadonlySet<string>, search: string): AddableComponentGroup[] {
    const needle = search.trim().toLowerCase();
    const byCategory = new Map<string, AddableComponent[]>();
    for (const schema of schemas) {
        if (!isAddableSchema(schema) || presentInAll.has(schema.typeName)) continue;
        if (needle.length > 0 && !schema.typeName.toLowerCase().includes(needle)) continue;
        let group = byCategory.get(schema.category);
        if (group === undefined) byCategory.set(schema.category, group = []);
        group.push({typeName: schema.typeName, inferred: schema.inferred});
    }
    return [...byCategory]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, components]) => ({category, components: components.sort((a, b) => a.typeName.localeCompare(b.typeName))}));
}

export class AddComponentPopup {
    public readonly element: HTMLElement;
    private readonly search: HTMLInputElement;
    private readonly list: HTMLElement;
    private items: {readonly typeName: string, readonly element: HTMLElement}[] = [];
    private highlighted = 0;
    private closed = false;

    public constructor(
        document: Document,
        private readonly schemas: () => Iterable<EditorComponentDescription>,
        private readonly presentInAll: ReadonlySet<string>,
        private readonly actions: AddComponentPopupActions,
    ) {
        this.element = createElement(document, "div", "add-component-popup");
        this.element.setAttribute("role", "dialog");
        this.element.setAttribute("aria-label", "Add component");
        this.search = createElement(document, "input", "field-input add-component-search");
        this.search.type = "search";
        this.search.placeholder = SEARCH_PLACEHOLDER;
        this.search.setAttribute("aria-label", SEARCH_PLACEHOLDER);
        this.list = createElement(document, "div", "add-component-list");
        this.list.setAttribute("role", "listbox");
        this.element.append(this.search, this.list);
        this.search.addEventListener("input", () => this.render());
        this.search.addEventListener("keydown", event => this.onKey(event));
        this.element.addEventListener("focusout", event => {
            if (event.relatedTarget instanceof Node && this.element.contains(event.relatedTarget)) return;
            this.close();
        });
        this.render();
    }

    public focus(): void {
        this.search.focus();
    }

    public render(): void {
        const document = this.element.ownerDocument;
        const groups = addableComponentGroups(this.schemas(), this.presentInAll, this.search.value);
        this.items = [];
        const children: HTMLElement[] = [];
        for (const group of groups) {
            children.push(createElement(document, "div", "add-component-category", group.category));
            for (const component of group.components) {
                const item = createElement(document, "button", "add-component-item", component.typeName + (component.inferred ? INFERRED_SUFFIX : ""));
                item.type = "button";
                item.setAttribute("role", "option");
                item.addEventListener("pointerdown", event => event.preventDefault());
                item.addEventListener("click", () => this.choose(component.typeName));
                this.items.push({typeName: component.typeName, element: item});
                children.push(item);
            }
        }
        if (children.length === 0) children.push(createElement(document, "p", "add-component-empty", this.search.value.trim().length === 0 ? NOTHING_TO_ADD_TEXT : NO_MATCH_TEXT));
        this.list.replaceChildren(...children);
        this.highlight(0);
    }

    public close(): void {
        if (this.closed || !this.element.isConnected) return;
        this.closed = true;
        this.element.remove();
        this.actions.closed();
    }

    private highlight(index: number): void {
        this.items[this.highlighted]?.element.classList.remove(HIGHLIGHT_CLASS);
        this.highlighted = Math.max(0, Math.min(index, this.items.length - 1));
        const item = this.items[this.highlighted];
        item?.element.classList.add(HIGHLIGHT_CLASS);
        item?.element.scrollIntoView({block: "nearest"});
    }

    private choose(typeName: string): void {
        this.close();
        this.actions.choose(typeName);
    }

    private onKey(event: KeyboardEvent): void {
        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                this.highlight(this.highlighted + 1);
                return;
            case "ArrowUp":
                event.preventDefault();
                this.highlight(this.highlighted - 1);
                return;
            case "Enter": {
                event.preventDefault();
                const item = this.items[this.highlighted];
                if (item !== undefined) this.choose(item.typeName);
                return;
            }
            case "Escape":
                event.preventDefault();
                event.stopPropagation();
                this.close();
                return;
        }
    }
}
