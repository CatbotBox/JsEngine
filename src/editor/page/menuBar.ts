import {showCommandMenu} from "./commandMenus";
import type {MenuEntry} from "./commandMenus";
import {createElement} from "./dom";
import {closePopupMenu} from "./popupMenu";

export interface MenuBarMenu {
    readonly label: string;

    entries(): readonly MenuEntry[];
}

const OPEN_CLASS = "open";

export class MenuBar {
    public readonly element: HTMLElement;
    private readonly buttons = new Map<string, HTMLButtonElement>();
    private openLabel: string | undefined;

    public constructor(private readonly document: Document, menus: readonly MenuBarMenu[]) {
        this.element = createElement(document, "nav", "menu-bar");
        this.element.setAttribute("role", "menubar");
        this.element.setAttribute("aria-label", "Menu bar");
        for (const menu of menus) {
            const button = createElement(document, "button", "menu-bar-item", menu.label);
            button.type = "button";
            button.setAttribute("aria-haspopup", "menu");
            button.setAttribute("aria-expanded", "false");
            button.addEventListener("click", () => {
                if (this.openLabel === menu.label) this.close();
                else this.open(menu, button);
            });
            button.addEventListener("pointerenter", () => {
                if (this.openLabel !== undefined && this.openLabel !== menu.label) this.open(menu, button);
            });
            this.buttons.set(menu.label, button);
            this.element.append(button);
        }
    }

    public buttonOf(label: string): HTMLElement | undefined {
        return this.buttons.get(label);
    }

    private open(menu: MenuBarMenu, button: HTMLButtonElement): void {
        const bounds = button.getBoundingClientRect();
        showCommandMenu(this.document, bounds.left, bounds.bottom, menu.entries(), {anchor: button, onClose: () => this.closed(menu.label)});
        this.openLabel = menu.label;
        button.classList.add(OPEN_CLASS);
        button.setAttribute("aria-expanded", "true");
    }

    private close(): void {
        closePopupMenu(this.document);
    }

    private closed(label: string): void {
        const button = this.buttons.get(label);
        button?.classList.remove(OPEN_CLASS);
        button?.setAttribute("aria-expanded", "false");
        if (this.openLabel === label) this.openLabel = undefined;
    }
}
