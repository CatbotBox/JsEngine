import {describe, expect, test} from "../../engine/testing/harness";
import type {Entity} from "../../engine/core";
import {NO_SCENE_ID} from "../../engine/scene/sceneInstance";
import type {EditorEntitySummary} from "../editorProtocol";
import {buildEntityTree} from "./entityTree";
import {EMPTY_SEARCH, parseHierarchySearch} from "./hierarchySearch";
import {hierarchyRows, NO_WORLD_SCENES, sceneGroupKey, sceneGroups} from "./sceneHierarchy";
import type {HierarchyRow} from "./sceneHierarchy";
import {SceneTabs} from "./sceneTabs";
import type {SceneEntry} from "./sceneTabs";

const MAIN = "scenes/main.scene.json";
const LEVEL = "scenes/level.scene.json";
const EXTRA = "scenes/extra.scene.json";
const MAIN_ID = 1;
const LEVEL_ID = 2;
const UNLIMITED_ROWS = Number.POSITIVE_INFINITY;
const NOTHING_COLLAPSED: ReadonlySet<Entity> = new Set();
const GAME_SCENE_ID = 9;
const WORLD = {scenes: [{id: GAME_SCENE_ID, path: "scenes/game.scene.json"}], activeSceneId: MAIN_ID};

function summary(entity: number, name: string, parent: number | null, sceneId: number, siblingIndex = 0): EditorEntitySummary {
    return {entity: entity as Entity, name, enabled: true, parent: parent as Entity | null, siblingIndex, prefabSourcePath: null, componentTypeNames: [], sceneId};
}

function entries(): SceneEntry[] {
    const tabs = new SceneTabs<undefined>(() => undefined);
    return [tabs.entry(MAIN, MAIN_ID), tabs.entry(LEVEL, LEVEL_ID), tabs.entry(EXTRA, null, false)];
}

const ENTITIES: readonly EditorEntitySummary[] = [
    summary(10, "Camera", null, MAIN_ID, 0),
    summary(11, "Player", 10, MAIN_ID, 0),
    summary(20, "Door", null, LEVEL_ID, 1),
    summary(30, "Spawned", null, GAME_SCENE_ID, 2),
];

function shownRows(rows: readonly HierarchyRow[]): string[] {
    return rows.map(row => row.kind === "scene" ? `[${row.group.label}]` : `${"  ".repeat(row.row.depth)}${row.row.summary.name}`);
}

describe("multi-scene hierarchy", () => {
    test("each tab scene is a group with its roots, in tab order, then scenes the tab does not know", () => {
        const groups = sceneGroups(entries(), {...WORLD, activeSceneId: LEVEL_ID}, buildEntityTree(ENTITIES), MAIN);
        expect(groups.map(group => group.label)).toEqual(["main", "level", "extra", "game"]);
        expect(groups.map(group => group.roots.map(root => root.summary.name))).toEqual([["Camera"], ["Door"], [], ["Spawned"]]);
        expect(groups.map(group => [group.active, group.loaded, group.start])).toEqual([[false, true, true], [true, true, false], [false, false, false], [false, true, false]]);
        expect(groups[3].entry).toBeUndefined();
    });

    test("an entry the world holds no scene for collects the roots of no scene once", () => {
        const tabs = new SceneTabs<undefined>(() => undefined);
        const untitled = tabs.entry(null, null);
        const empty = tabs.entry(LEVEL, null);
        const roots = buildEntityTree([summary(1, "Loose", null, NO_SCENE_ID)]);
        const groups = sceneGroups([untitled, empty], NO_WORLD_SCENES, roots, null);
        expect(groups.map(group => group.roots.length)).toEqual([1, 0]);
        expect(groups.map(group => group.active)).toEqual([false, false]);
    });

    test("dirty entries show as dirty groups", () => {
        const scenes = entries();
        scenes[1].dirty = true;
        const groups = sceneGroups(scenes, NO_WORLD_SCENES, [], null);
        expect(groups.map(group => group.dirty)).toEqual([false, true, false]);
    });

    test("rows put each scene header above its entities, and a collapsed scene hides them", () => {
        const scenes = entries();
        const groups = sceneGroups(scenes, WORLD, buildEntityTree(ENTITIES), null);
        expect(shownRows(hierarchyRows(groups, EMPTY_SEARCH, UNLIMITED_ROWS, NOTHING_COLLAPSED).rows)).toEqual([
            "[main]", "Camera", "  Player", "[level]", "Door", "[extra]", "[game]", "Spawned",
        ]);
        const collapsed = hierarchyRows(groups, EMPTY_SEARCH, UNLIMITED_ROWS, NOTHING_COLLAPSED, new Set([sceneGroupKey(scenes[0])]));
        expect(shownRows(collapsed.rows)).toEqual(["[main]", "[level]", "Door", "[extra]", "[game]", "Spawned"]);
        expect(collapsed.rows[0].kind === "scene" && !collapsed.rows[0].expanded).toBe(true);
    });

    test("a search shows matches inside collapsed scenes and keeps every scene header", () => {
        const scenes = entries();
        const groups = sceneGroups(scenes, WORLD, buildEntityTree(ENTITIES), null);
        const rows = hierarchyRows(groups, parseHierarchySearch("play"), UNLIMITED_ROWS, NOTHING_COLLAPSED, new Set([sceneGroupKey(scenes[0])]));
        expect(shownRows(rows.rows)).toEqual(["[main]", "Camera", "  Player", "[level]", "[extra]", "[game]"]);
    });

    test("the row limit counts entity rows across scenes and reports the rest as hidden", () => {
        const groups = sceneGroups(entries(), WORLD, buildEntityTree(ENTITIES), null);
        const limited = hierarchyRows(groups, EMPTY_SEARCH, 2, NOTHING_COLLAPSED);
        expect(shownRows(limited.rows)).toEqual(["[main]", "Camera", "  Player", "[level]", "[extra]", "[game]"]);
        expect(limited.hiddenCount).toBe(2);
    });
});
