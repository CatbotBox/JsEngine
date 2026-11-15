export function element<K extends keyof HTMLElementTagNameMap>(document: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const created = document.createElement(tag);
    if (className !== undefined) created.className = className;
    if (text !== undefined) created.textContent = text;
    return created;
}

export const DEFAULT_BUTTON_CLASS = "start-button";

export function button(document: Document, label: string, run: () => void, className = DEFAULT_BUTTON_CLASS): HTMLButtonElement {
    const created = element(document, "button", className, label);
    created.type = "button";
    created.addEventListener("click", run);
    return created;
}
