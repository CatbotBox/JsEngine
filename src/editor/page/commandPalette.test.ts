import {describe, expect, test} from "../../engine/testing/harness";
import {filterPaletteEntries, paletteEntries, paletteEntryText} from "./commandPalette";
import type {PaletteEntry} from "./commandPalette";
import {CommandRegistry} from "./commandRegistry";

function entry(category: string, label: string, enabled = true): PaletteEntry {
    return {key: `${category}.${label}`, commandId: `${category}.${label}`, category, label, shortcutText: undefined, enabled, reason: enabled ? undefined : "not yet", run: () => enabled};
}

const ENTRIES: readonly PaletteEntry[] = [
    entry("File", "Save As…", false),
    entry("File", "Save"),
    entry("Edit", "Select All"),
    entry("Assets", "Show in Explorer", false),
    entry("Window", "Scene View"),
    entry("Play", "Step"),
];

function texts(entries: readonly PaletteEntry[]): string[] {
    return entries.map(paletteEntryText);
}

describe("command palette filtering", () => {
    test("an empty query lists everything, enabled commands first, otherwise in registration order", () => {
        expect(texts(filterPaletteEntries(ENTRIES, "  "))).toEqual([
            "File: Save", "Edit: Select All", "Window: Scene View", "Play: Step", "File: Save As…", "Assets: Show in Explorer",
        ]);
    });

    test("a label prefix ranks first, then word starts, then substrings, then scattered letters", () => {
        expect(texts(filterPaletteEntries(ENTRIES, "s"))).toEqual([
            "File: Save", "Edit: Select All", "Window: Scene View", "Play: Step", "File: Save As…", "Assets: Show in Explorer",
        ]);
        expect(texts(filterPaletteEntries(ENTRIES, "view"))).toEqual(["Window: Scene View"]);
        expect(texts(filterPaletteEntries(ENTRIES, "elect"))).toEqual(["Edit: Select All"]);
        expect(texts(filterPaletteEntries(ENTRIES, "svw"))).toEqual(["Window: Scene View"]);
    });

    test("every word must match somewhere in the category or label, in any order", () => {
        expect(texts(filterPaletteEntries(ENTRIES, "file save"))).toEqual(["File: Save", "File: Save As…"]);
        expect(texts(filterPaletteEntries(ENTRIES, "view scene"))).toEqual(["Window: Scene View"]);
        expect(texts(filterPaletteEntries(ENTRIES, "edit explorer"))).toEqual([]);
    });

    test("matching ignores case", () => {
        expect(texts(filterPaletteEntries(ENTRIES, "SELECT"))).toEqual(["Edit: Select All"]);
    });
});

describe("command palette entries", () => {
    test("commands that can run alone, planned commands and each choice become entries; context-only commands do not", () => {
        const registry = new CommandRegistry();
        let ran = "";
        registry.add({id: "save", category: "File", label: "Save", shortcuts: ["Ctrl+S"], run: () => ran = "save"});
        registry.addPlanned({id: "saveAs", category: "File", label: "Save As…", reason: "later"});
        registry.addTargeted<string>({id: "rename", category: "Assets", label: "Rename", run: () => undefined});
        registry.addTargeted<string>({id: "aspect", category: "Game View", label: "Aspect", labelFor: id => `Aspect ${id}`, choices: () => ["16:9", "4:3"], run: id => ran = id});
        const entries = paletteEntries(registry.all());
        expect(entries.map(item => [paletteEntryText(item), item.shortcutText, item.enabled, item.reason])).toEqual([
            ["File: Save", "Ctrl+S", true, undefined],
            ["File: Save As…", undefined, false, "later"],
            ["Game View: Aspect 16:9", undefined, true, undefined],
            ["Game View: Aspect 4:3", undefined, true, undefined],
        ]);
        expect(new Set(entries.map(item => item.key)).size).toBe(entries.length);
        expect(entries.map(item => item.commandId)).toEqual(["save", "saveAs", "aspect", "aspect"]);
        entries[3].run();
        expect(ran).toBe("4:3");
        expect(entries[1].run()).toBe(false);
    });
});
