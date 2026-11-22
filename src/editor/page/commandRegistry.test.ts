import {describe, expect, test} from "../../engine/testing/harness";
import {
    chordKey,
    CommandRegistrationError,
    CommandRegistry,
    keyChordOf,
    NO_TARGET_REASON,
    parseShortcut,
    shortcutText,
    ShortcutSyntaxError,
} from "./commandRegistry";
import type {KeyContext, KeyEventLike, KeyResolution} from "./commandRegistry";

const OUTSIDE_TEXT: KeyContext = {inTextEntry: false, textEdited: false};
const IN_UNEDITED_TEXT: KeyContext = {inTextEntry: true, textEdited: false};
const IN_EDITED_TEXT: KeyContext = {inTextEntry: true, textEdited: true};
const PLANNED_REASON = "arrives later";

function key(text: string, modifiers: Partial<Omit<KeyEventLike, "key">> = {}): KeyEventLike {
    return {key: text, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers};
}

function boundId(resolution: KeyResolution): string | undefined {
    return resolution.kind === "bound" ? resolution.command.id : undefined;
}

describe("shortcut parsing", () => {
    test("modifiers and keys parse case-insensitively and print in one canonical order", () => {
        expect(parseShortcut("Ctrl+Shift+Z")).toEqual({key: "z", command: true, shift: true, alt: false});
        expect(parseShortcut("shift+ctrl+z")).toEqual(parseShortcut("Ctrl+Shift+Z"));
        expect(shortcutText(parseShortcut("alt+shift+ctrl+p"))).toBe("Ctrl+Shift+Alt+P");
        expect(shortcutText(parseShortcut("F2"))).toBe("F2");
        expect(shortcutText(parseShortcut("Delete"))).toBe("Del");
        expect(parseShortcut("Del")).toEqual(parseShortcut("Delete"));
    });

    test("unknown or repeated modifiers and a missing key are errors", () => {
        expect(() => parseShortcut("Hyper+K")).toThrow(ShortcutSyntaxError);
        expect(() => parseShortcut("Ctrl+Ctrl+K")).toThrow(ShortcutSyntaxError);
        expect(() => parseShortcut("Ctrl+")).toThrow(ShortcutSyntaxError);
        expect(() => parseShortcut("")).toThrow(ShortcutSyntaxError);
    });

    test("a key event's chord matches the parsed shortcut, Cmd counts as Ctrl and Shift changes the chord", () => {
        expect(chordKey(keyChordOf(key("Z", {ctrlKey: true, shiftKey: true})))).toBe(chordKey(parseShortcut("Ctrl+Shift+Z")));
        expect(chordKey(keyChordOf(key("s", {metaKey: true})))).toBe(chordKey(parseShortcut("Ctrl+S")));
        expect(chordKey(keyChordOf(key("Delete")))).toBe(chordKey(parseShortcut("Del")));
        expect(chordKey(keyChordOf(key("q", {shiftKey: true})))).not.toBe(chordKey(parseShortcut("Q")));
    });
});

describe("command registration", () => {
    test("a shortcut bound twice names both commands", () => {
        const registry = new CommandRegistry();
        registry.add({id: "first", category: "Test", label: "First", shortcuts: ["Ctrl+K"], run: () => undefined});
        expect(() => registry.add({id: "second", category: "Test", label: "Second", shortcuts: ["ctrl+k"], run: () => undefined}))
            .toThrow("Ctrl+K is bound to both first and second");
        expect(registry.get("second")).toBeUndefined();
    });

    test("ids are unique, one command cannot list a shortcut twice, and a shortcut needs a target", () => {
        const registry = new CommandRegistry();
        registry.add({id: "same", category: "Test", label: "Same", run: () => undefined});
        expect(() => registry.add({id: "same", category: "Test", label: "Again", run: () => undefined})).toThrow(CommandRegistrationError);
        expect(() => registry.add({id: "twice", category: "Test", label: "Twice", shortcuts: ["Q", "q"], run: () => undefined})).toThrow(CommandRegistrationError);
        expect(() => registry.addTargeted<string>({id: "untargeted", category: "Test", label: "Untargeted", shortcuts: ["X"], run: () => undefined})).toThrow(CommandRegistrationError);
    });

    test("all lists commands in registration order", () => {
        const registry = new CommandRegistry();
        for (const id of ["b", "a", "c"]) registry.add({id, category: "Test", label: id, run: () => undefined});
        expect(registry.all().map(command => command.id)).toEqual(["b", "a", "c"]);
    });
});

