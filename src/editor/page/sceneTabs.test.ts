import {describe, expect, test} from "../../engine/testing/harness";
import {NO_SCENE_ID} from "../../engine/scene/sceneInstance";
import {renamedUnder, sceneEntryName, sceneRefOf, SceneTabs, TAB_DIRTY_MARKER, UNTITLED_SCENE_NAME} from "./sceneTabs";

const MAIN = "scenes/main.scene.json";
const LEVEL = "scenes/level.scene.json";
const ENEMY = "prefabs/enemy.prefab.json";
const MAIN_ID = 1;
const LEVEL_ID = 2;
const ENEMY_ID = 3;

interface History {
    readonly index: number;
}

function tabsWithHistory(): SceneTabs<History> {
    let created = 0;
    return new SceneTabs<History>(() => ({index: created++}));
}

describe("scene tabs", () => {
    test("start with one clean untitled scene tab that a scene may replace", () => {
        const tabs = tabsWithHistory();
        expect(tabs.tabs.length).toBe(1);
        const first = tabs.active;
        expect([first.kind, first.name, first.label, first.dirty, first.replaceable]).toEqual(["scene", UNTITLED_SCENE_NAME, UNTITLED_SCENE_NAME, false, true]);
        expect(first.main?.loaded).toBe(true);
        expect(first.history.index).toBe(0);
        first.main!.dirty = true;
        expect([first.label, first.replaceable]).toEqual([UNTITLED_SCENE_NAME + TAB_DIRTY_MARKER, false]);
    });

    test("each tab has its own history, and a prefab tab opens right after the tab it came from", () => {
        const tabs = tabsWithHistory();
        const main = tabs.active;
        const other = tabs.add("scene", undefined);
        const prefab = tabs.add("prefab", main.key);
        expect(tabs.tabs.map(tab => tab.key)).toEqual([main.key, prefab.key, other.key]);
        expect(new Set(tabs.tabs.map(tab => tab.history.index)).size).toBe(3);
        expect(tabs.breadcrumb(prefab).map(tab => tab.key)).toEqual([main.key, prefab.key]);
        const nested = tabs.add("prefab", prefab.key);
        expect(tabs.breadcrumb(nested).map(tab => tab.key)).toEqual([main.key, prefab.key, nested.key]);
    });

    test("closing the active prefab tab returns to its origin, other tabs fall back to a neighbour, and the last tab stays", () => {
        const tabs = tabsWithHistory();
        const main = tabs.active;
        const other = tabs.add("scene", undefined);
        const prefab = tabs.add("prefab", main.key);
        tabs.activate(prefab);
        expect(tabs.successorOf(prefab)).toBe(main);
        tabs.remove(prefab);
        expect(tabs.active).toBe(main);
        tabs.activate(other);
        tabs.remove(other);
        expect(tabs.active).toBe(main);
        tabs.remove(main);
        expect(tabs.tabs).toEqual([main]);
    });

    test("an orphaned prefab breadcrumb stops at the prefab once its origin closed", () => {
        const tabs = tabsWithHistory();
        const main = tabs.active;
        const spare = tabs.add("scene", undefined);
        const prefab = tabs.add("prefab", main.key);
        tabs.activate(spare);
        tabs.remove(main);
        expect(tabs.breadcrumb(prefab)).toEqual([prefab]);
        expect(tabs.successorOf(prefab)).toBe(spare);
    });

    test("binding a scene id takes it away from any other entry that held it", () => {
        const tabs = tabsWithHistory();
        const tab = tabs.active;
        const main = tab.main!;
        const stale = tabs.entry(LEVEL, LEVEL_ID);
        tab.scenes.push(stale);
        tab.bindScene(main, LEVEL_ID);
        expect([main.sceneId, stale.sceneId]).toEqual([LEVEL_ID, null]);
        tab.bindScene(main, NO_SCENE_ID);
        expect(main.sceneId).toBe(null);
    });

    test("edited scene ids mark only their loaded entries dirty and report whether anything changed", () => {
        const tabs = tabsWithHistory();
        const tab = tabs.active;
        tab.scenes.splice(0, tab.scenes.length, tabs.entry(MAIN, MAIN_ID), tabs.entry(LEVEL, LEVEL_ID));
        const [main, level] = tab.scenes;
        expect(tab.markEdited([LEVEL_ID])).toBe(true);
        expect([main.dirty, level.dirty, tab.dirty]).toEqual([false, true, true]);
        expect(tab.markEdited([LEVEL_ID])).toBe(false);
        level.loaded = false;
        level.dirty = false;
        expect(tab.markEdited([LEVEL_ID])).toBe(false);
        expect(tab.markEdited([ENEMY_ID])).toBe(false);
        expect(tabs.dirty).toBe(false);
    });

    test("the no-scene id marks the loaded entry the world has no id for", () => {
        const tabs = tabsWithHistory();
        const tab = tabs.active;
        expect(tab.markEdited([NO_SCENE_ID])).toBe(true);
        expect(tab.main?.dirty).toBe(true);
    });

    test("a tab holding a path is found only while the scene is loaded", () => {
        const tabs = tabsWithHistory();
        const other = tabs.add("scene", undefined);
        const level = tabs.entry(`./${LEVEL}`, LEVEL_ID);
        other.scenes.push(level);
        expect(level.path).toBe(LEVEL);
        expect(tabs.tabHolding(LEVEL)).toBe(other);
        level.loaded = false;
        expect(tabs.tabHolding(LEVEL)).toBeUndefined();
    });

    test("dirtiness of any tab counts, stashed or active", () => {
        const tabs = tabsWithHistory();
        const other = tabs.add("scene", undefined);
        other.scenes.push(tabs.entry(LEVEL, LEVEL_ID));
        other.scenes[0].dirty = true;
        expect(tabs.active === other).toBe(false);
        expect(tabs.dirty).toBe(true);
    });

    test("renaming a folder renames the open scenes under it in every tab", () => {
        const tabs = tabsWithHistory();
        const tab = tabs.active;
        tab.scenes.splice(0, tab.scenes.length, tabs.entry(MAIN, MAIN_ID));
        const other = tabs.add("prefab", tab.key);
        other.scenes.push(tabs.entry(ENEMY, ENEMY_ID));
        expect(tabs.renamePaths("scenes", "levels")).toBe(true);
        expect([tab.main?.path, other.main?.path]).toEqual(["levels/main.scene.json", ENEMY]);
        expect(tabs.renamePaths("missing", "elsewhere")).toBe(false);
        expect(renamedUnder("scenes2/a.scene.json", "scenes", "x")).toBeUndefined();
    });

    test("deleting a file makes its loaded scene an unsaved untitled one and drops unloaded entries", () => {
        const tabs = tabsWithHistory();
        const tab = tabs.active;
        tab.scenes.splice(0, tab.scenes.length, tabs.entry(MAIN, MAIN_ID), tabs.entry(LEVEL, null, false));
        expect(tabs.forgetDeletedPaths("scenes")).toEqual([MAIN, LEVEL]);
        expect(tab.scenes.length).toBe(1);
        expect([tab.main?.path, tab.main?.dirty, tab.name]).toEqual([null, true, UNTITLED_SCENE_NAME]);
    });

    test("a saved prefab queues an instance update for every tab but the active one", () => {
        const tabs = tabsWithHistory();
        const main = tabs.active;
        const other = tabs.add("scene", undefined);
        tabs.queuePrefabUpdate(`./${ENEMY}`);
        expect([...main.pendingPrefabPaths]).toEqual([]);
        expect([...other.pendingPrefabPaths]).toEqual([ENEMY]);
    });

    test("scene names and references", () => {
        const tabs = tabsWithHistory();
        const untitled = tabs.entry(null, null);
        const main = tabs.entry(MAIN, MAIN_ID);
        expect([sceneEntryName(untitled), sceneEntryName(main)]).toEqual([UNTITLED_SCENE_NAME, "main"]);
        expect([sceneRefOf(untitled), sceneRefOf(main)]).toEqual([{id: NO_SCENE_ID, path: null}, {id: MAIN_ID, path: MAIN}]);
    });
});
