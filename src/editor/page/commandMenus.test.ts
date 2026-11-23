import {describe, expect, test} from "../../engine/testing/harness";
import {choiceEntries, commandEntry, commandEntryFor, menuItemsOf, submenuEntry} from "./commandMenus";
import {CommandRegistry} from "./commandRegistry";
import {MENU_SEPARATOR} from "./popupMenu";
import type {MenuAction, MenuItem, MenuSubmenu} from "./popupMenu";

function labels(items: readonly MenuItem[]): string[] {
    return items.map(item => item === MENU_SEPARATOR ? "-" : item.label);
}

function actionAt(items: readonly MenuItem[], index: number): MenuAction {
    const item = items[index];
    if (item === MENU_SEPARATOR || "items" in item) throw new Error(`item ${index} is not an action`);
    return item;
}

function submenuAt(items: readonly MenuItem[], index: number): MenuSubmenu {
    const item = items[index];
    if (item === MENU_SEPARATOR || !("items" in item)) throw new Error(`item ${index} is not a submenu`);
    return item;
}

describe("menus built from commands", () => {
    test("an item carries the command's label, shortcut, disabled reason and checked mark, and runs it", () => {
        const registry = new CommandRegistry();
        let ran = 0;
        const save = registry.add({id: "save", category: "File", label: "Save", shortcuts: ["Ctrl+S"], run: () => ran++});
        const saveAs = registry.addPlanned({id: "saveAs", category: "File", label: "Save As…", reason: "later"});
        const grid = registry.add({id: "grid", category: "View", label: "Grid", checked: () => true, run: () => undefined});
        const items = menuItemsOf([commandEntry(save), commandEntry(saveAs), commandEntry(grid)]);
        expect(items[0]).toEqual({label: "Save", disabled: false, commandId: "save", shortcut: "Ctrl+S", run: actionAt(items, 0).run});
        expect([actionAt(items, 1).disabled, actionAt(items, 1).title]).toEqual([true, "later"]);
        expect(actionAt(items, 2).checked).toBe(true);
        expect("checked" in actionAt(items, 0)).toBe(false);
        actionAt(items, 0).run();
        actionAt(items, 1).run();
        expect(ran).toBe(1);
    });

    test("an entry can bind an argument and override the label, which a context menu uses", () => {
        const registry = new CommandRegistry();
        const renamed: string[] = [];
        const rename = registry.addTargeted<string>({id: "rename", category: "Assets", label: "Rename", run: path => renamed.push(path)});
        const items = menuItemsOf([commandEntryFor(rename, "a.png", "Rename Image")]);
        expect(labels(items)).toEqual(["Rename Image"]);
        actionAt(items, 0).run();
        expect(renamed).toEqual(["a.png"]);
    });

    test("a menu item names its command, and a choice item also its index among the command's choices, for stable hooks", () => {
        const registry = new CommandRegistry();
        const step = registry.addTargeted<number>({id: "snap.step", category: "Snap", label: "Step", choices: () => [1, 2, 4, 8], run: () => undefined});
        const items = menuItemsOf(choiceEntries(step, String, value => value > 1));
        expect(items.map(item => item === MENU_SEPARATOR || "items" in item ? undefined : [item.commandId, item.choiceIndex])).toEqual([["snap.step", 1], ["snap.step", 2], ["snap.step", 3]]);
    });

    test("leading, trailing and doubled separators are dropped", () => {
        const registry = new CommandRegistry();
        const one = registry.add({id: "one", category: "Test", label: "One", run: () => undefined});
        const two = registry.add({id: "two", category: "Test", label: "Two", run: () => undefined});
        const items = menuItemsOf([MENU_SEPARATOR, commandEntry(one), MENU_SEPARATOR, MENU_SEPARATOR, commandEntry(two), MENU_SEPARATOR]);
        expect(labels(items)).toEqual(["One", "-", "Two"]);
    });

    test("submenus nest, carry a checked mark when given one, and choices fill a submenu", () => {
        const registry = new CommandRegistry();
        const step = registry.addTargeted<number>({id: "step", category: "Snap", label: "Step", choices: () => [1, 2, 4], checked: value => value === 2, run: () => undefined});
        const items = menuItemsOf([submenuEntry("snap", "Snap", [submenuEntry("even", "Even", choiceEntries(step, String, value => value % 2 === 0), () => true)])]);
        const snap = submenuAt(items, 0);
        const even = submenuAt(snap.items, 0);
        expect([snap.checked, even.checked]).toEqual([undefined, true]);
        expect([snap.id, even.id]).toEqual(["snap", "even"]);
        expect(labels(even.items)).toEqual(["2", "4"]);
        expect([actionAt(even.items, 0).checked, actionAt(even.items, 1).checked]).toEqual([true, false]);
    });
});
