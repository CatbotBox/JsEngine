import {createElement} from "./dom";

interface MenuEntry {
    readonly label: string;
    readonly checked?: boolean;
    readonly title?: string;
}

export interface MenuAction extends MenuEntry {
    readonly shortcut?: string;
    readonly disabled?: boolean;
    readonly run: () => void;
}

export interface MenuSubmenu extends MenuEntry {
    readonly items: readonly MenuItem[];
}

export interface PopupMenuOptions {
    readonly anchor?: Element;
    readonly onClose?: () => void;
}

export const MENU_SEPARATOR = "separator";

export type MenuItem = MenuAction | MenuSubmenu | typeof MENU_SEPARATOR;

const VIEWPORT_MARGIN_PX = 4;
const SUBMENU_ARROW = "▸";
const CHECK_MARK = "✓";
const UNCHECKED_MARK = "";
const MENU_ITEM_ROLE = "menuitem";
const CHECKABLE_ROLE = "menuitemradio";
const NO_OPTIONS: PopupMenuOptions = {};

function isSubmenu(item: MenuAction | MenuSubmenu): item is MenuSubmenu {
    return "items" in item;
}
const openMenus = new WeakMap<Document, () => void>();

export function closePopupMenu(document: Document): void {
    openMenus.get(document)?.();
}

export function showPopupMenu(document: Document, clientX: number, clientY: number, items: readonly MenuItem[], options: PopupMenuOptions = NO_OPTIONS): void {
    closePopupMenu(document);
    const menu = createElement(document, "div", "popup-menu");
    menu.setAttribute("role", "menu");
    menu.tabIndex = -1;
    const close = (): void => {
        menu.remove();
        document.removeEventListener("pointerdown", onOutside, true);
        document.removeEventListener("keydown", onKey, true);
        if (openMenus.get(document) === close) openMenus.delete(document);
        options.onClose?.();
    };
    const onOutside = (event: Event): void => {
        if (event.target instanceof Node && (menu.contains(event.target) || options.anchor?.contains(event.target) === true)) return;
        close();
    };
    const onKey = (event: KeyboardEvent): void => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close();
    };
    for (const item of items) {
        if (item === MENU_SEPARATOR) {
            menu.append(createElement(document, "div", "popup-menu-separator"));
            continue;
        }
        const entry = createElement(document, "button", "popup-menu-item");
        entry.type = "button";
        entry.setAttribute("role", item.checked === undefined ? MENU_ITEM_ROLE : CHECKABLE_ROLE);
        if (item.checked !== undefined) {
            entry.setAttribute("aria-checked", String(item.checked));
            entry.append(createElement(document, "span", "popup-menu-check", item.checked ? CHECK_MARK : UNCHECKED_MARK));
        }
        if (item.title !== undefined) entry.title = item.title;
        entry.append(createElement(document, "span", "popup-menu-label", item.label));
        if (isSubmenu(item)) {
            entry.disabled = item.items.length === 0;
            entry.setAttribute("aria-haspopup", "menu");
            entry.append(createElement(document, "span", "popup-menu-shortcut", SUBMENU_ARROW));
            entry.addEventListener("click", () => {
                const bounds = entry.getBoundingClientRect();
                close();
                showPopupMenu(document, bounds.right, bounds.top, item.items);
            });
        } else {
            entry.disabled = item.disabled === true;
            if (item.shortcut !== undefined) entry.append(createElement(document, "span", "popup-menu-shortcut", item.shortcut));
            entry.addEventListener("click", () => {
                close();
                item.run();
            });
        }
        menu.append(entry);
    }
    document.body.append(menu);
    const view = document.defaultView;
    const maxLeft = (view?.innerWidth ?? clientX + menu.offsetWidth) - menu.offsetWidth - VIEWPORT_MARGIN_PX;
    const maxTop = (view?.innerHeight ?? clientY + menu.offsetHeight) - menu.offsetHeight - VIEWPORT_MARGIN_PX;
    menu.style.left = `${Math.max(VIEWPORT_MARGIN_PX, Math.min(clientX, maxLeft))}px`;
    menu.style.top = `${Math.max(VIEWPORT_MARGIN_PX, Math.min(clientY, maxTop))}px`;
    openMenus.set(document, close);
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    menu.focus();
}
