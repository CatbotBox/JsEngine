import type {Entity} from "../../engine/core";
import {describe, expect, test} from "../../engine/testing/harness";
import {menuItemsOf} from "./commandMenus";
import type {MenuEntry} from "./commandMenus";
import {CommandRegistry, keyChordOf} from "./commandRegistry";
import type {KeyEventLike, RegisteredCommand} from "./commandRegistry";
import {
    ALREADY_START_SCENE_REASON,
    CLOSE_PROJECT_UNAVAILABLE_REASON,
    ENTITY_TEMPLATE_REASON,
    LAST_TAB_REASON,
    NO_RECENT_SCENES_REASON,
    PREFAB_START_SCENE_REASON,
    NOTHING_SELECTED_IN_PROJECT_REASON,
    registerEditorCommands,
    SHOW_IN_EXPLORER_UNAVAILABLE_REASON,
    STOP_GAME_REASON,
    UNSAVED_START_SCENE_REASON,
    WAITING_REASON,
} from "./editorCommands";
import type {EditorCommandHost, EditorCommands, EditorCommandViews} from "./editorCommands";
import {editorMenuBar, hierarchyMenu, projectFolderMenu, projectItemMenu, sceneMenu, sceneTabMenu, snapMenu} from "./editorMenus";
import {LAST_LOADED_SCENE_REASON, PREFAB_TAB_SCENES_REASON} from "./sceneDocuments";
import type {EditorSceneTab, TabHistory} from "./sceneDocuments";
import {SceneTabs} from "./sceneTabs";
import type {SceneEntry} from "./sceneTabs";
import type {BottomTab} from "./editorPanels";
import {MENU_SEPARATOR} from "./popupMenu";
import type {MenuAction, MenuItem, MenuSubmenu} from "./popupMenu";
import {shortcutRows} from "./shortcutsDialog";
import {DEFAULT_GAME_VIEW_OPTIONS, withGameViewOption} from "./gameViewOptions";
import type {GameViewOptionChoice, GameViewOptions} from "./gameViewOptions";
import {DEFAULT_SNAP_STEPS, withSnapStep} from "./snapSteps";
import type {SnapStepChoice} from "./snapSteps";

const FIRST = 3 as Entity;
const SECOND = 7 as Entity;
const MAIN_SCENE = "scenes/main.scene.json";
const LEVEL_SCENE = "scenes/level.scene.json";
const ENEMY_PREFAB = "prefabs/enemy.prefab.json";
const MAIN_SCENE_ID = 1;
const LEVEL_SCENE_ID = 2;
const FAKE_HISTORY = {} as TabHistory;

interface FakeEditor {
    readonly registry: CommandRegistry;
    readonly commands: EditorCommands;
    readonly calls: string[];
    readonly workspace: FakeWorkspace;
    readonly scenes: FakeScenes;
    mount(): void;
}

interface FakeScenes {
    readonly tabs: SceneTabs<TabHistory>;
    startScene: string | null;
    activeSceneId: number;
    recent: string[];
}

interface FakeWorkspace {
    mode: "edit" | "play" | "paused";
    view: "scene" | "game";
    tool: string;
    closed: boolean;
    selection: readonly Entity[];
    entityClipboard: string | undefined;
    worldStoppedError: string | null;
    snapSteps: typeof DEFAULT_SNAP_STEPS;
    openExternally: boolean;
    showInFolder: boolean;
    undoLabel: string | undefined;
    entityKeysFocused: boolean;
    gameViewOptions: GameViewOptions;
    projectSelection: readonly string[];
}

