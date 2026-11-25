import type {Entity} from "../../engine/core";
import {PROJECT_MANIFEST_FILE} from "../../engine/project/projectManifest";
import {NO_SCENE_ID} from "../../engine/scene/sceneInstance";
import {parseSceneDocument, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION, sceneDocumentText} from "../../engine/scene/sceneDocument";
import type {EditorSceneRef, ListEntitiesResult} from "../editorProtocol";
import type {ProjectFileSystem} from "../project/projectFileSystem";
import {askForChoice, askForSavePath} from "./dialogs";
import {readStorage, writeStorage} from "./dom";
import {sceneLoadStatus, sceneSaveStatus} from "./editorToolbar";
import type {EditorWorkspace} from "./editorWorkspace";
import {documentRootCount} from "./prefabInstancePaths";
import {
    allProjectPaths,
    fileNameProblem,
    isAncestorFolder,
    joinProjectPath,
    normalizeProjectPath,
    parentFolderOf,
    PREFAB_EXTENSION,
    projectFileKind,
    projectFolderPaths,
    ROOT_FOLDER_PATH,
    SCENE_EXTENSION,
    SCENES_FOLDER,
    stemOf,
} from "./projectFiles";
import {manifestStartScene, manifestWithStartScene} from "./projectManifestEdits";
import {RECENT_SCENES_STORAGE_KEY, recentScenesOf, recentScenesProjectKey, withoutRecentScene, withoutRecentScenes, withRecentScene} from "./recentScenes";
import {NO_WORLD_SCENES} from "./sceneHierarchy";
import type {WorldScenes} from "./sceneHierarchy";
import {renamedUnder, sceneEntryName, sceneRefOf, SceneTabs} from "./sceneTabs";
import type {SceneEntry, SceneTab} from "./sceneTabs";
import type {EntityRefs, UndoStack} from "./undoStack";

export interface TabHistory {
    readonly undo: UndoStack;
    readonly refs: EntityRefs;
}

export type EditorSceneTab = SceneTab<TabHistory>;

type SaveChoice = "save" | "discard";

export const LAST_LOADED_SCENE_REASON = "A tab keeps at least one loaded scene; open another scene first";
export const PREFAB_TAB_SCENES_REASON = "A prefab tab holds only its prefab";

const PREFABS_FOLDER = "prefabs";
const DEFAULT_SCENE_STEM = "New Scene";
const EMPTY_SCENE_TEXT = sceneDocumentText({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: []});
const SAVE_CHOICES = [{label: "Save", value: "save" as const, primary: true}, {label: "Don't save", value: "discard" as const}];

function entityRemap(before: readonly Entity[], after: readonly Entity[]): Map<Entity, Entity> {
    const remap = new Map<Entity, Entity>();
    const count = Math.min(before.length, after.length);
    for (let index = 0; index < count; index++) remap.set(before[index], after[index]);
    return remap;
}

export class SceneDocuments {
    public readonly tabs: SceneTabs<TabHistory>;
    public worldScenes: WorldScenes = NO_WORLD_SCENES;
    private start: string | null;

    public constructor(private readonly workspace: EditorWorkspace, startScene: string | null, createHistory: () => TabHistory) {
        this.tabs = new SceneTabs(createHistory);
        this.start = startScene === null ? null : normalizeProjectPath(startScene);
    }

    public get activeTab(): EditorSceneTab {
        return this.tabs.active;
    }

    public get startScene(): string | null {
        return this.start;
    }

    public get dirty(): boolean {
        return this.tabs.dirty;
    }

    public activeEntry(): SceneEntry | undefined {
        const tab = this.tabs.active;
        return tab.entryOfScene(this.worldScenes.activeSceneId) ?? tab.loadedScenes()[0] ?? tab.main;
    }

    public sceneRefFor(sceneId: number): EditorSceneRef {
        const path = this.tabs.active.entryOfScene(sceneId)?.path ?? this.worldScenes.scenes.find(scene => scene.id === sceneId)?.path ?? null;
        return {id: sceneId, path};
    }

