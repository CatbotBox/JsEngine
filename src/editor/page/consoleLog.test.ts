import {describe, expect, test} from "../../engine/testing/harness";
import {allConsoleLevels, ConsoleLog, countByLevel, filterConsoleEntries} from "./consoleLog";

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
        const shown = allConsoleLevels();
        shown.delete("debug");
        shown.delete("log");
        expect(filterConsoleEntries(log.entries, shown).map(entry => entry.text)).toEqual(["bad"]);
        log.clear();
        expect(log.entries.length).toBe(0);
        expect(log.levelCounts.error).toBe(0);
    });
});