function fakeEditor(closeProject?: () => void): FakeEditor {
    const calls: string[] = [];
    const workspace: FakeWorkspace = {
        mode: "edit", view: "scene", tool: "move", closed: false, selection: [], entityClipboard: undefined,
        worldStoppedError: null, snapSteps: DEFAULT_SNAP_STEPS, openExternally: false, showInFolder: false, undoLabel: undefined, entityKeysFocused: true,
        gameViewOptions: DEFAULT_GAME_VIEW_OPTIONS, projectSelection: [],
    };
    let bottomTab: BottomTab = "project";
    let aspect = "free";
    let mounted = false;
    const scenes: FakeScenes = {tabs: new SceneTabs<TabHistory>(() => FAKE_HISTORY), startScene: null, activeSceneId: MAIN_SCENE_ID, recent: []};
    const sceneDocuments = {
        get tabs() { return scenes.tabs; },
        get activeTab() { return scenes.tabs.active; },
        get startScene() { return scenes.startScene; },
        get worldScenes() { return {scenes: [], activeSceneId: scenes.activeSceneId}; },
        activeEntry: () => scenes.tabs.active.entryOfScene(scenes.activeSceneId) ?? scenes.tabs.active.loadedScenes()[0],
        recentScenes: () => scenes.recent,
        clearRecentScenes: () => scenes.recent = [],
        newScene: () => calls.push("newScene"),
        save: () => calls.push("save"),
        saveAs: () => calls.push("saveAs"),
        saveAll: () => calls.push("saveAll"),
        openRecent: (path: string) => calls.push(`openRecent ${path}`),
        openSceneAdditive: (path: string) => calls.push(`openSceneAdditive ${path}`),
        setStartScene: (path: string) => calls.push(`setStartScene ${path}`),
        setActiveScene: (entry: SceneEntry) => calls.push(`setActiveScene ${entry.path}`),
        saveEntry: (entry: SceneEntry) => calls.push(`saveEntry ${entry.path}`),
        saveEntryAs: (entry: SceneEntry) => calls.push(`saveEntryAs ${entry.path}`),
        loadScene: (entry: SceneEntry) => calls.push(`loadScene ${entry.path}`),
        unloadScene: (entry: SceneEntry, removed: boolean) => calls.push(`${removed ? "removeScene" : "unloadScene"} ${entry.path}`),
        closeTab: (tab: EditorSceneTab) => calls.push(`closeTab ${tab.name}`),
    };
    const views = {
        workspace: {
            get mode() { return workspace.mode; },
            get view() { return workspace.view; },
            get tool() { return workspace.tool; },
            get closed() { return workspace.closed; },
            get recording() { return workspace.mode === "edit"; },
            get selection() { return workspace.selection; },
            get primary() { return workspace.selection[workspace.selection.length - 1]; },
            get entities() { return [{entity: FIRST}, {entity: SECOND}]; },
            get entityClipboard() { return workspace.entityClipboard; },
            componentClipboard: undefined,
            get worldStoppedError() { return workspace.worldStoppedError; },
            get snapSteps() { return workspace.snapSteps; },
            undo: {
                get undoLabel() { return workspace.undoLabel; },
                redoLabel: undefined,
                get canUndo() { return workspace.undoLabel !== undefined; },
                canRedo: false,
            },
            session: {files: {
                get openExternally() { return workspace.openExternally ? () => Promise.resolve() : undefined; },
                get showInFolder() { return workspace.showInFolder ? () => Promise.resolve() : undefined; },
            }},
            get gameViewOptions() { return workspace.gameViewOptions; },
            setGameViewOption: (choice: GameViewOptionChoice) => workspace.gameViewOptions = withGameViewOption(workspace.gameViewOptions, choice),
            dataAssetTypeNames: () => ["SwarmTuning"],
            scenes: sceneDocuments,
            undoLast: () => calls.push("undoLast"),
            destroy: (entities: readonly Entity[]) => calls.push(`destroy ${entities.join(",")}`),
            createEmpty: (parent: Entity | null) => calls.push(`createEmpty ${parent}`),
            select: (entities: readonly Entity[]) => calls.push(`select ${entities.join(",")}`),
            setMode: (mode: string) => calls.push(`setMode ${mode}`),
            setTool: (tool: string) => calls.push(`setTool ${tool}`),
            setSnapStep: (choice: SnapStepChoice) => workspace.snapSteps = withSnapStep(workspace.snapSteps, choice),
        },
        scene: {capturesKeys: false},
        hierarchy: {beginRename: (entity: Entity) => calls.push(`beginRename ${entity}`)},
        project: {
            currentFolder: "assets",
            get selectedPaths() { return workspace.projectSelection; },
            createFolder: (folder: string) => calls.push(`createFolder ${folder}`),
            createPrefab: (folder: string) => calls.push(`createPrefab ${folder}`),
            createScript: (folder: string) => calls.push(`createScript ${folder}`),
            showInExplorer: (path: string) => calls.push(`showInExplorer ${path}`),
            duplicate: (paths: readonly string[]) => calls.push(`duplicate ${paths.join(",")}`),
            remove: (paths: readonly string[]) => calls.push(`remove ${paths.join(",")}`),
            open: (path: string) => calls.push(`open ${path}`),
        },
        dataAssets: {hasFocus: () => false, dirty: false},
    } as unknown as EditorCommandViews;
    const host: EditorCommandHost = {
        closeProject,
        views: () => mounted ? views : undefined,
        bottomTab: () => bottomTab,
        showBottomTab: tab => bottomTab = tab,
        resetLayout: () => calls.push("resetLayout"),
        gameViewAspect: () => aspect,
        setGameViewAspect: id => aspect = id,
        textSelected: () => false,
        entityKeysFocused: () => workspace.entityKeysFocused,
        toggleCommandPalette: () => calls.push("palette"),
        showKeyboardShortcuts: () => calls.push("shortcuts"),
        openSceneChooser: () => calls.push("openSceneChooser"),
        openProjectSettings: () => calls.push("openProjectSettings"),
    };
    const registry = new CommandRegistry();
    const commands = registerEditorCommands(registry, host);
    return {registry, commands, calls, workspace, scenes, mount: () => mounted = true};
}