    public acceptListing(result: ListEntitiesResult): void {
        this.worldScenes = {scenes: result.scenes, activeSceneId: result.activeSceneId};
        if (this.tabs.active.markEdited(result.editedSceneIds)) this.changed();
    }

    public recentScenes(): string[] {
        return recentScenesOf(readStorage(this.window(), RECENT_SCENES_STORAGE_KEY), this.projectKey());
    }

    public clearRecentScenes(): void {
        writeStorage(this.window(), RECENT_SCENES_STORAGE_KEY, withoutRecentScenes(readStorage(this.window(), RECENT_SCENES_STORAGE_KEY), this.projectKey()));
    }

    public async openStartScene(): Promise<void> {
        if (this.start !== null) await this.openScene(this.start);
        const tab = this.tabs.active;
        const main = tab.main;
        if (main === undefined || main.sceneId !== null) return;
        await this.workspace.run(async () => {
            const result = await this.workspace.request({op: "setActiveScene", scene: sceneRefOf(main)});
            tab.bindScene(main, result.sceneId);
            await this.refreshWorldScenes();
            this.changed();
        });
    }

    public async open(path: string): Promise<void> {
        if (projectFileKind(path) === "prefab") await this.openPrefab(path);
        else await this.openScene(path);
    }

    public async openRecent(path: string): Promise<void> {
        const normalized = normalizeProjectPath(path);
        const exists = await this.workspace.run(async () => allProjectPaths(await this.files().list()).has(normalized));
        if (exists === false) {
            writeStorage(this.window(), RECENT_SCENES_STORAGE_KEY, withoutRecentScene(readStorage(this.window(), RECENT_SCENES_STORAGE_KEY), this.projectKey(), normalized));
            this.workspace.notice("warn", `${normalized} no longer exists, so it was taken off the recent scenes`);
            return;
        }
        if (exists === true) await this.openScene(normalized);
    }

    public async openScene(path: string): Promise<void> {
        await this.openDocument(normalizeProjectPath(path), "scene");
    }

    public async openPrefab(path: string): Promise<void> {
        await this.openDocument(normalizeProjectPath(path), "prefab");
    }

    public async newScene(): Promise<void> {
        if (!this.requireEditing("make a new scene")) return;
        const opened = await this.workspace.run(async () => {
            await this.replaceOrAddTab("scene", async tab => {
                const loaded = await this.workspace.request({op: "loadScene", sceneText: EMPTY_SCENE_TEXT});
                this.showOnly(tab, this.tabs.entry(null, null), loaded.sceneId);
            });
            return true;
        });
        if (opened !== true) return;
        this.worldReplaced();
        this.workspace.notice("info", "New scene");
    }

    public async activate(tab: EditorSceneTab): Promise<boolean> {
        if (tab === this.tabs.active) return true;
        if (!this.tabs.tabs.includes(tab) || !this.requireEditing("switch scene tabs")) return false;
        const switched = await this.workspace.run(async () => {
            const current = this.tabs.active;
            if (tab === current || !this.tabs.tabs.includes(tab)) return false;
            await this.stashActive();
            try {
                await this.restore(tab);
            } catch (error) {
                current.stash = undefined;
                throw error;
            }
            this.tabs.activate(tab);
            return true;
        });
        if (switched === true) this.worldReplaced();
        return this.tabs.active === tab;
    }

    public async closeTab(tab: EditorSceneTab): Promise<void> {
        if (this.tabs.tabs.length === 1 || !this.tabs.tabs.includes(tab)) return;
        if (tab.dirty) {
            if (!(await this.activate(tab))) return;
            const choice = await this.askToSave(`${tab.name} has unsaved changes.`);
            if (choice === undefined || (choice === "save" && !(await this.saveTab(tab, false)))) return;
        }
        if (tab !== this.tabs.active) {
            this.tabs.remove(tab);
            this.changed();
            return;
        }
        const next = this.tabs.successorOf(tab);
        if (next === undefined || !this.requireEditing("close a scene tab")) return;
        const closed = await this.workspace.run(async () => {
            if (this.tabs.active !== tab || !this.tabs.tabs.includes(next)) return false;
            await this.restore(next);
            this.tabs.remove(tab);
            this.tabs.activate(next);
            return true;
        });
        if (closed === true) this.worldReplaced();
    }

