import type {Command, CommandState} from "./commandRegistry";
import {MENU_SEPARATOR, showPopupMenu} from "./popupMenu";
import type {MenuItem, PopupMenuOptions} from "./popupMenu";

export interface CommandMenuEntry {
    readonly kind: "command";
    readonly label: string | undefined;

    state(): CommandState;

    run(): void;
}

export interface SubmenuEntry {
    readonly kind: "submenu";
    readonly label: string;
    readonly entries: readonly MenuEntry[];
    readonly checked?: () => boolean;
}

export type MenuEntry = CommandMenuEntry | SubmenuEntry | typeof MENU_SEPARATOR;

export function commandEntry<A>(command: Command<A>, label?: string): CommandMenuEntry {
    return {kind: "command", label, state: () => command.stateAlone(), run: () => void command.runAlone()};
}

export function commandEntryFor<A>(command: Command<A>, argument: A, label?: string): CommandMenuEntry {
    return {kind: "command", label, state: () => command.stateOf(argument), run: () => void command.runWith(argument)};
}

const ACCEPT_EVERY_CHOICE = (): boolean => true;

export function choiceEntries<A>(command: Command<A>, labelOf: (choice: A) => string, accepts: (choice: A) => boolean = ACCEPT_EVERY_CHOICE): CommandMenuEntry[] {
    return command.choices().filter(accepts).map(choice => commandEntryFor(command, choice, labelOf(choice)));
}

export function submenuEntry(label: string, entries: readonly MenuEntry[], checked?: () => boolean): SubmenuEntry {
    return checked === undefined ? {kind: "submenu", label, entries} : {kind: "submenu", label, entries, checked};
}

function tidySeparators(entries: readonly MenuEntry[]): MenuEntry[] {
    const tidy: MenuEntry[] = [];
    for (const entry of entries) {
        if (entry === MENU_SEPARATOR && (tidy.length === 0 || tidy[tidy.length - 1] === MENU_SEPARATOR)) continue;
        tidy.push(entry);
    }
    if (tidy[tidy.length - 1] === MENU_SEPARATOR) tidy.pop();
    return tidy;
}

function commandItem(entry: CommandMenuEntry): MenuItem {
    const state = entry.state();
    return {
        label: entry.label ?? state.label,
        disabled: !state.enabled,
        run: () => entry.run(),
        ...(state.shortcutText === undefined ? {} : {shortcut: state.shortcutText}),
        ...(state.reason === undefined ? {} : {title: state.reason}),
        ...(state.checked === undefined ? {} : {checked: state.checked}),
    };
}

export function menuItemsOf(entries: readonly MenuEntry[]): MenuItem[] {
    return tidySeparators(entries).map((entry): MenuItem => {
        if (entry === MENU_SEPARATOR) return MENU_SEPARATOR;
        if (entry.kind === "command") return commandItem(entry);
        const checked = entry.checked?.();
        return {label: entry.label, items: menuItemsOf(entry.entries), ...(checked === undefined ? {} : {checked})};
    });
}

export function showCommandMenu(document: Document, clientX: number, clientY: number, entries: readonly MenuEntry[], options?: PopupMenuOptions): void {
    showPopupMenu(document, clientX, clientY, menuItemsOf(entries), options);
}
