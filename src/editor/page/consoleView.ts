import {EDITOR_CONSOLE_LEVELS} from "../editorProtocol";
import type {EditorConsoleLevel} from "../editorProtocol";
import {allConsoleLevels, consoleRows} from "./consoleLog";
import type {ConsoleRow} from "./consoleLog";
import {createButton, createElement} from "./dom";
import type {EditorWorkspace} from "./editorWorkspace";

export const CONSOLE_BOTTOM_SLACK_PX = 8;

const LEVEL_LABELS: Readonly<Record<EditorConsoleLevel, string>> = {log: "Log", info: "Info", warn: "Warnings", error: "Errors", debug: "Debug"};
const TIME_DIGITS = 2;
const MILLISECOND_DIGITS = 3;
const ACTIVE_CLASS = "active";
const EXPANDED_CLASS = "expanded";
const HAS_STACK_CLASS = "has-stack";
const COLLAPSED_MARKER = "▸";
const EXPANDED_MARKER = "▾";
const SHOW_STACK_TITLE = "Show the stack trace";
const HIDE_STACK_TITLE = "Hide the stack trace";
const SEARCH_PLACEHOLDER = "Search";
const SEARCH_INPUT_TYPE = "search";
const SINGLE_OCCURRENCE = 1;
const SCROLL_TO_END = true;
const KEEP_SCROLL = false;

interface RenderedRow {
    readonly element: HTMLElement;
    readonly expander: HTMLButtonElement;
    readonly time: HTMLElement;
    readonly text: HTMLElement;
    readonly repeat: HTMLElement;
    readonly stack: HTMLElement;
    shown: ConsoleRow | undefined;
}

function timeText(timeMs: number): string {
    const time = new Date(timeMs);
    const pad = (value: number, digits: number = TIME_DIGITS): string => String(value).padStart(digits, "0");
    return `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}.${pad(time.getMilliseconds(), MILLISECOND_DIGITS)}`;
}

function sameRow(a: ConsoleRow | undefined, b: ConsoleRow): boolean {
    return a !== undefined && a.count === b.count && a.timeMs === b.timeMs && a.stack === b.stack && a.text === b.text && a.level === b.level;
}

export class ConsoleView {
    private readonly list: HTMLElement;
    private readonly toggles = new Map<EditorConsoleLevel, {readonly button: HTMLButtonElement, readonly count: HTMLElement}>();
    private readonly collapseButton: HTMLButtonElement;
    private readonly shown = allConsoleLevels();
    private readonly rows = new Map<string, RenderedRow>();
    private readonly expanded = new Set<string>();
    private readonly countListeners = new Set<() => void>();
    private search = "";
    private collapsed = false;
    private renderScheduled = false;

    public constructor(container: HTMLElement, private readonly workspace: EditorWorkspace) {
        const document = container.ownerDocument;
        const toolbar = createElement(document, "div", "console-toolbar");
        toolbar.append(createButton(document, {className: "", text: "Clear", title: "Remove every message", onClick: () => this.clear()}));
        this.collapseButton = createButton(document, {className: "console-collapse", text: "Collapse", title: "Show identical messages as one row with a count", onClick: () => this.toggleCollapse()});
        this.collapseButton.setAttribute("aria-pressed", "false");
        toolbar.append(this.collapseButton);
        for (const level of EDITOR_CONSOLE_LEVELS) {
            const count = createElement(document, "span", "console-count", "0");
            const button = createButton(document, {className: `console-filter level-${level} ${ACTIVE_CLASS}`, text: LEVEL_LABELS[level], title: `Show or hide ${LEVEL_LABELS[level].toLowerCase()}`, onClick: () => this.toggle(level)});
            button.setAttribute("aria-pressed", "true");
            button.append(count);
            this.toggles.set(level, {button, count});
            toolbar.append(button);
        }
        const search = createElement(document, "input", "console-search");
        search.type = SEARCH_INPUT_TYPE;
        search.placeholder = SEARCH_PLACEHOLDER;
        search.setAttribute("aria-label", "Search messages");
        search.addEventListener("input", () => {
            this.search = search.value;
            this.render(SCROLL_TO_END);
        });
        toolbar.append(search);
        this.list = createElement(document, "div", "console-list");
        this.list.setAttribute("role", "log");
        container.replaceChildren(toolbar, this.list);
        workspace.onConsole(() => this.appended());
        this.render(SCROLL_TO_END);
        this.showCounts();
    }

    public onCountsChanged(listener: () => void): () => void {
        this.countListeners.add(listener);
        return () => this.countListeners.delete(listener);
    }

    private atBottom(): boolean {
        return this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight <= CONSOLE_BOTTOM_SLACK_PX;
    }