    public async save(): Promise<boolean> {
        return this.saveTab(this.tabs.active, true);
    }

    public async saveAs(): Promise<boolean> {
        const entry = this.activeEntry();
        return entry !== undefined && this.saveEntryAs(entry);
    }

    public async saveAll(): Promise<boolean> {
        if (!this.requireEditing("save")) return false;
        const start = this.tabs.active;
        for (const tab of [...this.tabs.tabs]) {
            if (!tab.dirty) continue;
            if (!(await this.activate(tab)) || !(await this.saveTab(tab, false))) return false;
        }
        if (this.tabs.tabs.includes(start)) await this.activate(start);
        return true;
    }

    public async saveEntry(entry: SceneEntry): Promise<boolean> {
        if (!this.requireEditing("save a scene")) return false;
        const path = entry.path ?? await this.askSavePath(entry);
        return path !== undefined && this.writeEntry(entry, path);
    }

    public async saveEntryAs(entry: SceneEntry): Promise<boolean> {
        if (!this.requireEditing("save a scene")) return false;
        const path = await this.askSavePath(entry);
        return path !== undefined && this.writeEntry(entry, path);
    }

    public async setActiveScene(entry: SceneEntry): Promise<void> {
        const tab = this.tabs.active;
        if (!entry.loaded || !tab.scenes.includes(entry) || !this.requireEditing("change the active scene")) return;
        await this.workspace.run(async () => {
            const result = await this.workspace.request({op: "setActiveScene", scene: sceneRefOf(entry)});
            tab.bindScene(entry, result.sceneId);
            this.worldScenes = {...this.worldScenes, activeSceneId: result.sceneId};
            this.changed();
        });
    }

    public async unloadScene(entry: SceneEntry, removed: boolean): Promise<void> {
        const tab = this.tabs.active;
        if (!tab.scenes.includes(entry) || !this.requireEditing(removed ? "remove a scene" : "unload a scene")) return;
        const others = tab.loadedScenes().filter(other => other !== entry);
        if (entry.loaded && others.length === 0) {
            this.workspace.notice("warn", LAST_LOADED_SCENE_REASON);
            return;
        }
        if (entry.loaded && entry.dirty) {
            const choice = await this.askToSave(`${sceneEntryName(entry)} has unsaved changes.`);
            if (choice === undefined || (choice === "save" && !(await this.saveEntry(entry)))) return;
        }
        await this.workspace.run(async () => {
            if (entry.loaded && entry.sceneId !== null) {
                const unloaded = await this.workspace.request({op: "unloadScene", sceneId: entry.sceneId});
                const keepsActive = unloaded.activeSceneId !== NO_SCENE_ID && unloaded.activeSceneId !== entry.sceneId && tab.entryOfScene(unloaded.activeSceneId) !== undefined;
                if (!keepsActive) {
                    const next = others[0];
                    const activated = await this.workspace.request({op: "setActiveScene", scene: sceneRefOf(next)});
                    tab.bindScene(next, activated.sceneId);
                }
            }
            entry.sceneId = null;
            entry.loaded = false;
            entry.dirty = false;
            if (removed || entry.path === null) tab.removeEntry(entry);
            this.changed();
        });
    }

    public async loadScene(entry: SceneEntry): Promise<void> {
        const path = entry.path;
        if (path === null || entry.loaded) return;
        await this.addScene(path, entry);
    }

