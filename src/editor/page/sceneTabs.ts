import type {Entity} from "../../engine/core";
import {NO_SCENE_ID} from "../../engine/scene/sceneInstance";
import type {EditorSceneRef} from "../editorProtocol";
import {isAncestorFolder, normalizeProjectPath, stemOf} from "./projectFiles";

export type SceneTabKind = "scene" | "prefab";

export interface SceneEntry {
    readonly key: number;
    sceneId: number | null;
    path: string | null;
    loaded: boolean;
    dirty: boolean;
}

export interface TabStash {
    readonly documentText: string;
    readonly entities: readonly Entity[];
}

export const UNTITLED_SCENE_NAME = "Untitled";
export const TAB_DIRTY_MARKER = " *";

const FIRST_KEY = 1;
const NOT_FOUND = -1;

export function sceneEntryName(entry: Pick<SceneEntry, "path">): string {
    return entry.path === null ? UNTITLED_SCENE_NAME : stemOf(entry.path);
}

export function sceneRefOf(entry: SceneEntry): EditorSceneRef {
    return {id: entry.sceneId ?? NO_SCENE_ID, path: entry.path};
}

export function renamedUnder(path: string, from: string, to: string): string | undefined {
    const normalized = normalizeProjectPath(path);
    const folder = normalizeProjectPath(from);
    if (!isAncestorFolder(folder, normalized)) return undefined;
    return normalizeProjectPath(to) + normalized.slice(folder.length);
}

export class SceneTab<H> {
    public readonly scenes: SceneEntry[] = [];
    public readonly pendingPrefabPaths = new Set<string>();
    public stash: TabStash | undefined;

    public constructor(public readonly key: number, public readonly kind: SceneTabKind, public readonly history: H, public readonly originKey: number | undefined) {
    }

    public get main(): SceneEntry | undefined {
        return this.scenes[0];
    }

    public get name(): string {
        const main = this.main;
        return main === undefined ? UNTITLED_SCENE_NAME : sceneEntryName(main);
    }

    public get dirty(): boolean {
        return this.scenes.some(entry => entry.dirty);
    }

    public get label(): string {
        return this.dirty ? this.name + TAB_DIRTY_MARKER : this.name;
    }

    public get replaceable(): boolean {
        const main = this.main;
        return this.kind === "scene" && this.scenes.length === 1 && main !== undefined && main.path === null && !main.dirty;
    }

    public loadedScenes(): SceneEntry[] {
        return this.scenes.filter(entry => entry.loaded);
    }

    public entryWithPath(path: string): SceneEntry | undefined {
        const normalized = normalizeProjectPath(path);
        return this.scenes.find(entry => entry.path !== null && normalizeProjectPath(entry.path) === normalized);
    }

    public entryOfScene(sceneId: number): SceneEntry | undefined {
        if (sceneId === NO_SCENE_ID) return this.scenes.find(entry => entry.loaded && entry.sceneId === null);
        return this.scenes.find(entry => entry.loaded && entry.sceneId === sceneId);
    }

    public bindScene(entry: SceneEntry, sceneId: number): void {
        for (const other of this.scenes) if (other !== entry && other.sceneId === sceneId) other.sceneId = null;
        entry.sceneId = sceneId === NO_SCENE_ID ? null : sceneId;
    }

    public markEdited(sceneIds: readonly number[]): boolean {
        let changed = false;
        for (const sceneId of sceneIds) {
            const entry = this.entryOfScene(sceneId);
            if (entry === undefined || entry.dirty) continue;
            entry.dirty = true;
            changed = true;
        }
        return changed;
    }

    public removeEntry(entry: SceneEntry): void {
        const index = this.scenes.indexOf(entry);
        if (index !== NOT_FOUND) this.scenes.splice(index, 1);
    }
}

export class SceneTabs<H> {
    private readonly list: SceneTab<H>[] = [];
    private activeKey: number;
    private nextKey = FIRST_KEY;

    public constructor(private readonly createHistory: () => H) {
        const first = this.add("scene", undefined);
        first.scenes.push(this.entry(null, null));
        this.activeKey = first.key;
    }

    public get tabs(): readonly SceneTab<H>[] {
        return this.list;
    }

    public get active(): SceneTab<H> {
        return this.tab(this.activeKey) ?? this.list[0];
    }

    public get dirty(): boolean {
        return this.list.some(tab => tab.dirty);
    }

    public tab(key: number): SceneTab<H> | undefined {
        return this.list.find(tab => tab.key === key);
    }

    public add(kind: SceneTabKind, originKey: number | undefined): SceneTab<H> {
        const tab = new SceneTab(this.nextKey++, kind, this.createHistory(), originKey);
        const origin = originKey === undefined ? NOT_FOUND : this.list.findIndex(candidate => candidate.key === originKey);
        if (origin === NOT_FOUND) this.list.push(tab);
        else this.list.splice(origin + 1, 0, tab);
        return tab;
    }

    public entry(path: string | null, sceneId: number | null, loaded = true): SceneEntry {
        return {key: this.nextKey++, sceneId, path: path === null ? null : normalizeProjectPath(path), loaded, dirty: false};
    }

    public activate(tab: SceneTab<H>): void {
        if (this.list.includes(tab)) this.activeKey = tab.key;
    }

    public successorOf(tab: SceneTab<H>): SceneTab<H> | undefined {
        const origin = tab.originKey === undefined ? undefined : this.tab(tab.originKey);
        if (origin !== undefined) return origin;
        const index = this.list.indexOf(tab);
        return this.list[index + 1] ?? this.list[index - 1];
    }

    public remove(tab: SceneTab<H>): void {
        const index = this.list.indexOf(tab);
        if (index === NOT_FOUND || this.list.length === 1) return;
        const successor = tab.key === this.activeKey ? this.successorOf(tab) : undefined;
        this.list.splice(index, 1);
        if (successor !== undefined) this.activeKey = successor.key;
    }

    public tabHolding(path: string): SceneTab<H> | undefined {
        return this.list.find(tab => tab.entryWithPath(path)?.loaded === true);
    }

    public breadcrumb(tab: SceneTab<H>): SceneTab<H>[] {
        const chain: SceneTab<H>[] = [tab];
        const seen = new Set<number>([tab.key]);
        for (let origin = tab.originKey === undefined ? undefined : this.tab(tab.originKey); origin !== undefined && !seen.has(origin.key);
            origin = origin.originKey === undefined ? undefined : this.tab(origin.originKey)) {
            seen.add(origin.key);
            chain.unshift(origin);
        }
        return chain;
    }

    public renamePaths(from: string, to: string): boolean {
        let changed = false;
        for (const tab of this.list) {
            for (const entry of tab.scenes) {
                const renamed = entry.path === null ? undefined : renamedUnder(entry.path, from, to);
                if (renamed === undefined) continue;
                entry.path = renamed;
                changed = true;
            }
        }
        return changed;
    }

    public forgetDeletedPaths(deleted: string): string[] {
        const forgotten: string[] = [];
        for (const tab of this.list) {
            for (const entry of [...tab.scenes]) {
                if (entry.path === null || !isAncestorFolder(deleted, entry.path)) continue;
                forgotten.push(entry.path);
                if (!entry.loaded) {
                    tab.removeEntry(entry);
                    continue;
                }
                entry.path = null;
                entry.dirty = true;
            }
        }
        return forgotten;
    }

    public queuePrefabUpdate(path: string): void {
        const normalized = normalizeProjectPath(path);
        for (const tab of this.list) if (tab.key !== this.activeKey) tab.pendingPrefabPaths.add(normalized);
    }
}