    private appended(): void {
        this.showCounts();
        if (this.renderScheduled) return;
        const window = this.list.ownerDocument.defaultView;
        if (window === null) {
            this.render(KEEP_SCROLL);
            return;
        }
        this.renderScheduled = true;
        window.requestAnimationFrame(() => {
            this.renderScheduled = false;
            this.render(KEEP_SCROLL);
        });
    }

    private render(scrollToEnd: boolean): void {
        const follow = scrollToEnd || this.atBottom();
        const models = consoleRows(this.workspace.consoleLog.entries, {levels: this.shown, search: this.search}, this.collapsed);
        const keys = new Set(models.map(model => model.key));
        for (const [key, row] of this.rows) {
            if (keys.has(key)) continue;
            row.element.remove();
            this.rows.delete(key);
            this.expanded.delete(key);
        }
        let cursor = this.list.firstChild;
        for (const model of models) {
            const row = this.rows.get(model.key) ?? this.createRow(model.key);
            if (!sameRow(row.shown, model)) this.fill(row, model);
            if (row.element === cursor) cursor = cursor.nextSibling;
            else this.list.insertBefore(row.element, cursor);
        }
        if (follow) this.list.scrollTop = this.list.scrollHeight;
    }

    private createRow(key: string): RenderedRow {
        const document = this.list.ownerDocument;
        const element = createElement(document, "div", "console-entry");
        const expander = createButton(document, {className: "console-expander", text: COLLAPSED_MARKER, title: SHOW_STACK_TITLE, onClick: event => {
            event.stopPropagation();
            this.toggleStack(key);
        }});
        const row: RenderedRow = {
            element,
            expander,
            time: createElement(document, "span", "console-time"),
            text: createElement(document, "span", "console-text"),
            repeat: createElement(document, "span", "console-repeat"),
            stack: createElement(document, "pre", "console-stack"),
            shown: undefined,
        };
        element.append(row.expander, row.time, row.text, row.repeat, row.stack);
        element.addEventListener("click", () => {
            if (row.shown?.stack === undefined || document.getSelection()?.isCollapsed === false) return;
            this.toggleStack(key);
        });
        this.rows.set(key, row);
        return row;
    }

    private fill(row: RenderedRow, model: ConsoleRow): void {
        row.shown = model;
        row.element.className = `console-entry level-${model.level}`;
        row.time.textContent = timeText(model.timeMs);
        row.text.textContent = model.text;
        row.repeat.textContent = String(model.count);
        row.repeat.hidden = model.count === SINGLE_OCCURRENCE;
        row.stack.textContent = model.stack ?? "";
        this.showExpansion(row, model.key);
    }

    private showExpansion(row: RenderedRow, key: string): void {
        const hasStack = row.shown?.stack !== undefined;
        const expanded = hasStack && this.expanded.has(key);
        row.element.classList.toggle(HAS_STACK_CLASS, hasStack);
        row.element.classList.toggle(EXPANDED_CLASS, expanded);
        row.expander.hidden = !hasStack;
        row.expander.textContent = expanded ? EXPANDED_MARKER : COLLAPSED_MARKER;
        row.expander.title = expanded ? HIDE_STACK_TITLE : SHOW_STACK_TITLE;
        row.expander.setAttribute("aria-expanded", String(expanded));
        row.stack.hidden = !expanded;
    }

    private toggleStack(key: string): void {
        const row = this.rows.get(key);
        if (row === undefined) return;
        if (this.expanded.has(key)) this.expanded.delete(key);
        else this.expanded.add(key);
        this.showExpansion(row, key);
    }

    private toggle(level: EditorConsoleLevel): void {
        if (this.shown.has(level)) this.shown.delete(level);
        else this.shown.add(level);
        const toggle = this.toggles.get(level)!;
        toggle.button.classList.toggle(ACTIVE_CLASS, this.shown.has(level));
        toggle.button.setAttribute("aria-pressed", String(this.shown.has(level)));
        this.render(SCROLL_TO_END);
    }

    private toggleCollapse(): void {
        this.collapsed = !this.collapsed;
        this.collapseButton.classList.toggle(ACTIVE_CLASS, this.collapsed);
        this.collapseButton.setAttribute("aria-pressed", String(this.collapsed));
        this.render(SCROLL_TO_END);
    }

    private clear(): void {
        this.workspace.consoleLog.clear();
        this.render(SCROLL_TO_END);
        this.showCounts();
    }

    private showCounts(): void {
        const counts = this.workspace.consoleLog.levelCounts;
        for (const [level, {count}] of this.toggles) count.textContent = String(counts[level]);
        for (const listener of this.countListeners) listener();
    }
}