describe("command state and running", () => {
    test("a disabled command does not run and reports why; enabling it lets it run", () => {
        const registry = new CommandRegistry();
        let reason: string | undefined = "Nothing is selected";
        let runs = 0;
        const command = registry.add({id: "delete", category: "Edit", label: "Delete", shortcuts: ["Delete"], disabledReason: () => reason, run: () => runs++});
        expect(command.stateAlone()).toEqual({label: "Delete", enabled: false, reason: "Nothing is selected", checked: undefined, shortcutText: "Del", planned: false});
        expect(command.runAlone()).toBe(false);
        reason = undefined;
        expect(command.runAlone()).toBe(true);
        expect(runs).toBe(1);
    });

    test("labels and checked marks are read when asked, so they follow the editor's state", () => {
        const registry = new CommandRegistry();
        let playing = false;
        const command = registry.add({id: "play", category: "Play", label: "Play", labelFor: () => playing ? "Stop" : "Play", checked: () => playing, run: () => playing = !playing});
        expect([command.stateAlone().label, command.stateAlone().checked]).toEqual(["Play", false]);
        command.runAlone();
        expect([command.stateAlone().label, command.stateAlone().checked]).toEqual(["Stop", true]);
    });

    test("a planned command is always disabled with its reason, and its shortcut still resolves so the reason can be shown", () => {
        const registry = new CommandRegistry();
        const command = registry.addPlanned({id: "saveAs", category: "File", label: "Save As…", shortcuts: ["Ctrl+Shift+S"], reason: PLANNED_REASON});
        expect(command.stateAlone()).toEqual({label: "Save As…", enabled: false, reason: PLANNED_REASON, checked: undefined, shortcutText: "Ctrl+Shift+S", planned: true});
        expect(command.runAlone()).toBe(false);
        expect(boundId(registry.resolveKey(keyChordOf(key("S", {ctrlKey: true, shiftKey: true})), OUTSIDE_TEXT))).toBe("saveAs");
    });

    test("a targeted command acts on its target alone and on an explicit argument from a context menu", () => {
        const registry = new CommandRegistry();
        let selection: readonly number[] = [];
        const removed: number[][] = [];
        const command = registry.addTargeted<readonly number[]>({
            id: "remove", category: "Edit", label: "Delete", target: () => selection,
            disabledReason: entities => entities.length === 0 ? "Nothing is selected" : undefined,
            run: entities => removed.push([...entities]),
        });
        expect(command.runAlone()).toBe(false);
        selection = [4, 5];
        expect(command.runAlone()).toBe(true);
        expect(command.runWith([9])).toBe(true);
        expect(command.stateOf([]).enabled).toBe(false);
        expect(removed).toEqual([[4, 5], [9]]);
    });

    test("a command without a target can only run with an argument, and says so when asked alone", () => {
        const registry = new CommandRegistry();
        const command = registry.addTargeted<string>({id: "rename", category: "Assets", label: "Rename", run: () => undefined});
        expect(command.invocableAlone).toBe(false);
        expect(command.stateAlone().reason).toBe(NO_TARGET_REASON);
        expect(command.runAlone()).toBe(false);
        expect(command.paletteChoices()).toEqual([]);
        expect(command.runWith("a.png")).toBe(true);
    });

    test("choices list one palette entry per argument", () => {
        const registry = new CommandRegistry();
        const chosen: number[] = [];
        const command = registry.addTargeted<number>({id: "step", category: "Snap", label: "Step", labelFor: step => `Step ${step}`, choices: () => [1, 2], checked: step => step === 2, run: step => chosen.push(step)});
        const choices = command.paletteChoices();
        expect(choices.map(choice => [choice.state.label, choice.state.checked])).toEqual([["Step 1", false], ["Step 2", true]]);
        choices[0].run();
        expect(chosen).toEqual([1]);
    });

    test("planned commands always explain a blocked shortcut; others only when their predicate says so", () => {
        const registry = new CommandRegistry();
        let playing = false;
        const quiet = registry.add({id: "quiet", category: "Edit", label: "Quiet", run: () => undefined});
        const loud = registry.add({id: "loud", category: "Edit", label: "Loud", explainsWhenDisabled: () => playing, run: () => undefined});
        const planned = registry.addPlanned({id: "planned", category: "Edit", label: "Planned", reason: PLANNED_REASON});
        expect([quiet.explainsWhenDisabled(), loud.explainsWhenDisabled(), planned.explainsWhenDisabled()]).toEqual([false, false, true]);
        playing = true;
        expect(loud.explainsWhenDisabled()).toBe(true);
    });

    test("change listeners hear changed() until they unsubscribe", () => {
        const registry = new CommandRegistry();
        let heard = 0;
        const unsubscribe = registry.onChange(() => heard++);
        registry.changed();
        unsubscribe();
        registry.changed();
        expect(heard).toBe(1);
    });
});