function labels(items: readonly MenuItem[]): string[] {
    return items.map(item => item === MENU_SEPARATOR ? "-" : item.label);
}

function find(items: readonly MenuItem[], ...path: readonly string[]): MenuAction | MenuSubmenu {
    let current: readonly MenuItem[] = items;
    let found: MenuAction | MenuSubmenu | undefined;
    for (const label of path) {
        found = current.find((item): item is MenuAction | MenuSubmenu => item !== MENU_SEPARATOR && item.label === label);
        if (found === undefined) throw new Error(`no menu item ${path.join(" > ")}`);
        current = "items" in found ? found.items : [];
    }
    if (found === undefined) throw new Error("empty path");
    return found;
}

function action(items: readonly MenuItem[], ...path: readonly string[]): MenuAction {
    const found = find(items, ...path);
    if ("items" in found) throw new Error(`${path.join(" > ")} is a submenu`);
    return found;
}

function menuBarItems(editor: FakeEditor): ReadonlyMap<string, MenuItem[]> {
    return new Map(editorMenuBar(editor.commands).map(menu => [menu.label, menuItemsOf(menu.entries())]));
}

function menuNamed(menus: ReadonlyMap<string, MenuItem[]>, label: string): MenuItem[] {
    const menu = menus.get(label);
    if (menu === undefined) throw new Error(`no menu ${label}`);
    return menu;
}

function items(entries: readonly MenuEntry[]): MenuItem[] {
    return menuItemsOf(entries);
}

function boundCommand(editor: FakeEditor, event: KeyEventLike): RegisteredCommand {
    const command = editor.registry.commandFor(keyChordOf(event));
    if (command === undefined) throw new Error(`nothing is bound to ${event.key}`);
    return command;
}

function key(text: string, modifiers: Partial<Omit<KeyEventLike, "key">> = {}): KeyEventLike {
    return {key: text, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers};
}

