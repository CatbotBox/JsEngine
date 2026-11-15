import {EDITOR_CONSOLE_LEVELS} from "../editorProtocol";
import type {EditorConsoleLevel} from "../editorProtocol";
import {allConsoleLevels, filterConsoleEntries} from "./consoleLog";
import type {ConsoleAppend, ConsoleEntry} from "./consoleLog";
import {createButton, createElement} from "./dom";
import type {EditorWorkspace} from "./editorWorkspace";

export const CONSOLE_BOTTOM_SLACK_PX = 8;

const LEVEL_LABELS: Readonly<Record<EditorConsoleLevel, string>> = {log: "Log", info: "Info", warn: "Warnings", error: "Errors", debug: "Debug"};
const TIME_DIGITS = 2;
const MILLISECOND_DIGITS = 3;
const ACTIVE_CLASS = "active";

function timeText(timeMs: number): string {
    const time = new Date(timeMs);
    const pad = (value: number, digits: number = TIME_DIGITS): string => String(value).padStart(digits, "0");
    return `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}.${pad(time.getMilliseconds(), MILLISECOND_DIGITS)}`;
}

export class ConsoleView {
    private readonly list: HTMLElement;
    private readonly toggles = new Map<EditorConsoleLevel, {readonly button: HTMLButtonElement, readonly count: HTMLElement}>();
    private readonly shown = allConsoleLevels();
    private readonly rows = new Map<number, HTMLElement>();
    private readonly countListeners = new Set<() => void>();

    public constructor(container: HTMLElement, private readonly workspace: EditorWorkspace) {
        const document = container.ownerDocument;
        const toolbar = createElement(document, "div", "console-toolbar");
        toolbar.append(createButton(document, {className: "", text: "Clear", title: "Remove every message", onClick: () => this.clear()}));
        for (const level of EDITOR_CONSOLE_LEVELS) {
            const count = createElement(document, "span", "console-count", "0");
            const button = createButton(document, {className: `console-filter level-${level} ${ACTIVE_CLASS}`, text: LEVEL_LABELS[level], title: `Show or hide ${LEVEL_LABELS[level].toLowerCase()}`, onClick: () => this.toggle(level)});
            button.setAttribute("aria-pressed", "true");
            button.append(count);
            this.toggles.set(level, {button, count});
            toolbar.append(button);
        }
        this.list = createElement(document, "div", "console-list");
        this.list.setAttribute("role", "log");
        container.replaceChildren(toolbar, this.list);
        workspace.onConsole(append => this.append(append));
        this.renderAll();
    }

    public onCountsChanged(listener: () => void): () => void {
        this.countListeners.add(listener);
        return () => this.countListeners.delete(listener);
    }

    private atBottom(): boolean {
        return this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight <= CONSOLE_BOTTOM_SLACK_PX;
    }

    private append(append: ConsoleAppend): void {
        const follow = this.atBottom();
        for (const dropped of append.dropped) {
            this.rows.get(dropped.id)?.remove();
            this.rows.delete(dropped.id);
        }
        if (this.shown.has(append.added.level)) this.list.append(this.row(append.added));
        if (follow) this.list.scrollTop = this.list.scrollHeight;
        this.showCounts();
    }

    private row(entry: ConsoleEntry): HTMLElement {
        const document = this.list.ownerDocument;
        const row = createElement(document, "div", `console-entry level-${entry.level}`);
        row.append(createElement(document, "span", "console-time", timeText(entry.timeMs)), createElement(document, "span", "console-text", entry.text));
        this.rows.set(entry.id, row);
        return row;
    }

    private renderAll(): void {
        this.rows.clear();
        this.list.replaceChildren(...filterConsoleEntries(this.workspace.consoleLog.entries, this.shown).map(entry => this.row(entry)));
        this.list.scrollTop = this.list.scrollHeight;
        this.showCounts();
    }

    private toggle(level: EditorConsoleLevel): void {
        if (this.shown.has(level)) this.shown.delete(level);
        else this.shown.add(level);
        const toggle = this.toggles.get(level)!;
        toggle.button.classList.toggle(ACTIVE_CLASS, this.shown.has(level));
        toggle.button.setAttribute("aria-pressed", String(this.shown.has(level)));
        this.renderAll();
    }

    private clear(): void {
        this.workspace.consoleLog.clear();
        this.renderAll();
    }

    private showCounts(): void {
        const counts = this.workspace.consoleLog.levelCounts;
        for (const [level, {count}] of this.toggles) count.textContent = String(counts[level]);
        for (const listener of this.countListeners) listener();
    }
}
