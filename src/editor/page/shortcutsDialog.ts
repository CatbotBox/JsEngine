import type {RegisteredCommand} from "./commandRegistry";
import {shortcutText} from "./commandRegistry";
import {openModal} from "./dialogs";
import {createButton, createElement} from "./dom";

export interface ShortcutRow {
    readonly category: string;
    readonly label: string;
    readonly shortcuts: readonly string[];
}

const DIALOG_TITLE = "Keyboard Shortcuts";
const CLOSE_TEXT = "Close";
const SHORTCUT_SEPARATOR = ", ";

export function shortcutRows(commands: readonly RegisteredCommand[]): ShortcutRow[] {
    const categories = [...new Set(commands.map(command => command.category))];
    return categories.flatMap(category => commands
        .filter(command => command.category === category && command.shortcuts.length > 0)
        .map(command => ({category, label: command.label, shortcuts: command.shortcuts.map(shortcutText)})));
}

export function showKeyboardShortcuts(document: Document, commands: readonly RegisteredCommand[]): void {
    const modal = openModal(document, DIALOG_TITLE, () => modal.close());
    const table = createElement(document, "table", "shortcut-table");
    const body = createElement(document, "tbody");
    for (const row of shortcutRows(commands)) {
        const element = createElement(document, "tr");
        element.append(
            createElement(document, "td", "shortcut-category", row.category),
            createElement(document, "td", "shortcut-label", row.label),
            createElement(document, "td", "shortcut-keys", row.shortcuts.join(SHORTCUT_SEPARATOR)),
        );
        body.append(element);
    }
    table.append(body);
    const scroller = createElement(document, "div", "shortcut-table-scroller");
    scroller.append(table);
    modal.dialog.classList.add("shortcuts-dialog");
    modal.dialog.insertBefore(scroller, modal.buttons);
    const close = createButton(document, {className: "primary", text: CLOSE_TEXT, title: CLOSE_TEXT, onClick: () => modal.close()});
    modal.buttons.append(close);
    close.focus();
}