describe("editor menu bar", () => {
    test("the menus and their items follow the Unity/Godot layout", () => {
        const menus = menuBarItems(fakeEditor());
        expect([...menus.keys()]).toEqual(["File", "Edit", "Assets", "Entity", "Window", "Help"]);
        expect(labels(menuNamed(menus, "File"))).toEqual([
            "New Scene", "Open Scene…", "Open Recent", "-", "Save", "Save As…", "Save All", "-", "Set as Start Scene", "Project Settings…", "-", "Close Project",
        ]);
        expect(labels(menuNamed(menus, "Edit"))).toEqual([
            "Undo", "Redo", "-", "Cut", "Copy", "Paste", "Duplicate", "Rename", "Delete", "-", "Select All", "Frame Selected", "-", "Play", "Pause", "Step", "-", "Preferences…",
        ]);
        expect(labels(menuNamed(menus, "Assets"))).toEqual(["Create", "-", "Show in Explorer", "Refresh"]);
        expect(labels((find(menuNamed(menus, "Assets"), "Create") as MenuSubmenu).items)).toEqual(["Folder", "Scene", "Prefab", "Script", "-", "Data Asset"]);
        expect(labels(menuNamed(menus, "Entity"))).toEqual([
            "Create Empty", "Create Empty Child", "-", "Camera", "Sprite", "Text", "Mesh", "-", "Directional Light", "Point Light", "Ambient Light",
        ]);
        expect(labels(menuNamed(menus, "Window"))).toEqual([
            "Scene View", "Game View", "Maximize on Play", "Stats", "-", "Project", "Console", "Settings", "Data Assets", "-", "Hierarchy", "Inspector", "Bottom Panel", "-", "Reset Layout",
        ]);
        expect(labels(menuNamed(menus, "Help"))).toEqual(["Command Palette…", "Keyboard Shortcuts"]);
    });

    test("menu items show their shortcuts", () => {
        const menus = menuBarItems(fakeEditor());
        expect(action(menuNamed(menus, "File"), "Save").shortcut).toBe("Ctrl+S");
        expect(action(menuNamed(menus, "File"), "Save As…").shortcut).toBe("Ctrl+Shift+S");
        expect(action(menuNamed(menus, "Edit"), "Redo").shortcut).toBe("Ctrl+Y");
        expect(action(menuNamed(menus, "Edit"), "Delete").shortcut).toBe("Del");
        expect(action(menuNamed(menus, "Help"), "Command Palette…").shortcut).toBe("Ctrl+Shift+P");
    });

    test("features that do not exist yet are disabled with the step that brings them", () => {
        const editor = fakeEditor();
        editor.mount();
        const menus = menuBarItems(editor);
        const reasonOf = (menu: string, ...path: string[]): string | undefined => action(menuNamed(menus, menu), ...path).title;
        expect(reasonOf("Assets", "Show in Explorer")).toBe(SHOW_IN_EXPLORER_UNAVAILABLE_REASON);
        expect(action(menuNamed(menus, "Assets"), "Create", "Prefab").disabled).toBe(false);
        expect(action(menuNamed(menus, "Assets"), "Create", "Script").disabled).toBe(false);
        expect(reasonOf("Entity", "Camera")).toBe(ENTITY_TEMPLATE_REASON);
        expect(action(menuNamed(menus, "Entity"), "Create Empty").disabled).toBe(false);
    });

    test("Project Settings… waits for the game, then opens the window", () => {
        const editor = fakeEditor();
        expect(action(menuNamed(menuBarItems(editor), "File"), "Project Settings…").title).toBe(WAITING_REASON);
        editor.mount();
        const settings = action(menuNamed(menuBarItems(editor), "File"), "Project Settings…");
        expect(settings.disabled).toBe(false);
        settings.run();
        expect(editor.calls).toEqual(["openProjectSettings"]);
    });

    test("before the game connects, editing commands wait while window, palette and help commands work", () => {
        const editor = fakeEditor();
        const menus = menuBarItems(editor);
        expect([action(menuNamed(menus, "File"), "Save").disabled, action(menuNamed(menus, "File"), "Save").title]).toEqual([true, WAITING_REASON]);
        expect(action(menuNamed(menus, "Edit"), "Undo").title).toBe(WAITING_REASON);
        for (const [menu, label] of [["Window", "Console"], ["Window", "Reset Layout"], ["Help", "Command Palette…"], ["Help", "Keyboard Shortcuts"]]) {
            expect(action(menuNamed(menus, menu), label).disabled).toBe(false);
        }
        action(menuNamed(menus, "Window"), "Console").run();
        expect(action(menuNamed(menuBarItems(editor), "Window"), "Console").checked).toBe(true);
    });

    test("Close Project works only when the page can return to the start screen", () => {
        let closed = 0;
        expect(action(menuNamed(menuBarItems(fakeEditor(() => closed++)), "File"), "Close Project").disabled).toBe(false);
        action(menuNamed(menuBarItems(fakeEditor(() => closed++)), "File"), "Close Project").run();
        expect(closed).toBe(1);
        expect(action(menuNamed(menuBarItems(fakeEditor()), "File"), "Close Project").title).toBe(CLOSE_PROJECT_UNAVAILABLE_REASON);
    });

    test("Undo names the action it undoes and is unavailable while the game runs", () => {
        const editor = fakeEditor();
        editor.mount();
        expect(action(menuNamed(menuBarItems(editor), "Edit"), "Undo").title).toBe("Nothing to undo");
        editor.workspace.undoLabel = "Rename";
        expect(action(menuNamed(menuBarItems(editor), "Edit"), "Undo Rename").disabled).toBe(false);
        editor.workspace.mode = "play";
        expect(action(menuNamed(menuBarItems(editor), "Edit"), "Undo Rename").title).toBe("Undo is not available while the game runs; stop it first");
        expect(action(menuNamed(menuBarItems(editor), "Edit"), "Stop").checked).toBe(true);
    });
});