    public async openSceneAdditive(path: string): Promise<void> {
        const normalized = normalizeProjectPath(path);
        const tab = this.tabs.active;
        const existing = tab.entryWithPath(normalized);
        if (existing?.loaded === true) {
            this.workspace.notice("info", `${normalized} is already open`);
            return;
        }
        const holding = this.tabs.tabHolding(normalized);
        if (holding !== undefined) {
            this.workspace.notice("warn", `${normalized} is open in the ${holding.name} tab; close it there first`);
            return;
        }
        await this.addScene(normalized, existing);
    }

    public async setStartScene(path: string): Promise<void> {
        const normalized = normalizeProjectPath(path);
        await this.workspace.run(async () => {
            await this.writeStartScene(normalized);
            this.workspace.notice("info", `${normalized} is now the start scene`);
        });
    }

    public async manifestChanged(): Promise<void> {
        try {
            const text = await this.files().readText(PROJECT_MANIFEST_FILE);
            const start = manifestStartScene(text);
            if (start === this.start) return;
            this.start = start;
            this.changed();
        } catch (error) {
            this.workspace.reportError(error);
        }
    }

    public pathRenamed(from: string, to: string): void {
        const renamedStart = this.start === null ? undefined : renamedUnder(this.start, from, to);
        if (this.tabs.renamePaths(from, to)) this.changed();
        if (renamedStart !== undefined) void this.workspace.run(() => this.writeStartScene(renamedStart));
    }

    public pathDeleted(path: string): void {
        const forgotten = this.tabs.forgetDeletedPaths(path);
        if (forgotten.length > 0) {
            this.workspace.notice("warn", `${forgotten.join(", ")} ${forgotten.length === 1 ? "was" : "were"} deleted; open scenes from ${forgotten.length === 1 ? "it are" : "them are"} now ${sceneEntryName({path: null})}, save them to keep their entities`);
            this.changed();
        }
        if (this.start !== null && isAncestorFolder(path, this.start)) this.workspace.notice("warn", `The start scene ${this.start} was deleted; set another start scene`);
    }

    public prefabChanged(path: string): void {
        this.tabs.queuePrefabUpdate(path);
    }

    private async openDocument(path: string, kind: "scene" | "prefab"): Promise<void> {
        const holding = this.tabs.tabHolding(path);
        if (holding !== undefined) {
            await this.activate(holding);
            return;
        }
        if (!this.requireEditing(kind === "prefab" ? "open a prefab" : "open a scene")) return;
        const opened = await this.workspace.run(async () => {
            if (this.tabs.tabHolding(path) !== undefined) return false;
            const sceneText = await this.files().readText(path);
            await this.replaceOrAddTab(kind, async tab => {
                const loaded = await this.workspace.request({op: "loadScene", sceneText, path});
                this.showOnly(tab, this.tabs.entry(path, null), loaded.sceneId);
                this.workspace.notice("info", `${sceneLoadStatus(loaded)} from ${path}`);
            });
            if (kind === "scene") this.rememberRecent(path);
            return true;
        });
        if (opened === true) this.worldReplaced();
        const raced = opened === false ? this.tabs.tabHolding(path) : undefined;
        if (raced !== undefined) await this.activate(raced);
    }

    private async replaceOrAddTab(kind: "scene" | "prefab", load: (tab: EditorSceneTab) => Promise<void>): Promise<void> {
        const current = this.tabs.active;
        if (kind === "scene" && current.replaceable) {
            await load(current);
            current.history.undo.clear();
            return;
        }
        await this.stashActive();
        const tab = this.tabs.add(kind, kind === "prefab" ? current.key : undefined);
        try {
            await load(tab);
        } catch (error) {
            this.tabs.remove(tab);
            current.stash = undefined;
            throw error;
        }
        this.tabs.activate(tab);
    }

    private showOnly(tab: EditorSceneTab, entry: SceneEntry, sceneId: number): void {
        tab.scenes.splice(0, tab.scenes.length, entry);
        tab.bindScene(entry, sceneId);
        tab.pendingPrefabPaths.clear();
        this.worldScenes = {scenes: [sceneRefOf(entry)], activeSceneId: sceneId};
    }

