import {EDITOR_CONSOLE_LEVELS} from "../editorProtocol";
import type {EditorConsoleLevel} from "../editorProtocol";

export interface ConsoleEntry {
    readonly id: number;
    readonly level: EditorConsoleLevel;
    readonly text: string;
    readonly timeMs: number;
}

export type ConsoleLevelCounts = Readonly<Record<EditorConsoleLevel, number>>;

export const MAX_CONSOLE_ENTRIES = 1000;

const FIRST_ENTRY_ID = 1;

export function emptyLevelCounts(): Record<EditorConsoleLevel, number> {
    return {log: 0, info: 0, warn: 0, error: 0, debug: 0};
}

export function countByLevel(entries: readonly ConsoleEntry[]): ConsoleLevelCounts {
    const counts = emptyLevelCounts();
    for (const entry of entries) counts[entry.level]++;
    return counts;
}

export function filterConsoleEntries(entries: readonly ConsoleEntry[], shownLevels: ReadonlySet<EditorConsoleLevel>): ConsoleEntry[] {
    return entries.filter(entry => shownLevels.has(entry.level));
}

export function allConsoleLevels(): Set<EditorConsoleLevel> {
    return new Set(EDITOR_CONSOLE_LEVELS);
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

    public add(level: EditorConsoleLevel, text: string, timeMs: number): ConsoleAppend {
        const added: ConsoleEntry = {id: this.nextId++, level, text, timeMs};
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