describe("editor shortcuts", () => {
    test("the existing bindings all resolve to their commands", () => {
        const editor = fakeEditor();
        const bound = (event: KeyEventLike): string | undefined => editor.registry.commandFor(keyChordOf(event))?.id;
        expect(bound(key("s", {ctrlKey: true}))).toBe("file.save");
        expect(bound(key("z", {ctrlKey: true}))).toBe("edit.undo");
        expect(bound(key("y", {ctrlKey: true}))).toBe("edit.redo");
        expect(bound(key("Z", {ctrlKey: true, shiftKey: true}))).toBe("edit.redo");
        expect(bound(key("d", {ctrlKey: true}))).toBe("edit.duplicate");
        expect(bound(key("c", {ctrlKey: true}))).toBe("edit.copy");
        expect(bound(key("v", {ctrlKey: true}))).toBe("edit.paste");
        expect(bound(key("p", {ctrlKey: true}))).toBe("play.play");
        expect(bound(key("Delete"))).toBe("edit.delete");
        expect(bound(key("F2"))).toBe("edit.rename");
        expect(bound(key("f"))).toBe("edit.frameSelected");
        expect(["q", "w", "e", "r"].map(letter => bound(key(letter)))).toEqual(["tools.hand", "tools.move", "tools.rotate", "tools.scale"]);
        expect(bound(key("P", {ctrlKey: true, shiftKey: true}))).toBe("help.commandPalette");
    });

    test("a shortcut acts on the current selection", () => {
        const editor = fakeEditor();
        editor.mount();
        const remove = boundCommand(editor, key("Delete"));
        expect(remove.runAlone()).toBe(false);
        editor.workspace.selection = [FIRST, SECOND];
        expect(remove.runAlone()).toBe(true);
        boundCommand(editor, key("F2")).runAlone();
        expect(editor.calls).toEqual(["destroy 3,7", "beginRename 7"]);
    });

    test("a disabled shortcut explains itself only when the reason is worth a notice", () => {
        const editor = fakeEditor();
        editor.mount();
        const undo = boundCommand(editor, key("z", {ctrlKey: true}));
        expect([undo.stateAlone().enabled, undo.explainsWhenDisabled()]).toEqual([false, false]);
        editor.workspace.mode = "play";
        expect(undo.explainsWhenDisabled()).toBe(true);
        expect(boundCommand(editor, key("S", {ctrlKey: true, shiftKey: true})).explainsWhenDisabled()).toBe(true);
        expect(boundCommand(editor, key("n", {ctrlKey: true})).explainsWhenDisabled()).toBe(true);
        expect(boundCommand(editor, key("Delete")).explainsWhenDisabled()).toBe(false);
    });

    test("Select All takes Ctrl+A only while the hierarchy, the Scene view or nothing has focus", () => {
        const editor = fakeEditor();
        editor.mount();
        const selectAll = keyChordOf(key("a", {ctrlKey: true}));
        const outside = {inTextEntry: false, textEdited: false};
        expect(editor.registry.resolveKey(selectAll, outside).kind).toBe("bound");
        editor.workspace.entityKeysFocused = false;
        expect(editor.registry.resolveKey(selectAll, outside).kind).toBe("passed");
    });

    test("the shortcut list groups commands by category and lists every key of a command", () => {
        const rows = shortcutRows(fakeEditor().registry.all());
        expect(rows.find(row => row.label === "Redo")?.shortcuts).toEqual(["Ctrl+Y", "Ctrl+Shift+Z"]);
        expect([...new Set(rows.map(row => row.category))]).toEqual(["File", "Edit", "Play", "Tools", "Help"]);
        expect(rows.every(row => row.shortcuts.length > 0)).toBe(true);
        expect(rows.find(row => row.label === "Open Scene…")?.shortcuts).toEqual(["Ctrl+O"]);
    });
});