    private async refreshWorldScenes(): Promise<void> {
        const listed = await this.workspace.request({op: "listEntities"});
        this.worldScenes = {scenes: listed.scenes, activeSceneId: listed.activeSceneId};
    }

    private async addScene(path: string, existing: SceneEntry | undefined): Promise<void> {
        const tab = this.tabs.active;
        if (tab.kind === "prefab") {
            this.workspace.notice("warn", PREFAB_TAB_SCENES_REASON);
            return;
        }
        if (!this.requireEditing("add a scene")) return;
        await this.workspace.run(async () => {
            const sceneText = await this.files().readText(path);
            await this.keepActiveSceneBound(tab);
            const loaded = await this.workspace.request({op: "loadScene", sceneText, path, additive: true});
            const entry = existing ?? this.tabs.entry(path, null);
            if (!tab.scenes.includes(entry)) tab.scenes.push(entry);
            tab.bindScene(entry, loaded.sceneId);
            entry.loaded = true;
            entry.dirty = false;
            this.rememberRecent(path);
            this.workspace.notice("info", `${sceneLoadStatus(loaded)} from ${path}`);
            this.changed();
        });
    }

    private async keepActiveSceneBound(tab: EditorSceneTab): Promise<void> {
        await this.refreshWorldScenes();
        const activeId = this.worldScenes.activeSceneId;
        if (activeId !== NO_SCENE_ID && tab.entryOfScene(activeId) !== undefined) return;
        const first = tab.loadedScenes()[0];
        if (first === undefined) return;
        const result = await this.workspace.request({op: "setActiveScene", scene: sceneRefOf(first)});
        tab.bindScene(first, result.sceneId);
        this.worldScenes = {...this.worldScenes, activeSceneId: result.sceneId};
    }

    private async stashActive(): Promise<void> {
        const exported = await this.workspace.request({op: "exportSnapshot"});
        this.tabs.active.stash = {documentText: exported.documentText, entities: exported.entities};
    }

    private async restore(tab: EditorSceneTab): Promise<void> {
        const stash = tab.stash;
        if (stash === undefined) throw new Error(`The ${tab.name} tab has nothing to restore`);
        const imported = await this.workspace.request({op: "importSnapshot", documentText: stash.documentText, mode: "edit"});
        tab.history.refs.remap(entityRemap(stash.entities, imported.entities));
        tab.stash = undefined;
        await this.refreshWorldScenes();
        for (const path of [...tab.pendingPrefabPaths]) {
            tab.pendingPrefabPaths.delete(path);
            try {
                const documentText = await this.files().readText(path);
                await this.workspace.request({op: "updatePrefabInstances", sourcePath: path, documentText});
            } catch (error) {
                this.workspace.reportError(error);
            }
        }
    }

    private async saveTab(tab: EditorSceneTab, includeActive: boolean): Promise<boolean> {
        if (tab !== this.tabs.active || !this.requireEditing("save a scene")) return false;
        const active = this.activeEntry();
        const targets = tab.loadedScenes().filter(entry => entry.dirty || (includeActive && (entry === active || entry.path === null)));
        for (const entry of targets) if (!(await this.saveEntry(entry))) return false;
        return true;
    }

    private async writeEntry(entry: SceneEntry, path: string): Promise<boolean> {
        const tab = this.tabs.active;
        if (!tab.scenes.includes(entry)) return false;
        const saved = await this.workspace.run(async () => {
            const result = await this.workspace.request({op: "saveScene", scene: {id: entry.sceneId ?? NO_SCENE_ID, path}});
            const prefab = tab.kind === "prefab";
            if (prefab && documentRootCount(parseSceneDocument(result.sceneText)) !== 1) {
                throw new Error(`${path} is a prefab, which must have exactly one root entity; parent the others under one root before saving`);
            }
            await this.files().write(path, result.sceneText);
            tab.bindScene(entry, result.sceneId);
            entry.path = path;
            entry.dirty = false;
            if (prefab) this.tabs.queuePrefabUpdate(path);
            else this.rememberRecent(path);
            this.workspace.notice("info", sceneSaveStatus(result.report, path));
            this.changed();
            return true;
        });
        return saved === true;
    }

