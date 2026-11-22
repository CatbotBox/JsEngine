import type {CommandRegistry, RegisteredCommand} from "./commandRegistry";
import {createElement} from "./dom";
import {closePopupMenu} from "./popupMenu";

export interface PaletteEntry {
    readonly key: string;
    readonly category: string;
    readonly label: string;
    readonly shortcutText: string | undefined;
    readonly enabled: boolean;
    readonly reason: string | undefined;

    run(): boolean;
}

export const PALETTE_PLACEHOLDER = "Type a command";

const LABEL_PREFIX_RANK = 0;
const WORD_START_RANK = 1;
const SUBSTRING_RANK = 2;
const SUBSEQUENCE_RANK = 3;
const WHITESPACE = /\s+/;
const WORD_CHARACTER = /[a-z0-9]/;
const NOT_FOUND = -1;
const CATEGORY_SEPARATOR = ": ";
const NO_MATCH_TEXT = "No command matches";
const HIGHLIGHT_CLASS = "highlighted";
const DISABLED_CLASS = "disabled";
const ESCAPE_KEY = "Escape";
const openPalettes = new WeakMap<Document, () => void>();

interface RankedEntry {
    readonly entry: PaletteEntry;
    readonly rank: number;
    readonly index: number;
}

export function paletteEntries(commands: readonly RegisteredCommand[]): PaletteEntry[] {
    return commands.flatMap(command => command.paletteChoices().map((choice, index): PaletteEntry => ({
        key: `${command.id}#${index}`,
        category: command.category,
        label: choice.state.label,
        shortcutText: choice.state.shortcutText,
        enabled: choice.state.enabled,
        reason: choice.state.reason,
        run: () => choice.run(),
    })));
}

export function paletteEntryText(entry: PaletteEntry): string {
    return `${entry.category}${CATEGORY_SEPARATOR}${entry.label}`;
}

function startsWord(haystack: string, token: string): boolean {
    for (let at = haystack.indexOf(token); at !== NOT_FOUND; at = haystack.indexOf(token, at + 1)) {
        if (at === 0 || !WORD_CHARACTER.test(haystack.charAt(at - 1))) return true;
    }
    return false;
}

function isSubsequence(needle: string, haystack: string): boolean {
    let at = 0;
    for (const character of needle) {
        at = haystack.indexOf(character, at);
        if (at === NOT_FOUND) return false;
        at++;
    }
    return true;
}

function matchRank(entry: PaletteEntry, needle: string): number | undefined {
    const label = entry.label.toLowerCase();
    if (label.startsWith(needle)) return LABEL_PREFIX_RANK;
    const haystack = paletteEntryText(entry).toLowerCase();
    const tokens = needle.split(WHITESPACE).filter(token => token.length > 0);
    if (tokens.every(token => haystack.includes(token))) return tokens.every(token => startsWord(haystack, token)) ? WORD_START_RANK : SUBSTRING_RANK;
    return isSubsequence(tokens.join(""), haystack) ? SUBSEQUENCE_RANK : undefined;
}

export function filterPaletteEntries(entries: readonly PaletteEntry[], query: string): PaletteEntry[] {
    const needle = query.trim().toLowerCase();
    const ranked: RankedEntry[] = [];
    entries.forEach((entry, index) => {
        const rank = needle.length === 0 ? LABEL_PREFIX_RANK : matchRank(entry, needle);
        if (rank !== undefined) ranked.push({entry, rank, index});
    });
    return ranked
        .sort((a, b) => a.rank - b.rank || Number(b.entry.enabled) - Number(a.entry.enabled) || a.index - b.index)
        .map(ranked => ranked.entry);
}

export function isCommandPaletteOpen(document: Document): boolean {
    return openPalettes.has(document);
}

export function closeCommandPalette(document: Document): void {
    openPalettes.get(document)?.();
}

export function showCommandPalette(document: Document, registry: CommandRegistry): void {
    closeCommandPalette(document);
    closePopupMenu(document);
    const previousFocus = document.activeElement;
    const entries = paletteEntries(registry.all());
    const palette = createElement(document, "div", "command-palette");
    palette.setAttribute("role", "dialog");
    palette.setAttribute("aria-label", "Command palette");
    const search = createElement(document, "input", "field-input command-palette-search");
    search.type = "search";
    search.spellcheck = false;
    search.placeholder = PALETTE_PLACEHOLDER;
    search.setAttribute("aria-label", PALETTE_PLACEHOLDER);
    const list = createElement(document, "div", "command-palette-list");
    list.setAttribute("role", "listbox");
    palette.append(search, list);

    let shown: {readonly entry: PaletteEntry, readonly element: HTMLElement}[] = [];
    let highlighted = 0;

    const close = (): void => {
        if (openPalettes.get(document) !== close) return;
        openPalettes.delete(document);
        palette.remove();
        document.removeEventListener("pointerdown", onOutside, true);
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
    const onOutside = (event: Event): void => {
        if (event.target instanceof Node && palette.contains(event.target)) return;
        close();
    };
    const choose = (entry: PaletteEntry): void => {
        if (!entry.enabled) return;
        close();
        entry.run();
    };
    const highlight = (index: number): void => {
        shown[highlighted]?.element.classList.remove(HIGHLIGHT_CLASS);
        highlighted = Math.max(0, Math.min(index, shown.length - 1));
        const current = shown[highlighted];
        current?.element.classList.add(HIGHLIGHT_CLASS);
        current?.element.scrollIntoView({block: "nearest"});
    };
    const itemElement = (entry: PaletteEntry): HTMLElement => {
        const element = createElement(document, "button", "command-palette-item");
        element.type = "button";
        element.setAttribute("role", "option");
        element.setAttribute("aria-disabled", String(!entry.enabled));
        element.classList.toggle(DISABLED_CLASS, !entry.enabled);
        const text = createElement(document, "span", "command-palette-text");
        text.append(createElement(document, "span", "command-palette-category", `${entry.category}${CATEGORY_SEPARATOR}`), createElement(document, "span", "command-palette-label", entry.label));
        if (entry.reason !== undefined) text.append(createElement(document, "span", "command-palette-reason", entry.reason));
        element.append(text);
        if (entry.shortcutText !== undefined) element.append(createElement(document, "span", "command-palette-shortcut", entry.shortcutText));
        element.title = entry.reason ?? paletteEntryText(entry);
        element.addEventListener("pointerdown", event => event.preventDefault());
        element.addEventListener("click", () => choose(entry));
        return element;
    };
    const render = (): void => {
        const matching = filterPaletteEntries(entries, search.value);
        if (matching.length === 0) {
            shown = [];
            list.replaceChildren(createElement(document, "p", "command-palette-empty", NO_MATCH_TEXT));
            return;
        }
        shown = matching.map(entry => ({entry, element: itemElement(entry)}));
        list.replaceChildren(...shown.map(item => item.element));
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
                const current = shown[highlighted];
                if (current !== undefined) choose(current.entry);
                return;
            }
            case ESCAPE_KEY:
                event.preventDefault();
                event.stopPropagation();
                close();
                return;
        }
    });

    render();
    document.body.append(palette);
    openPalettes.set(document, close);
    document.addEventListener("pointerdown", onOutside, true);
    search.focus();
}