describe("editor context menus", () => {
    test("the hierarchy menu acts on the right-clicked entity and the selection; empty space disables both", () => {
        const editor = fakeEditor();
        editor.mount();
        const menu = items(hierarchyMenu(editor.commands, SECOND, [FIRST, SECOND]));
        expect(labels(menu)).toEqual(["Create Empty", "Create Empty Child", "-", "Cut", "Copy", "Paste", "Duplicate", "Rename", "Delete"]);
        action(menu, "Create Empty Child").run();
        action(menu, "Rename").run();
        action(menu, "Delete").run();
        expect(editor.calls).toEqual(["createEmpty 7", "beginRename 7", "destroy 3,7"]);
        const empty = items(hierarchyMenu(editor.commands, undefined, []));
        expect(["Create Empty Child", "Copy", "Rename", "Delete"].map(label => action(empty, label).disabled)).toEqual([true, true, true, true]);
        expect(action(empty, "Paste").title).toBe("Nothing copied yet");
    });

    test("project folder menus offer rename and delete except on the root, and create in that folder", () => {
        const editor = fakeEditor();
        editor.mount();
        expect(labels(items(projectFolderMenu(editor.commands, "", true)))).toEqual(["New Folder", "New Scene", "Create", "-", "Show in Explorer"]);
        const folder = items(projectFolderMenu(editor.commands, "art", false));
        expect(labels(folder)).toEqual(["New Folder", "New Scene", "Create", "-", "Show in Explorer", "-", "Rename", "Duplicate", "Delete"]);
        expect(labels((find(folder, "Create") as MenuSubmenu).items)).toEqual(["Prefab", "Script", "-", "Data Asset"]);
        expect(labels((find(folder, "Create", "Data Asset") as MenuSubmenu).items)).toEqual(["SwarmTuning"]);
        action(folder, "New Folder").run();
        expect(editor.calls).toEqual(["createFolder art"]);
    });

    test("project item menus open documents, open code externally when the host can, and add assets to the scene", () => {
        const editor = fakeEditor();
        editor.mount();
        expect(labels(items(projectItemMenu(editor.commands, {path: "a.scene.json", kind: "scene"})))).toEqual(["Open", "Open Scene Additive", "Set as Start Scene", "-", "Show in Explorer", "-", "Rename", "Duplicate", "Delete"]);
        expect(labels(items(projectItemMenu(editor.commands, {path: "a.png", kind: "image"})))).toEqual(["Open in Editor", "Add to Scene", "-", "Show in Explorer", "-", "Rename", "Duplicate", "Delete"]);
        const code = items(projectItemMenu(editor.commands, {path: "game.ts", kind: "code"}));
        expect(action(code, "Open in Editor").disabled).toBe(true);
        editor.workspace.openExternally = true;
        action(items(projectItemMenu(editor.commands, {path: "game.ts", kind: "code"})), "Open in Editor").run();
        expect(editor.calls).toEqual(["open game.ts"]);
    });

    test("project item menus act on the whole selection when the clicked item is in it, else on the clicked item", () => {
        const editor = fakeEditor();
        editor.mount();
        const selection = ["a.png", "b.png"];
        const inSelection = items(projectItemMenu(editor.commands, {path: "a.png", kind: "image"}, selection));
        expect(action(inSelection, "Delete 2 items").disabled).toBe(false);
        action(inSelection, "Duplicate 2 items").run();
        action(items(projectItemMenu(editor.commands, {path: "c.png", kind: "image"}, selection)), "Delete").run();
        expect(editor.calls).toEqual(["duplicate a.png,b.png", "remove c.png"]);
    });

    test("Duplicate and Delete in the palette target the Project panel's selection", () => {
        const editor = fakeEditor();
        editor.mount();
        expect(editor.commands.assets.remove.stateAlone().reason).toBe(NOTHING_SELECTED_IN_PROJECT_REASON);
        editor.workspace.projectSelection = ["art/a.png"];
        expect(editor.commands.assets.remove.runAlone()).toBe(true);
        expect(editor.commands.assets.duplicate.runAlone()).toBe(true);
        expect(editor.calls).toEqual(["remove art/a.png", "duplicate art/a.png"]);
    });

    test("Show in Explorer works only where the host can open the file manager, on the selection or else the shown folder", () => {
        const editor = fakeEditor();
        editor.mount();
        const show = editor.commands.assets.showInExplorer;
        expect(show.stateAlone().reason).toBe(SHOW_IN_EXPLORER_UNAVAILABLE_REASON);
        editor.workspace.showInFolder = true;
        expect(show.runAlone()).toBe(true);
        editor.workspace.projectSelection = ["art/a.png", "art/b.png"];
        expect(show.runAlone()).toBe(true);
        expect(editor.calls).toEqual(["showInExplorer assets", "showInExplorer art/b.png"]);
    });

    test("Create Prefab and Create Script create in the shown folder or the menu's folder", () => {
        const editor = fakeEditor();
        editor.mount();
        expect(editor.commands.assets.createPrefab.runAlone()).toBe(true);
        action((find(items(projectFolderMenu(editor.commands, "src", false)), "Create") as MenuSubmenu).items, "Script").run();
        expect(editor.calls).toEqual(["createPrefab assets", "createScript src"]);
    });

    test("the Game view options toggle and show as checked", () => {
        const editor = fakeEditor();
        editor.mount();
        const maximize = editor.commands.view.gameViewOptions.maximizeOnPlay;
        expect(maximize.stateAlone().checked).toBe(false);
        maximize.runAlone();
        expect(editor.workspace.gameViewOptions.maximizeOnPlay).toBe(true);
        expect(maximize.stateAlone().checked).toBe(true);
        const windowMenu = menuNamed(menuBarItems(editor), "Window");
        action(windowMenu, "Stats").run();
        expect(editor.workspace.gameViewOptions.stats).toBe(true);
    });
});

