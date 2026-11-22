import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import {NULL_ENTITY} from "../../engine/core";
import {PROJECT_MANIFEST_FILE} from "../../engine/project/projectManifest";
import {parseSceneDocument, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "../../engine/scene";
import type {ProjectEntry, ProjectFileChange, ProjectFileSystem} from "../project/projectFileSystem";
import type {EditorSession} from "../page/editorSession";
import {EditorWorkspace} from "../page/editorWorkspace";
import {UNPARENT_TARGET} from "../page/hierarchyDrop";
import {parentFolderOf} from "../page/projectFiles";
import {HOLDS_NO_ENTITIES} from "../page/undoStack";
import {ask, byName, disposeEditorWorlds, editorWorld} from "./editorServiceTestHarness";
import type {Harnessed} from "./editorServiceTestHarness";

const LEVEL_PATH = "scenes/level.scene.json";
const OTHER_PATH = "scenes/other.scene.json";
const PREFAB_PATH = "prefabs/enemy.prefab.json";
const PROJECT_NAME = "Game";
const EDITED_GUN_XYZ = [4, 0, 0];
const EDITED_DOOR_XYZ = [7, 0, 0];
const THROWING_WORLD_SOURCE = "entityInspection.ts:";

const LEVEL_TEXT = JSON.stringify({
    format: SCENE_DOCUMENT_FORMAT,
    version: SCENE_DOCUMENT_VERSION,
    entities: [
        {id: 1, name: "Level", enabled: true, components: {LocalPosition: {xyz: [0, 0, 0]}}},
        {id: 2, name: "Door", enabled: true, components: {LocalPosition: {xyz: [1, 0, 0]}, Parent: {entity: 1}}},
    ],
}, null, 2);

const OTHER_TEXT = JSON.stringify({
    format: SCENE_DOCUMENT_FORMAT,
    version: SCENE_DOCUMENT_VERSION,
    entities: [{id: 1, name: "Elsewhere", enabled: true, components: {LocalPosition: {xyz: [0, 0, 0]}}}],
}, null, 2);

const PREFAB_TEXT = JSON.stringify({
    format: SCENE_DOCUMENT_FORMAT,
    version: SCENE_DOCUMENT_VERSION,
    entities: [
        {id: 1, name: "Enemy", enabled: true, components: {LocalPosition: {xyz: [0, 0, 0]}}},
        {id: 2, name: "Gun", enabled: true, components: {LocalPosition: {xyz: [1, 0, 0]}, Parent: {entity: 1}}},
    ],
}, null, 2);

function manifestText(startScene: string | null): string {
    return JSON.stringify(startScene === null ? {name: PROJECT_NAME} : {name: PROJECT_NAME, startScene}, null, 2);
}

class MemoryProjectFiles implements ProjectFileSystem {
    public readonly rootLabel = "game";
    public readonly texts = new Map<string, string>();
    private readonly folders = new Set<string>();

    public constructor(files: Readonly<Record<string, string>>) {
        for (const [path, text] of Object.entries(files)) this.texts.set(path, text);
    }

    public list(): Promise<readonly ProjectEntry[]> {
        const folders = new Set(this.folders);
        for (const path of this.texts.keys()) for (let folder = parentFolderOf(path); folder !== ""; folder = parentFolderOf(folder)) folders.add(folder);
        return Promise.resolve([
            ...[...folders].map((path): ProjectEntry => ({path, kind: "directory", size: 0, mtimeMs: 0})),
            ...[...this.texts].map(([path, text]): ProjectEntry => ({path, kind: "file", size: text.length, mtimeMs: 0})),
        ]);
    }

    public async read(path: string): Promise<Uint8Array> {
        return new TextEncoder().encode(await this.readText(path));
    }

    public readText(path: string): Promise<string> {
        const text = this.texts.get(path);
        return text === undefined ? Promise.reject(new Error(`No file ${path}`)) : Promise.resolve(text);
    }

    public write(path: string, contents: Uint8Array | string): Promise<void> {
        this.texts.set(path, typeof contents === "string" ? contents : new TextDecoder().decode(contents));
        return Promise.resolve();
    }

    public remove(path: string): Promise<void> {
        for (const key of [...this.texts.keys()]) if (key === path || key.startsWith(`${path}/`)) this.texts.delete(key);
        return Promise.resolve();
    }

    public rename(from: string, to: string): Promise<void> {
        for (const [key, text] of [...this.texts]) {
            if (key !== from && !key.startsWith(`${from}/`)) continue;
            this.texts.delete(key);
            this.texts.set(to + key.slice(from.length), text);
        }
        return Promise.resolve();
    }

    public makeDirectory(path: string): Promise<void> {
        this.folders.add(path);
        return Promise.resolve();
    }

    public onChange(_listener: (change: ProjectFileChange) => void): () => void {
        return () => undefined;
    }
}

function pageDocument(): Document {
    const stored = new Map<string, string>();
    const localStorage = {getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value)};
    return {defaultView: {localStorage}, addEventListener: () => undefined, removeEventListener: () => undefined} as unknown as Document;
}

