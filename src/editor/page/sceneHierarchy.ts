import type {Entity} from "../../engine/core";
import {NO_SCENE_ID} from "../../engine/scene/sceneInstance";
import type {EditorSceneRef} from "../editorProtocol";
import {entityTreeRows} from "./entityTree";
import type {EntityTreeNode, EntityTreeRow} from "./entityTree";
import {isEmptySearch} from "./hierarchySearch";
import type {HierarchySearch} from "./hierarchySearch";
import {normalizeProjectPath} from "./projectFiles";
import {sceneEntryName} from "./sceneTabs";
import type {SceneEntry} from "./sceneTabs";

export interface WorldScenes {
    readonly scenes: readonly EditorSceneRef[];
    readonly activeSceneId: number;
}

export interface SceneGroup {
    readonly key: string;
    readonly entry: SceneEntry | undefined;
    readonly sceneId: number | null;
    readonly label: string;
    readonly path: string | null;
    readonly active: boolean;
    readonly loaded: boolean;
    readonly dirty: boolean;
    readonly start: boolean;
    readonly roots: readonly EntityTreeNode[];
}

export type HierarchyRow =
    | {readonly kind: "scene", readonly group: SceneGroup, readonly expanded: boolean}
    | {readonly kind: "entity", readonly row: EntityTreeRow};

export interface HierarchyRows {
    readonly rows: readonly HierarchyRow[];
    readonly hiddenCount: number;
}

export const NO_WORLD_SCENES: WorldScenes = {scenes: [], activeSceneId: NO_SCENE_ID};

const NOTHING_COLLAPSED: ReadonlySet<string> = new Set();
const NO_ROOTS: readonly EntityTreeNode[] = [];

function isStartScene(path: string | null, startScene: string | null): boolean {
    return path !== null && startScene !== null && normalizeProjectPath(path) === normalizeProjectPath(startScene);
}

function takeRoots(byScene: Map<number, EntityTreeNode[]>, sceneId: number): readonly EntityTreeNode[] {
    const roots = byScene.get(sceneId);
    byScene.delete(sceneId);
    return roots ?? NO_ROOTS;
}

export function sceneGroupKey(entry: SceneEntry): string {
    return `entry:${entry.key}`;
}

export function sceneGroups(entries: readonly SceneEntry[], world: WorldScenes, roots: readonly EntityTreeNode[], startScene: string | null): SceneGroup[] {
    const byScene = new Map<number, EntityTreeNode[]>();
    for (const root of roots) {
        let group = byScene.get(root.summary.sceneId);
        if (group === undefined) byScene.set(root.summary.sceneId, group = []);
        group.push(root);
    }
    const groups: SceneGroup[] = entries.map(entry => ({
        key: sceneGroupKey(entry),
        entry,
        sceneId: entry.sceneId,
        label: sceneEntryName(entry),
        path: entry.path,
        active: entry.loaded && entry.sceneId !== null && entry.sceneId === world.activeSceneId,
        loaded: entry.loaded,
        dirty: entry.dirty,
        start: isStartScene(entry.path, startScene),
        roots: entry.loaded ? takeRoots(byScene, entry.sceneId ?? NO_SCENE_ID) : NO_ROOTS,
    }));
    for (const [sceneId, sceneRoots] of byScene) {
        const path = world.scenes.find(scene => scene.id === sceneId)?.path ?? null;
        groups.push({
            key: `world:${sceneId}`,
            entry: undefined,
            sceneId,
            label: sceneEntryName({path}),
            path,
            active: sceneId !== NO_SCENE_ID && sceneId === world.activeSceneId,
            loaded: true,
            dirty: false,
            start: isStartScene(path, startScene),
            roots: sceneRoots,
        });
    }
    return groups;
}

export function hierarchyRows(
    groups: readonly SceneGroup[],
    search: HierarchySearch,
    rowLimit: number,
    collapsedEntities: ReadonlySet<Entity>,
    collapsedScenes: ReadonlySet<string> = NOTHING_COLLAPSED,
): HierarchyRows {
    const searching = !isEmptySearch(search);
    const rows: HierarchyRow[] = [];
    let entityRows = 0;
    let hiddenCount = 0;
    for (const group of groups) {
        const expanded = searching || !collapsedScenes.has(group.key);
        rows.push({kind: "scene", group, expanded});
        if (!expanded) continue;
        const shown = entityTreeRows(group.roots, search, Math.max(0, rowLimit - entityRows), collapsedEntities);
        for (const row of shown.rows) rows.push({kind: "entity", row});
        entityRows += shown.rows.length;
        hiddenCount += shown.hiddenCount;
    }
    return {rows, hiddenCount};
}