describe("toolbar menus", () => {
    test("the snap menu lists each step kind's presets and checks the current step", () => {
        const editor = fakeEditor();
        editor.mount();
        const snap = items(snapMenu(editor.commands));
        expect(labels(snap)).toEqual(["Move (2D) step", "Move (3D) step", "Rotate step", "Scale step"]);
        expect(action(snap, "Rotate step", "15°").checked).toBe(true);
        action(snap, "Rotate step", "45°").run();
        expect(editor.workspace.snapSteps.rotateDegrees).toBe(45);
        expect(action(items(snapMenu(editor.commands)), "Rotate step", "45°").checked).toBe(true);
    });
});

function sceneEntry(editor: FakeEditor, path: string | null, sceneId: number | null, loaded = true): SceneEntry {
    const entry = editor.scenes.tabs.entry(path, sceneId, loaded);
    editor.scenes.tabs.active.scenes.push(entry);
    return entry;
}

function openMain(editor: FakeEditor): SceneEntry {
    const tab = editor.scenes.tabs.active;
    tab.scenes.splice(0, tab.scenes.length);
    return sceneEntry(editor, MAIN_SCENE, MAIN_SCENE_ID);
}

describe("scene management commands", () => {
    test("New Scene, Save As, Save All and Open Recent are live and need edit mode", () => {
        const editor = fakeEditor();
        editor.mount();
        openMain(editor);
        editor.scenes.recent = [MAIN_SCENE, LEVEL_SCENE];
        const file = menuNamed(menuBarItems(editor), "File");
        for (const label of ["New Scene", "Save As…", "Save All"]) action(file, label).run();
        expect(labels((find(file, "Open Recent") as MenuSubmenu).items)).toEqual([MAIN_SCENE, LEVEL_SCENE, "-", "Clear Recent Scenes"]);
        action(file, "Open Recent", LEVEL_SCENE).run();
        expect(editor.calls).toEqual(["newScene", "saveAs", "saveAll", `openRecent ${LEVEL_SCENE}`]);
        expect(action(menuNamed(menuBarItems(editor), "File"), "New Scene").shortcut).toBe("Ctrl+N");

        editor.workspace.mode = "play";
        const playing = menuNamed(menuBarItems(editor), "File");
        expect(action(playing, "New Scene").title).toBe(STOP_GAME_REASON);
        expect(action(playing, "Open Scene…").title).toBe(STOP_GAME_REASON);
        expect(action(playing, "Open Recent", MAIN_SCENE).title).toBe(STOP_GAME_REASON);
        expect(action(playing, "Save As…").disabled).toBe(true);
    });

    test("Clear Recent Scenes empties the list and is disabled when it is empty", () => {
        const editor = fakeEditor();
        editor.mount();
        editor.scenes.recent = [MAIN_SCENE];
        action(menuNamed(menuBarItems(editor), "File"), "Open Recent", "Clear Recent Scenes").run();
        expect(editor.scenes.recent).toEqual([]);
        const cleared = action(menuNamed(menuBarItems(editor), "File"), "Open Recent", "Clear Recent Scenes");
        expect([cleared.disabled, cleared.title]).toEqual([true, NO_RECENT_SCENES_REASON]);
    });

    test("the command palette lists each recent scene", () => {
        const editor = fakeEditor();
        editor.mount();
        editor.scenes.recent = [MAIN_SCENE];
        const openRecent = editor.registry.get("file.openRecent");
        expect(openRecent?.paletteChoices().map(choice => choice.state.label)).toEqual([`Open Recent: ${MAIN_SCENE}`]);
    });

    test("Set as Start Scene targets the active scene, is checked on the start scene and refuses untitled scenes and prefabs", () => {
        const editor = fakeEditor();
        editor.mount();
        const reasonOf = (): string | undefined => action(menuNamed(menuBarItems(editor), "File"), "Set as Start Scene").title;
        expect(reasonOf()).toBe(UNSAVED_START_SCENE_REASON);
        openMain(editor);
        action(menuNamed(menuBarItems(editor), "File"), "Set as Start Scene").run();
        expect(editor.calls).toEqual([`setStartScene ${MAIN_SCENE}`]);
        editor.scenes.startScene = MAIN_SCENE;
        const start = action(menuNamed(menuBarItems(editor), "File"), "Set as Start Scene");
        expect([start.checked, start.title]).toEqual([true, ALREADY_START_SCENE_REASON]);
        const prefabTab = editor.scenes.tabs.add("prefab", editor.scenes.tabs.active.key);
        prefabTab.scenes.push(editor.scenes.tabs.entry(ENEMY_PREFAB, 3));
        editor.scenes.tabs.activate(prefabTab);
        expect(reasonOf()).toBe(PREFAB_START_SCENE_REASON);
    });

    test("the hierarchy scene menu acts on its scene and keeps the last loaded scene", () => {
        const editor = fakeEditor();
        editor.mount();
        const main = openMain(editor);
        const mainMenu = items(sceneMenu(editor.commands, main));
        expect(labels(mainMenu)).toEqual(["Set Active Scene", "-", "Save Scene", "Save Scene As…", "-", "Unload Scene", "Remove Scene", "-", "Set as Start Scene"]);
        expect(action(mainMenu, "Set Active Scene").checked).toBe(true);
        expect(action(mainMenu, "Unload Scene").title).toBe(LAST_LOADED_SCENE_REASON);
        expect(action(mainMenu, "Remove Scene").title).toBe(LAST_LOADED_SCENE_REASON);

        const level = sceneEntry(editor, LEVEL_SCENE, LEVEL_SCENE_ID);
        const levelMenu = items(sceneMenu(editor.commands, level));
        for (const label of ["Set Active Scene", "Save Scene", "Save Scene As…", "Unload Scene", "Remove Scene"]) action(levelMenu, label).run();
        expect(editor.calls).toEqual([`setActiveScene ${LEVEL_SCENE}`, `saveEntry ${LEVEL_SCENE}`, `saveEntryAs ${LEVEL_SCENE}`, `unloadScene ${LEVEL_SCENE}`, `removeScene ${LEVEL_SCENE}`]);
        expect(action(items(sceneMenu(editor.commands, main)), "Unload Scene").disabled).toBe(false);

        level.loaded = false;
        level.sceneId = null;
        const unloaded = items(sceneMenu(editor.commands, level));
        expect(labels(unloaded)).toEqual(["Set Active Scene", "-", "Save Scene", "Save Scene As…", "-", "Load Scene", "Remove Scene", "-", "Set as Start Scene"]);
        action(unloaded, "Load Scene").run();
        expect(editor.calls[editor.calls.length - 1]).toBe(`loadScene ${LEVEL_SCENE}`);
        expect(action(unloaded, "Set Active Scene").disabled).toBe(true);

        editor.workspace.mode = "play";
        expect(action(items(sceneMenu(editor.commands, main)), "Save Scene").title).toBe(STOP_GAME_REASON);
    });

    test("Open Scene Additive refuses prefab tabs, non-scene files and scenes that are already open", () => {
        const editor = fakeEditor();
        editor.mount();
        openMain(editor);
        const additive = (path: string, kind: "scene" | "prefab") => action(items(projectItemMenu(editor.commands, {path, kind})), "Open Scene Additive");
        additive(LEVEL_SCENE, "scene").run();
        expect(editor.calls).toEqual([`openSceneAdditive ${LEVEL_SCENE}`]);
        expect(additive(MAIN_SCENE, "scene").disabled).toBe(true);
        expect(labels(items(projectItemMenu(editor.commands, {path: ENEMY_PREFAB, kind: "prefab"})))).toEqual(["Open", "Add to Scene", "-", "Show in Explorer", "-", "Rename", "Duplicate", "Delete"]);
        const prefabTab = editor.scenes.tabs.add("prefab", editor.scenes.tabs.active.key);
        prefabTab.scenes.push(editor.scenes.tabs.entry(ENEMY_PREFAB, 3));
        editor.scenes.tabs.activate(prefabTab);
        expect(additive(LEVEL_SCENE, "scene").title).toBe(PREFAB_TAB_SCENES_REASON);
    });

    test("a tab menu saves the active tab and closes any tab but the last", () => {
        const editor = fakeEditor();
        editor.mount();
        openMain(editor);
        const first = editor.scenes.tabs.active;
        expect(action(items(sceneTabMenu(editor.commands, first, true)), "Close Tab").title).toBe(LAST_TAB_REASON);
        const second = editor.scenes.tabs.add("scene", undefined);
        second.scenes.push(editor.scenes.tabs.entry(LEVEL_SCENE, null));
        expect(labels(items(sceneTabMenu(editor.commands, first, true)))).toEqual(["Save", "Save As…", "-", "Close Tab"]);
        expect(labels(items(sceneTabMenu(editor.commands, second, false)))).toEqual(["Close Tab"]);
        action(items(sceneTabMenu(editor.commands, second, false)), "Close Tab").run();
        expect(editor.calls).toEqual(["closeTab level"]);
    });
});
