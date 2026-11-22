import {EDITOR_CONSOLE_LEVELS} from "../editorProtocol";
import type {EditorConsoleLevel} from "../editorProtocol";

export interface ConsoleEntry {
    readonly id: number;
    readonly level: EditorConsoleLevel;
    readonly text: string;
    readonly timeMs: number;
    readonly stack: string | undefined;
}

export type ConsoleLevelCounts = Readonly<Record<EditorConsoleLevel, number>>;

export interface ConsoleFilter {
    readonly levels: ReadonlySet<EditorConsoleLevel>;
    readonly search: string;
}

export interface ConsoleRow {
    readonly key: string;
    readonly level: EditorConsoleLevel;
    readonly text: string;
    readonly timeMs: number;
    readonly stack: string | undefined;
    readonly count: number;
}

export const MAX_CONSOLE_ENTRIES = 1000;

const FIRST_ENTRY_ID = 1;
const SINGLE_OCCURRENCE = 1;
const ENTRY_KEY_PREFIX = "entry:";
const GROUP_KEY_PREFIX = "group:";
const GROUP_KEY_SEPARATOR = ":";

export function emptyLevelCounts(): Record<EditorConsoleLevel, number> {
    return {log: 0, info: 0, warn: 0, error: 0, debug: 0};
}

export function countByLevel(entries: readonly ConsoleEntry[]): ConsoleLevelCounts {
    const counts = emptyLevelCounts();
    for (const entry of entries) counts[entry.level]++;
    return counts;
}

export function filterConsoleEntries(entries: readonly ConsoleEntry[], filter: ConsoleFilter): ConsoleEntry[] {
    const needle = filter.search.toLowerCase();
    return entries.filter(entry => filter.levels.has(entry.level) && (needle.length === 0 || entry.text.toLowerCase().includes(needle)));
}

export function allConsoleLevels(): Set<EditorConsoleLevel> {
    return new Set(EDITOR_CONSOLE_LEVELS);
}

function rowOf(entry: ConsoleEntry): ConsoleRow {
    return {key: `${ENTRY_KEY_PREFIX}${entry.id}`, level: entry.level, text: entry.text, timeMs: entry.timeMs, stack: entry.stack, count: SINGLE_OCCURRENCE};
}

export function collapseConsoleEntries(entries: readonly ConsoleEntry[]): ConsoleRow[] {
    const groups = new Map<string, ConsoleRow>();
    for (const entry of entries) {
        const key = `${GROUP_KEY_PREFIX}${entry.level}${GROUP_KEY_SEPARATOR}${entry.text}`;
        const count = (groups.get(key)?.count ?? 0) + 1;
        groups.set(key, {key, level: entry.level, text: entry.text, timeMs: entry.timeMs, stack: entry.stack, count});
    }
    return [...groups.values()];
}

export function consoleRows(entries: readonly ConsoleEntry[], filter: ConsoleFilter, collapsed: boolean): ConsoleRow[] {
    const shown = filterConsoleEntries(entries, filter);
    return collapsed ? collapseConsoleEntries(shown) : shown.map(rowOf);
}

export interface ConsoleAppend {
    readonly added: ConsoleEntry;
    readonly dropped: readonly ConsoleEntry[];
}

export class ConsoleLog {
    private readonly kept: ConsoleEntry[] = [];
    private readonly counts = emptyLevelCounts();
    private nextId = FIRST_ENTRY_ID;

    public constructor(private readonly capacity: number = MAX_CONSOLE_ENTRIES) {
    }

    public get entries(): readonly ConsoleEntry[] {
        return this.kept;
    }

    public get levelCounts(): ConsoleLevelCounts {
        return this.counts;
    }

    public add(level: EditorConsoleLevel, text: string, timeMs: number, stack?: string): ConsoleAppend {
        const added: ConsoleEntry = {id: this.nextId++, level, text, timeMs, stack};
        this.kept.push(added);
        this.counts[level]++;
        const overflow = Math.max(0, this.kept.length - this.capacity);
        const dropped = this.kept.splice(0, overflow);
        for (const entry of dropped) this.counts[entry.level]--;
        return {added, dropped};
    }

    public clear(): void {
        this.kept.length = 0;
        for (const level of EDITOR_CONSOLE_LEVELS) this.counts[level] = 0;
    }
}
