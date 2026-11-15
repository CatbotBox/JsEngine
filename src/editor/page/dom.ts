export interface ButtonOptions {
    readonly className: string;
    readonly text: string;
    readonly title: string;
    readonly onClick: (event: MouseEvent) => void;
}

const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set(["checkbox", "radio", "color", "range", "button", "submit", "reset", "file", "image"]);

export function createElement<K extends keyof HTMLElementTagNameMap>(document: Document, tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
    const created = document.createElement(tag);
    if (className.length > 0) created.className = className;
    if (text !== undefined) created.textContent = text;
    return created;
}

export function createButton(document: Document, options: ButtonOptions): HTMLButtonElement {
    const created = createElement(document, "button", options.className, options.text);
    created.type = "button";
    created.title = options.title;
    created.addEventListener("click", options.onClick);
    return created;
}

export function isTextEntryElement(element: Element | null): boolean {
    if (element === null) return false;
    const tag = element.tagName.toLowerCase();
    if (tag === "textarea" || tag === "select") return true;
    if (tag === "input") return !NON_TEXT_INPUT_TYPES.has((element as HTMLInputElement).type.toLowerCase());
    return (element as HTMLElement).isContentEditable === true;
}

export function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function readStorage(window: Window | null, key: string): string | null {
    try {
        return window?.localStorage.getItem(key) ?? null;
    } catch {
        return null;
    }
}

export function writeStorage(window: Window | null, key: string, value: string): void {
    try {
        window?.localStorage.setItem(key, value);
    } catch {
        return;
    }
}

export function capturePointer(element: Element, pointerId: number): void {
    try {
        element.setPointerCapture(pointerId);
    } catch {
        return;
    }
}

export function releasePointer(element: Element, pointerId: number): void {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
}

export function hasCommandModifier(event: {readonly ctrlKey: boolean, readonly metaKey: boolean}): boolean {
    return event.ctrlKey || event.metaKey;
}

export function isFocusWithin(container: Element): boolean {
    const active = container.ownerDocument.activeElement;
    return active !== null && container.contains(active);
}
