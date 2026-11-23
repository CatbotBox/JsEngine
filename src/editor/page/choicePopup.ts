import {createElement, errorText, visualScaleOf} from "./dom";
import {CHOICE_POPUP_HOOK, CHOICE_VALUE_HOOK} from "../project/editorUiHooks";

export interface Choice<V> {
    readonly label: string;
    readonly value: V;
    readonly key?: string;
}

export interface ChoicePopupOptions<V> {
    readonly ariaLabel: string;
    readonly searchPlaceholder: string;
    readonly emptyText: string;

    loadChoices(): Promise<readonly Choice<V>[]>;

    choose(value: V): void;
}

const LOADING_TEXT = "Loading…";
const NO_MATCH_TEXT = "Nothing matches";
const HIGHLIGHT_CLASS = "highlighted";
const VIEWPORT_MARGIN_PX = 4;
const MIN_WIDTH_PX = 220;
const MAX_HEIGHT_PX = 320;
const openPopups = new WeakMap<Document, () => void>();

export function closeChoicePopup(document: Document): void {
    openPopups.get(document)?.();
}

export function showChoicePopup<V>(document: Document, anchor: HTMLElement, options: ChoicePopupOptions<V>): void {
    closeChoicePopup(document);
    const popup = createElement(document, "div", "choice-popup");
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", options.ariaLabel);
    popup.setAttribute(CHOICE_POPUP_HOOK, "");
    const search = createElement(document, "input", "field-input choice-popup-search");
    search.type = "search";
    search.placeholder = options.searchPlaceholder;
    search.setAttribute("aria-label", options.searchPlaceholder);
    const list = createElement(document, "div", "choice-popup-list");
    list.setAttribute("role", "listbox");
    popup.append(search, list);

    let choices: readonly Choice<V>[] | undefined;
    let shown: {readonly choice: Choice<V>, readonly element: HTMLElement}[] = [];
    let highlighted = 0;
    let closed = false;

    const close = (): void => {
        if (closed) return;
        closed = true;
        popup.remove();
        document.removeEventListener("pointerdown", onOutside, true);
        if (openPopups.get(document) === close) openPopups.delete(document);
    };
    const onOutside = (event: Event): void => {
        if (event.target instanceof Node && (popup.contains(event.target) || anchor.contains(event.target))) return;
        close();
    };
    const choose = (choice: Choice<V>): void => {
        close();
        options.choose(choice.value);
    };
    const highlight = (index: number): void => {
        shown[highlighted]?.element.classList.remove(HIGHLIGHT_CLASS);
        highlighted = Math.max(0, Math.min(index, shown.length - 1));
        const entry = shown[highlighted];
        entry?.element.classList.add(HIGHLIGHT_CLASS);
        entry?.element.scrollIntoView({block: "nearest"});
    };
    const message = (text: string): void => {
        shown = [];
        list.replaceChildren(createElement(document, "p", "choice-popup-empty", text));
    };
    const render = (): void => {
        if (choices === undefined) {
            message(LOADING_TEXT);
            return;
        }
        if (choices.length === 0) {
            message(options.emptyText);
            return;
        }
        const needle = search.value.trim().toLowerCase();
        const matching = choices.filter(choice => needle.length === 0 || choice.label.toLowerCase().includes(needle));
        if (matching.length === 0) {
            message(NO_MATCH_TEXT);
            return;
        }
        shown = matching.map(choice => {
            const element = createElement(document, "button", "choice-popup-item", choice.label);
            element.type = "button";
            element.title = choice.label;
            element.setAttribute("role", "option");
            if (choice.key !== undefined) element.setAttribute(CHOICE_VALUE_HOOK, choice.key);
            element.addEventListener("pointerdown", event => event.preventDefault());
            element.addEventListener("click", () => choose(choice));
            return {choice, element};
        });
        list.replaceChildren(...shown.map(entry => entry.element));
        highlighted = 0;
        highlight(0);
    };

    search.addEventListener("input", render);
    search.addEventListener("keydown", event => {
        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                highlight(highlighted + 1);
                return;
            case "ArrowUp":
                event.preventDefault();
                highlight(highlighted - 1);
                return;
            case "Enter": {
                event.preventDefault();
                const entry = shown[highlighted];
                if (entry !== undefined) choose(entry.choice);
                return;
            }
            case "Escape":
                event.preventDefault();
                event.stopPropagation();
                close();
                return;
        }
    });

    render();
    document.body.append(popup);
    const view = document.defaultView;
    const scale = visualScaleOf(popup);
    const anchorRect = anchor.getBoundingClientRect();
    const bounds = {left: anchorRect.left / scale, top: anchorRect.top / scale, width: anchorRect.width / scale, bottom: anchorRect.bottom / scale};
    const width = Math.max(MIN_WIDTH_PX, bounds.width);
    const viewportWidth = view === null ? bounds.left + width : view.innerWidth / scale;
    const viewportHeight = view === null ? bounds.bottom + MAX_HEIGHT_PX : view.innerHeight / scale;
    const left = Math.max(VIEWPORT_MARGIN_PX, Math.min(bounds.left, viewportWidth - width - VIEWPORT_MARGIN_PX));
    const spaceBelow = viewportHeight - bounds.bottom - VIEWPORT_MARGIN_PX;
    const spaceAbove = bounds.top - VIEWPORT_MARGIN_PX;
    const opensBelow = spaceBelow >= MAX_HEIGHT_PX || spaceBelow >= spaceAbove;
    popup.style.left = `${left}px`;
    popup.style.width = `${width}px`;
    popup.style.maxHeight = `${Math.min(MAX_HEIGHT_PX, opensBelow ? spaceBelow : spaceAbove)}px`;
    if (opensBelow) popup.style.top = `${bounds.bottom}px`;
    else popup.style.bottom = `${viewportHeight - bounds.top}px`;
    openPopups.set(document, close);
    document.addEventListener("pointerdown", onOutside, true);
    search.focus();

    options.loadChoices().then(loaded => {
        if (closed) return;
        choices = loaded;
        render();
    }, error => {
        if (!closed) message(errorText(error));
    });
}
