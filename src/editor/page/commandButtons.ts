import {showCommandMenu} from "./commandMenus";
import type {MenuEntry} from "./commandMenus";
import type {CommandRegistry, CommandState, RegisteredCommand} from "./commandRegistry";
import {createElement} from "./dom";
import {closePopupMenu} from "./popupMenu";

export interface CommandButtonOptions {
    readonly className: string;
    readonly text?: string;
    readonly hint?: string;
}

export interface DropdownButtonOptions {
    readonly className: string;
    readonly title: string;

    text(): string;

    entries(): readonly MenuEntry[];

    hidden?(): boolean;
}

const ACTIVE_CLASS = "active";
const OPEN_CLASS = "open";
const DROPDOWN_CLASS = "dropdown-button";
const DROPDOWN_ARROW = "▾";

function commandTitle(state: CommandState, hint?: string): string {
    if (state.reason !== undefined) return `${state.label}: ${state.reason}`;
    const shortcut = state.shortcutText === undefined ? "" : ` (${state.shortcutText})`;
    return `${state.label}${shortcut}${hint === undefined ? "" : `: ${hint}`}`;
}

export function commandButton(document: Document, registry: CommandRegistry, command: RegisteredCommand, options: CommandButtonOptions): HTMLButtonElement {
    const button = createElement(document, "button", options.className);
    button.type = "button";
    button.addEventListener("click", () => void command.runAlone());
    const refresh = (): void => {
        const state = command.stateAlone();
        button.textContent = options.text ?? state.label;
        button.disabled = !state.enabled;
        button.title = commandTitle(state, options.hint);
        if (state.checked === undefined) return;
        button.classList.toggle(ACTIVE_CLASS, state.checked);
        button.setAttribute("aria-pressed", String(state.checked));
    };
    registry.onChange(refresh);
    refresh();
    return button;
}

export function dropdownButton(document: Document, registry: CommandRegistry, options: DropdownButtonOptions): HTMLButtonElement {
    const button = createElement(document, "button", `${options.className} ${DROPDOWN_CLASS}`);
    button.type = "button";
    button.title = options.title;
    button.setAttribute("aria-haspopup", "menu");
    let open = false;
    const closed = (): void => {
        open = false;
        button.classList.remove(OPEN_CLASS);
    };
    button.addEventListener("click", () => {
        if (open) {
            closePopupMenu(document);
            return;
        }
        const bounds = button.getBoundingClientRect();
        showCommandMenu(document, bounds.left, bounds.bottom, options.entries(), {anchor: button, onClose: closed});
        open = true;
        button.classList.add(OPEN_CLASS);
    });
    const refresh = (): void => {
        button.textContent = `${options.text()} ${DROPDOWN_ARROW}`;
        button.hidden = options.hidden?.() ?? false;
    };
    registry.onChange(refresh);
    refresh();
    return button;
}