interface Page {
    readonly harnessed: Harnessed;
    readonly files: MemoryProjectFiles;
    readonly workspace: EditorWorkspace;
}

const pages: EditorWorkspace[] = [];

afterEach(() => {
    for (const workspace of pages.splice(0)) workspace.stop();
    disposeEditorWorlds();
});

function editorPage(startScene: string | null = LEVEL_PATH): Page {
    const harnessed = editorWorld();
    const files = new MemoryProjectFiles({
        [PROJECT_MANIFEST_FILE]: manifestText(startScene),
        [LEVEL_PATH]: LEVEL_TEXT,
        [OTHER_PATH]: OTHER_TEXT,
        [PREFAB_PATH]: PREFAB_TEXT,
    });
    const session: EditorSession = {
        client: harnessed.client,
        events: {onEvent: () => () => undefined},
        files,
        project: {name: PROJECT_NAME, startScene},
    };
    const workspace = new EditorWorkspace(session, pageDocument());
    pages.push(workspace);
    return {harnessed, files, workspace};
}

async function names(page: Page): Promise<(string | null)[]> {
    return (await ask(page.harnessed, {op: "listEntities"})).entities.map(entity => entity.name);
}

async function listed(page: Page, name: string) {
    return byName((await ask(page.harnessed, {op: "listEntities"})).entities, name);
}

async function fieldOf(page: Page, name: string, typeName: string, key: string): Promise<unknown> {
    const entity = (await listed(page, name))!.entity;
    const details = await ask(page.harnessed, {op: "getEntity", entity});
    return details.components.find(component => component.typeName === typeName)?.fields[key];
}

async function syncListing(page: Page): Promise<void> {
    page.workspace.scenes.acceptListing(await ask(page.harnessed, {op: "listEntities"}));
}