describe("shortcut dispatch", () => {
    function registryWithEditorKeys(textSelected: () => boolean = () => false): CommandRegistry {
        const registry = new CommandRegistry();
        registry.add({id: "save", category: "File", label: "Save", shortcuts: ["Ctrl+S"], inTextEntry: "allowed", run: () => undefined});
        registry.add({id: "undo", category: "Edit", label: "Undo", shortcuts: ["Ctrl+Z"], inTextEntry: "allowedWithoutEdits", run: () => undefined});
        registry.add({id: "copy", category: "Edit", label: "Copy", shortcuts: ["Ctrl+C"], yieldsKey: textSelected, run: () => undefined});
        registry.add({id: "move", category: "Tools", label: "Move", shortcuts: ["W"], run: () => undefined});
        return registry;
    }

    test("an unbound chord is left alone", () => {
        expect(registryWithEditorKeys().resolveKey(keyChordOf(key("k", {ctrlKey: true})), OUTSIDE_TEXT)).toEqual({kind: "unbound"});
    });

    test("outside text fields every binding resolves; in a text field only the ones that allow it", () => {
        const registry = registryWithEditorKeys();
        expect(boundId(registry.resolveKey(keyChordOf(key("w")), OUTSIDE_TEXT))).toBe("move");
        expect(registry.resolveKey(keyChordOf(key("w")), IN_UNEDITED_TEXT)).toEqual({kind: "passed"});
        expect(boundId(registry.resolveKey(keyChordOf(key("s", {ctrlKey: true})), IN_EDITED_TEXT))).toBe("save");
    });

    test("undo in a text field goes to the field once it has edits, otherwise to the editor and leaves the field", () => {
        const registry = registryWithEditorKeys();
        const undo = keyChordOf(key("z", {ctrlKey: true}));
        expect(registry.resolveKey(undo, IN_EDITED_TEXT)).toEqual({kind: "passed"});
        const unedited = registry.resolveKey(undo, IN_UNEDITED_TEXT);
        expect(unedited.kind === "bound" && unedited.leavesTextEntry).toBe(true);
        const outside = registry.resolveKey(undo, OUTSIDE_TEXT);
        expect(outside.kind === "bound" && outside.leavesTextEntry).toBe(false);
    });

    test("a command that yields leaves the key to the page, e.g. copy while text is selected", () => {
        let textSelected = true;
        const registry = registryWithEditorKeys(() => textSelected);
        const copy = keyChordOf(key("c", {ctrlKey: true}));
        expect(registry.resolveKey(copy, OUTSIDE_TEXT)).toEqual({kind: "passed"});
        textSelected = false;
        expect(boundId(registry.resolveKey(copy, OUTSIDE_TEXT))).toBe("copy");
    });
});
