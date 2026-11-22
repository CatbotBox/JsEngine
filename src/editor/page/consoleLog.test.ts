import {describe, expect, test} from "../../engine/testing/harness";
import type {EditorConsoleLevel} from "../editorProtocol";
import {allConsoleLevels, collapseConsoleEntries, ConsoleLog, consoleRows, countByLevel, filterConsoleEntries} from "./consoleLog";
import type {ConsoleFilter, ConsoleRow} from "./consoleLog";

const EVERYTHING: ConsoleFilter = {levels: allConsoleLevels(), search: ""};
const COLLAPSED = true;
const EXPANDED = false;

function shownLevels(...levels: EditorConsoleLevel[]): Set<EditorConsoleLevel> {
    return new Set(levels);
}

function summary(rows: readonly ConsoleRow[]): string[] {
    return rows.map(row => `${row.level} ${row.text} x${row.count} @${row.timeMs}`);
}

describe("console log", () => {
    test("entries keep their order and are counted by level", () => {
        const log = new ConsoleLog();
        log.add("log", "one", 1);
        log.add("warn", "two", 2);
        log.add("log", "three", 3);
        expect(log.entries.map(entry => entry.text)).toEqual(["one", "two", "three"]);
        expect(log.levelCounts).toEqual({log: 2, info: 0, warn: 1, error: 0, debug: 0});
        expect(countByLevel(log.entries)).toEqual(log.levelCounts);
    });

    test("past the cap the oldest entries are dropped and uncounted", () => {
        const log = new ConsoleLog(3);
        log.add("error", "a", 1);
        log.add("log", "b", 2);
        log.add("log", "c", 3);
        const appended = log.add("info", "d", 4);
        expect(appended.dropped.map(entry => entry.text)).toEqual(["a"]);
        expect(log.entries.map(entry => entry.text)).toEqual(["b", "c", "d"]);
        expect(log.levelCounts.error).toBe(0);
        expect(log.entries[2].id).toBeGreaterThan(log.entries[1].id);
    });

    test("level filters keep only the shown levels, and clear empties everything", () => {
        const log = new ConsoleLog();
        log.add("log", "plain", 1);
        log.add("error", "bad", 2);
        log.add("debug", "noise", 3);
        expect(filterConsoleEntries(log.entries, {levels: shownLevels("error", "warn", "info"), search: ""}).map(entry => entry.text)).toEqual(["bad"]);
        log.clear();
        expect(log.entries.length).toBe(0);
        expect(log.levelCounts.error).toBe(0);
    });

    test("entries keep the stack they were logged with", () => {
        const log = new ConsoleLog();
        log.add("error", "boom", 1, "    at fail (game.js:1:2)");
        log.add("log", "fine", 2);
        expect(log.entries.map(entry => entry.stack)).toEqual(["    at fail (game.js:1:2)", undefined]);
    });

    test("search keeps entries whose text contains it, ignoring case, on top of the level filter", () => {
        const log = new ConsoleLog();
        log.add("log", "Player spawned", 1);
        log.add("warn", "player fell", 2);
        log.add("error", "Enemy lost", 3);
        expect(filterConsoleEntries(log.entries, {levels: allConsoleLevels(), search: "PLAYER"}).map(entry => entry.text)).toEqual(["Player spawned", "player fell"]);
        expect(filterConsoleEntries(log.entries, {levels: shownLevels("warn"), search: "player"}).map(entry => entry.text)).toEqual(["player fell"]);
        expect(filterConsoleEntries(log.entries, {levels: allConsoleLevels(), search: ""}).length).toBe(3);
    });

    test("collapsing groups identical level and text in first-seen order with the latest time and stack", () => {
        const log = new ConsoleLog();
        log.add("log", "tick", 1);
        log.add("warn", "slow", 2, "first");
        log.add("log", "tick", 3);
        log.add("warn", "tick", 4);
        log.add("warn", "slow", 5, "second");
        const rows = collapseConsoleEntries(log.entries);
        expect(summary(rows)).toEqual(["log tick x2 @3", "warn slow x2 @5", "warn tick x1 @4"]);
        expect(rows[1].stack).toBe("second");
        expect(new Set(rows.map(row => row.key)).size).toBe(rows.length);
    });

    test("uncollapsed rows are one per entry with stable keys", () => {
        const log = new ConsoleLog();
        log.add("log", "tick", 1);
        log.add("log", "tick", 2);
        const rows = consoleRows(log.entries, EVERYTHING, EXPANDED);
        expect(summary(rows)).toEqual(["log tick x1 @1", "log tick x1 @2"]);
        expect(rows[0].key).not.toBe(rows[1].key);
        expect(consoleRows(log.entries, EVERYTHING, EXPANDED).map(row => row.key)).toEqual(rows.map(row => row.key));
    });

    test("live appends update collapsed counts through search, level filters and the capacity drop", () => {
        const log = new ConsoleLog(3);
        const filter: ConsoleFilter = {levels: shownLevels("log", "warn"), search: "tick"};
        log.add("log", "tick", 1);
        log.add("info", "tick", 2);
        log.add("log", "other", 3);
        expect(summary(consoleRows(log.entries, filter, COLLAPSED))).toEqual(["log tick x1 @1"]);
        const groupKey = consoleRows(log.entries, filter, COLLAPSED)[0].key;
        log.add("log", "tick", 4);
        expect(summary(consoleRows(log.entries, filter, COLLAPSED))).toEqual(["log tick x1 @4"]);
        log.add("warn", "tick", 5);
        log.add("log", "tick", 6);
        const rows = consoleRows(log.entries, filter, COLLAPSED);
        expect(summary(rows)).toEqual(["log tick x2 @6", "warn tick x1 @5"]);
        expect(rows[0].key).toBe(groupKey);
        log.add("error", "x", 7);
        log.add("error", "y", 8);
        log.add("error", "z", 9);
        expect(consoleRows(log.entries, filter, COLLAPSED)).toEqual([]);
    });
});