describe("editor scene tabs against the world", () => {
    test("the start scene fills the first tab, binds its world scene and becomes a recent scene", async () => {
        const page = editorPage();
        const scenes = page.workspace.scenes;
        await scenes.openStartScene();
        const tab = scenes.activeTab;
        expect(scenes.tabs.tabs.length).toBe(1);
        expect([tab.main?.path, tab.main?.loaded, tab.main?.dirty]).toEqual([LEVEL_PATH, true, false]);
        expect(tab.main?.sceneId).toBe((await ask(page.harnessed, {op: "listEntities"})).activeSceneId);
        expect(scenes.recentScenes()).toEqual([LEVEL_PATH]);
        expect(await names(page)).toEqual(["Level", "Door"]);
    });

    test("a project without a start scene gets an untitled scene that is active in the world", async () => {
        const page = editorPage(null);
        const scenes = page.workspace.scenes;
        await scenes.openStartScene();
        const main = scenes.activeTab.main!;
        const listing = await ask(page.harnessed, {op: "listEntities"});
        expect([main.path, main.sceneId !== null]).toEqual([null, true]);
        expect(listing.activeSceneId).toBe(main.sceneId!);
    });

    test("opening another scene adds a tab; switching back restores the world, the scene ids and that tab's own undo history", async () => {
        const page = editorPage();
        const {workspace} = page;
        const scenes = workspace.scenes;
        await scenes.openStartScene();
        const first = scenes.activeTab;
        const levelId = first.main!.sceneId;
        await workspace.createEmpty(null);
        expect(workspace.undo.canUndo).toBe(true);

        await scenes.openScene(OTHER_PATH);
        const second = scenes.activeTab;
        expect(second === first).toBe(false);
        expect(scenes.tabs.tabs.length).toBe(2);
        expect(await names(page)).toEqual(["Elsewhere"]);
        expect(workspace.undo.canUndo).toBe(false);

        expect(await scenes.activate(first)).toBe(true);
        expect(await names(page)).toEqual(["Level", "Door", "Entity"]);
        expect(first.main!.sceneId).toBe(levelId);
        expect(workspace.undo.undoLabel).toBe("Create Empty");
        await workspace.undoLast();
        expect(await names(page)).toEqual(["Level", "Door"]);
        expect(second.stash === undefined).toBe(false);

        await scenes.openScene(OTHER_PATH);
        expect(scenes.activeTab).toBe(second);
        expect(scenes.tabs.tabs.length).toBe(2);
    });

    test("edits mark the scene dirty, the mark survives a tab switch, and saving writes the file and clears it", async () => {
        const page = editorPage();
        const scenes = page.workspace.scenes;
        await scenes.openStartScene();
        const first = scenes.activeTab;
        const door = (await listed(page, "Door"))!.entity;
        await page.workspace.setFields([{entity: door, typeName: "LocalPosition", key: "xyz", before: [1, 0, 0], after: EDITED_DOOR_XYZ, entityShape: HOLDS_NO_ENTITIES}], "Move");
        await syncListing(page);
        expect([first.main?.dirty, scenes.dirty, first.label]).toEqual([true, true, "level *"]);

        await scenes.openScene(OTHER_PATH);
        await scenes.activate(first);
        expect(first.main?.dirty).toBe(true);
        expect(await fieldOf(page, "Door", "LocalPosition", "xyz")).toEqual(EDITED_DOOR_XYZ);

        expect(await scenes.save()).toBe(true);
        expect(first.main?.dirty).toBe(false);
        const saved = parseSceneDocument(page.files.texts.get(LEVEL_PATH)!);
        expect(saved.entities.find(record => record.name === "Door")?.components.LocalPosition.xyz).toEqual(EDITED_DOOR_XYZ);
        await syncListing(page);
        expect(scenes.dirty).toBe(false);
    });

    test("a prefab opens in its own tab after the scene it came from, and saving it updates the instances when that scene comes back", async () => {
        const page = editorPage();
        const {workspace} = page;
        const scenes = workspace.scenes;
        await scenes.openStartScene();
        const sceneTab = scenes.activeTab;
        await workspace.instantiateAsset(PREFAB_PATH, {target: UNPARENT_TARGET});
        expect(await fieldOf(page, "Gun", "LocalPosition", "xyz")).toEqual([1, 0, 0]);

        await scenes.openPrefab(PREFAB_PATH);
        const prefabTab = scenes.activeTab;
        expect([prefabTab.kind, prefabTab.originKey]).toEqual(["prefab", sceneTab.key]);
        expect(scenes.tabs.breadcrumb(prefabTab)).toEqual([sceneTab, prefabTab]);
        expect(await names(page)).toEqual(["Enemy", "Gun"]);
        const gun = (await listed(page, "Gun"))!.entity;
        await ask(page.harnessed, {op: "setField", entity: gun, typeName: "LocalPosition", key: "xyz", value: EDITED_GUN_XYZ});
        expect(await scenes.save()).toBe(true);
        expect(parseSceneDocument(page.files.texts.get(PREFAB_PATH)!).entities[1].components.LocalPosition.xyz).toEqual(EDITED_GUN_XYZ);
        expect([...sceneTab.pendingPrefabPaths]).toEqual([PREFAB_PATH]);

        expect(await scenes.activate(sceneTab)).toBe(true);
        expect(await fieldOf(page, "Gun", "LocalPosition", "xyz")).toEqual(EDITED_GUN_XYZ);
        expect(sceneTab.pendingPrefabPaths.size).toBe(0);
        expect(await names(page)).toEqual(["Level", "Door", "Enemy", "Gun"]);
    });

    test("closing the prefab tab goes back to its scene", async () => {
        const page = editorPage();
        const scenes = page.workspace.scenes;
        await scenes.openStartScene();
        const sceneTab = scenes.activeTab;
        await scenes.openPrefab(PREFAB_PATH);
        await scenes.closeTab(scenes.activeTab);
        expect(scenes.tabs.tabs).toEqual([sceneTab]);
        expect(scenes.activeTab).toBe(sceneTab);
        expect(await names(page)).toEqual(["Level", "Door"]);
    });

    test("additive scenes, Set Active, Unload, Load and Remove keep the tab in step with the world", async () => {
        const page = editorPage();
        const scenes = page.workspace.scenes;
        await scenes.openStartScene();
        const tab = scenes.activeTab;
        await scenes.openSceneAdditive(OTHER_PATH);
        const [level, other] = tab.scenes;
        expect(tab.scenes.map(entry => [entry.path, entry.loaded])).toEqual([[LEVEL_PATH, true], [OTHER_PATH, true]]);
        expect((await listed(page, "Elsewhere"))?.sceneId).toBe(other.sceneId!);

        await scenes.setActiveScene(other);
        expect((await ask(page.harnessed, {op: "listEntities"})).activeSceneId).toBe(other.sceneId!);
        expect(scenes.activeEntry()).toBe(other);

        await scenes.unloadScene(other, false);
        expect([other.loaded, other.sceneId, other.path]).toEqual([false, null, OTHER_PATH]);
        expect(await names(page)).toEqual(["Level", "Door"]);
        expect((await ask(page.harnessed, {op: "listEntities"})).activeSceneId).toBe(level.sceneId!);

        await scenes.loadScene(other);
        expect(other.loaded).toBe(true);
        expect(await names(page)).toEqual(["Level", "Door", "Elsewhere"]);

        await scenes.unloadScene(level, true);
        expect(tab.scenes).toEqual([other]);
        expect(await names(page)).toEqual(["Elsewhere"]);
        await scenes.unloadScene(other, false);
        expect(other.loaded).toBe(true);
    });

    test("an additive scene open in another tab is refused rather than loaded twice", async () => {
        const page = editorPage();
        const scenes = page.workspace.scenes;
        await scenes.openStartScene();
        const first = scenes.activeTab;
        await scenes.openScene(OTHER_PATH);
        await scenes.activate(first);
        await scenes.openSceneAdditive(OTHER_PATH);
        expect(first.scenes.length).toBe(1);
        expect(page.workspace.status.level).toBe("warn");
    });

    test("New Scene opens an untitled tab, and replaces an untitled tab with no changes", async () => {
        const page = editorPage(null);
        const scenes = page.workspace.scenes;
        await scenes.openStartScene();
        await scenes.newScene();
        expect(scenes.tabs.tabs.length).toBe(1);
        await scenes.openScene(LEVEL_PATH);
        expect(scenes.tabs.tabs.length).toBe(1);
        await scenes.newScene();
        expect(scenes.tabs.tabs.length).toBe(2);
        expect([scenes.activeTab.main?.path, scenes.activeTab.main?.sceneId !== null]).toEqual([null, true]);
        expect(await names(page)).toEqual([]);
    });

    test("Set as Start Scene rewrites the manifest, and renaming the start scene's folder follows it", async () => {
        const page = editorPage();
        const scenes = page.workspace.scenes;
        await scenes.openStartScene();
        await scenes.setStartScene(OTHER_PATH);
        expect(JSON.parse(page.files.texts.get(PROJECT_MANIFEST_FILE)!)).toEqual({name: PROJECT_NAME, startScene: OTHER_PATH});
        expect(scenes.startScene).toBe(OTHER_PATH);

        await page.files.rename("scenes", "levels");
        scenes.pathRenamed("scenes", "levels");
        expect(scenes.activeTab.main?.path).toBe("levels/level.scene.json");
        await page.workspace.run(() => Promise.resolve());
        expect(scenes.startScene).toBe("levels/other.scene.json");
        expect(JSON.parse(page.files.texts.get(PROJECT_MANIFEST_FILE)!).startScene).toBe("levels/other.scene.json");
    });

    test("deleting the open scene's file leaves it open as an untitled scene with unsaved changes", async () => {
        const page = editorPage();
        const scenes = page.workspace.scenes;
        await scenes.openStartScene();
        await page.files.remove(LEVEL_PATH);
        scenes.pathDeleted(LEVEL_PATH);
        expect([scenes.activeTab.main?.path, scenes.activeTab.main?.dirty, scenes.dirty]).toEqual([null, true, true]);
        expect(page.workspace.status.level).toBe("warn");
    });
});

describe("editor console against the world", () => {
    test("a failed request is logged with the stack of the world code that threw", async () => {
        const page = editorPage();
        await page.workspace.run(() => page.workspace.request({op: "getEntity", entity: NULL_ENTITY}));
        const logged = page.workspace.consoleLog.entries.find(entry => entry.level === "error");
        expect(logged?.text).toBe('Editor request "getEntity" failed: No entity 0 in this world');
        expect(logged?.stack?.includes(THROWING_WORLD_SOURCE)).toBe(true);
    });
});