    private async askSavePath(entry: SceneEntry): Promise<string | undefined> {
        const files = this.files();
        const prefab = this.tabs.active.kind === "prefab";
        const extension = prefab ? PREFAB_EXTENSION : SCENE_EXTENSION;
        const listed = await files.list();
        const existing = allProjectPaths(listed);
        const folder = entry.path === null ? (prefab ? PREFABS_FOLDER : SCENES_FOLDER) : parentFolderOf(entry.path);
        const pathOf = (chosenFolder: string, name: string) => joinProjectPath(chosenFolder, `${name.trim()}${extension}`);
        const chosen = await askForSavePath(this.workspace.dialogDocument(), {
            title: prefab ? "Save prefab as" : "Save scene as",
            folders: projectFolderPaths(listed, [folder]),
            folder,
            name: entry.path === null ? DEFAULT_SCENE_STEM : stemOf(entry.path),
            extension,
            rootLabel: files.rootLabel,
            confirmText: "Save",
            validate: (chosenFolder, name) => fileNameProblem(name) ?? this.openElsewhereProblem(pathOf(chosenFolder, name), entry),
        });
        if (chosen === undefined) return undefined;
        const path = pathOf(chosen.folder, chosen.name);
        if (existing.has(path) && path !== entry.path) {
            const replace = await askForChoice(this.workspace.dialogDocument(), {
                title: "Replace file",
                message: `${path} already exists. Replace it?`,
                choices: [{label: "Replace", value: true, primary: true}],
            });
            if (replace !== true) return undefined;
        }
        if (chosen.folder !== ROOT_FOLDER_PATH && !existing.has(chosen.folder)) {
            try {
                await files.makeDirectory(chosen.folder);
            } catch (error) {
                this.workspace.reportError(error);
            }
        }
        return path;
    }

    private openElsewhereProblem(path: string, entry: SceneEntry): string | undefined {
        for (const tab of this.tabs.tabs) {
            const holder = tab.entryWithPath(path);
            if (holder !== undefined && holder !== entry) return `${path} is open in the ${tab.name} tab; close it there first`;
        }
        return undefined;
    }

    private async writeStartScene(path: string): Promise<void> {
        const files = this.files();
        const edit = manifestWithStartScene(await files.readText(PROJECT_MANIFEST_FILE), path);
        if (!edit.ok) throw new Error(`${PROJECT_MANIFEST_FILE}: ${edit.problems.join("; ")}`);
        await files.write(PROJECT_MANIFEST_FILE, edit.text);
        this.start = normalizeProjectPath(path);
        this.changed();
    }

    private askToSave(message: string): Promise<SaveChoice | undefined> {
        return askForChoice<SaveChoice>(this.workspace.dialogDocument(), {title: "Unsaved changes", message, choices: SAVE_CHOICES});
    }

    private requireEditing(action: string): boolean {
        if (this.workspace.closed) return false;
        if (this.workspace.mode === "edit") return true;
        this.workspace.notice("warn", `Stop the game to ${action}`);
        return false;
    }

    private rememberRecent(path: string): void {
        writeStorage(this.window(), RECENT_SCENES_STORAGE_KEY, withRecentScene(readStorage(this.window(), RECENT_SCENES_STORAGE_KEY), this.projectKey(), path));
    }

    private worldReplaced(): void {
        this.workspace.worldReplaced();
        this.changed();
    }

    private changed(): void {
        this.workspace.emit("document");
    }

    private files(): ProjectFileSystem {
        return this.workspace.session.files;
    }

    private window(): Window | null {
        return this.workspace.document.defaultView;
    }

    public projectKey(): string {
        return recentScenesProjectKey(this.workspace.session.project.name, this.files().rootLabel);
    }
}
