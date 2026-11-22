import type {Entity} from "../../engine/core";
import {choiceEntries, commandEntry, commandEntryFor, submenuEntry} from "./commandMenus";
import type {MenuEntry} from "./commandMenus";
import type {ComponentTarget, EditorCommands, ProjectItem} from "./editorCommands";
import type {EditorSceneTab} from "./sceneDocuments";
import type {SceneEntry} from "./sceneTabs";
import {BOTTOM_TABS} from "./editorPanels";
import {gameViewAspectOf} from "./gameViewAspect";
import {GAME_VIEW_OPTIONS} from "./gameViewOptions";
import type {MenuBarMenu} from "./menuBar";
import {MENU_SEPARATOR} from "./popupMenu";
import {isAssetKind} from "./projectFiles";
import {SNAP_KIND_LABELS, SNAP_KINDS, snapStepText} from "./snapSteps";
import type {SnapKind, SnapStepChoice} from "./snapSteps";

export const FILE_MENU_LABEL = "File";
export const EDIT_MENU_LABEL = "Edit";
export const ASSETS_MENU_LABEL = "Assets";
export const ENTITY_MENU_LABEL = "Entity";
export const WINDOW_MENU_LABEL = "Window";
export const HELP_MENU_LABEL = "Help";

const CREATE_LABEL = "Create";
const DATA_ASSET_LABEL = "Data Asset";
const NEW_FOLDER_LABEL = "New Folder";
const NEW_SCENE_LABEL = "New Scene";
const OPEN_RECENT_LABEL = "Open Recent";
const PREFAB_LABEL = "Prefab";
const SCRIPT_LABEL = "Script";

function dataAssetEntries(commands: EditorCommands, folder: string | undefined): MenuEntry[] {
    const command = commands.assets.createDataAsset;
    return command.choices().map(choice => commandEntryFor(command, folder === undefined ? choice : {folder, typeName: choice.typeName}, choice.typeName));
}

function recentScenesMenu(commands: EditorCommands): MenuEntry[] {
    const file = commands.file;
    return [...choiceEntries(file.openRecent, path => path), MENU_SEPARATOR, commandEntry(file.clearRecent)];
}

function fileMenu(commands: EditorCommands): MenuEntry[] {
    const file = commands.file;
    return [
        commandEntry(file.newScene),
        commandEntry(file.openScene),
        submenuEntry(OPEN_RECENT_LABEL, recentScenesMenu(commands)),
        MENU_SEPARATOR,
        commandEntry(file.save),
        commandEntry(file.saveAs),
        commandEntry(file.saveAll),
        MENU_SEPARATOR,
        commandEntry(file.setStartScene),
        commandEntry(file.projectSettings),
        MENU_SEPARATOR,
        commandEntry(file.closeProject),
    ];
}

function editMenu(commands: EditorCommands): MenuEntry[] {
    const {edit, play} = commands;
    return [
        commandEntry(edit.undo),
        commandEntry(edit.redo),
        MENU_SEPARATOR,
        commandEntry(edit.cut),
        commandEntry(edit.copy),
        commandEntry(edit.paste),
        commandEntry(edit.duplicate),
        commandEntry(edit.rename),
        commandEntry(edit.remove),
        MENU_SEPARATOR,
        commandEntry(edit.selectAll),
        commandEntry(edit.frameSelected),
        MENU_SEPARATOR,
        commandEntry(play.play),
        commandEntry(play.pause),
        commandEntry(play.step),
        MENU_SEPARATOR,
        commandEntry(edit.preferences),
    ];
}

function assetsMenu(commands: EditorCommands): MenuEntry[] {
    const assets = commands.assets;
    return [
        submenuEntry(CREATE_LABEL, [
            commandEntry(assets.createFolder, "Folder"),
            commandEntry(assets.createScene, "Scene"),
            commandEntry(assets.createPrefab, PREFAB_LABEL),
            commandEntry(assets.createScript, SCRIPT_LABEL),
            MENU_SEPARATOR,
            submenuEntry(DATA_ASSET_LABEL, dataAssetEntries(commands, undefined)),
        ]),
        MENU_SEPARATOR,
        commandEntry(assets.showInExplorer),
        commandEntry(assets.refresh),
    ];
}

function entityMenu(commands: EditorCommands): MenuEntry[] {
    const entity = commands.entity;
    return [
        commandEntry(entity.createEmpty),
        commandEntry(entity.createEmptyChild),
        MENU_SEPARATOR,
        commandEntry(entity.createCamera, "Camera"),
        commandEntry(entity.createSprite, "Sprite"),
        commandEntry(entity.createText, "Text"),
        commandEntry(entity.createMesh, "Mesh"),
        MENU_SEPARATOR,
        commandEntry(entity.createDirectionalLight, "Directional Light"),
        commandEntry(entity.createPointLight, "Point Light"),
        commandEntry(entity.createAmbientLight, "Ambient Light"),
    ];
}

function windowMenu(commands: EditorCommands): MenuEntry[] {
    const {view, window} = commands;
    return [
        commandEntry(view.views.scene),
        commandEntry(view.views.game),
        ...GAME_VIEW_OPTIONS.map(option => commandEntry(view.gameViewOptions[option])),
        MENU_SEPARATOR,
        ...BOTTOM_TABS.map(tab => commandEntry(window.bottomTabs[tab])),
        MENU_SEPARATOR,
        commandEntry(window.toggleHierarchy),
        commandEntry(window.toggleInspector),
        commandEntry(window.toggleBottomPanel),
        MENU_SEPARATOR,
        commandEntry(window.resetLayout),
    ];
}

function helpMenu(commands: EditorCommands): MenuEntry[] {
    return [commandEntry(commands.help.commandPalette), commandEntry(commands.help.keyboardShortcuts)];
}

export function editorMenuBar(commands: EditorCommands): MenuBarMenu[] {
    return [
        {label: FILE_MENU_LABEL, entries: () => fileMenu(commands)},
        {label: EDIT_MENU_LABEL, entries: () => editMenu(commands)},
        {label: ASSETS_MENU_LABEL, entries: () => assetsMenu(commands)},
        {label: ENTITY_MENU_LABEL, entries: () => entityMenu(commands)},
        {label: WINDOW_MENU_LABEL, entries: () => windowMenu(commands)},
        {label: HELP_MENU_LABEL, entries: () => helpMenu(commands)},
    ];
}

export function hierarchyMenu(commands: EditorCommands, clicked: Entity | undefined, selection: readonly Entity[]): MenuEntry[] {
    const {edit, entity} = commands;
    return [
        commandEntry(entity.createEmpty),
        commandEntryFor(entity.createEmptyChild, clicked),
        MENU_SEPARATOR,
        commandEntryFor(edit.cut, selection),
        commandEntryFor(edit.copy, selection),
        commandEntry(edit.paste),
        commandEntryFor(edit.duplicate, selection),
        commandEntryFor(edit.rename, clicked),
        commandEntryFor(edit.remove, selection),
    ];
}

function selectionIncluding(path: string, selection: readonly string[]): readonly string[] {
    return selection.includes(path) ? selection : [path];
}

export function projectFolderMenu(commands: EditorCommands, folder: string, isRoot: boolean, selection: readonly string[] = [folder]): MenuEntry[] {
    const assets = commands.assets;
    const entries: MenuEntry[] = [
        commandEntryFor(assets.createFolder, folder, NEW_FOLDER_LABEL),
        commandEntryFor(assets.createScene, folder, NEW_SCENE_LABEL),
        submenuEntry(CREATE_LABEL, [
            commandEntryFor(assets.createPrefab, folder, PREFAB_LABEL),
            commandEntryFor(assets.createScript, folder, SCRIPT_LABEL),
            MENU_SEPARATOR,
            submenuEntry(DATA_ASSET_LABEL, dataAssetEntries(commands, folder)),
        ]),
        MENU_SEPARATOR,
        commandEntryFor(assets.showInExplorer, folder),
    ];
    if (!isRoot) {
        const targets = selectionIncluding(folder, selection);
        entries.push(MENU_SEPARATOR, commandEntryFor(assets.rename, folder), commandEntryFor(assets.duplicate, targets), commandEntryFor(assets.remove, targets));
    }
    return entries;
}

export function projectItemMenu(commands: EditorCommands, item: ProjectItem, selection: readonly string[] = [item.path]): MenuEntry[] {
    const assets = commands.assets;
    const targets = selectionIncluding(item.path, selection);
    const entries: MenuEntry[] = [commandEntryFor(assets.open, item)];
    if (item.kind === "scene") entries.push(commandEntryFor(assets.openSceneAdditive, item.path), commandEntryFor(commands.file.setStartScene, item.path));
    if (isAssetKind(item.kind)) entries.push(commandEntryFor(assets.addToScene, item.path));
    entries.push(
        MENU_SEPARATOR,
        commandEntryFor(assets.showInExplorer, item.path),
        MENU_SEPARATOR,
        commandEntryFor(assets.rename, item.path),
        commandEntryFor(assets.duplicate, targets),
        commandEntryFor(assets.remove, targets),
    );
    return entries;
}

export function sceneMenu(commands: EditorCommands, entry: SceneEntry): MenuEntry[] {
    const scene = commands.scene;
    return [
        commandEntryFor(scene.setActive, entry),
        MENU_SEPARATOR,
        commandEntryFor(scene.save, entry),
        commandEntryFor(scene.saveAs, entry),
        MENU_SEPARATOR,
        entry.loaded ? commandEntryFor(scene.unload, entry) : commandEntryFor(scene.load, entry),
        commandEntryFor(scene.remove, entry),
        MENU_SEPARATOR,
        commandEntryFor(commands.file.setStartScene, entry.path ?? undefined),
    ];
}

export function sceneTabMenu(commands: EditorCommands, tab: EditorSceneTab, active: boolean): MenuEntry[] {
    const entries: MenuEntry[] = active ? [commandEntry(commands.file.save), commandEntry(commands.file.saveAs), MENU_SEPARATOR] : [];
    entries.push(commandEntryFor(commands.scene.closeTab, tab));
    return entries;
}

export function componentMenu(commands: EditorCommands, target: ComponentTarget): MenuEntry[] {
    const component = commands.component;
    return [
        commandEntryFor(component.reset, target),
        commandEntryFor(component.remove, target),
        MENU_SEPARATOR,
        commandEntryFor(component.copyValues, target),
        commandEntryFor(component.pasteValues, target),
    ];
}

function snapKindEntries(commands: EditorCommands, kind: SnapKind): MenuEntry[] {
    return choiceEntries(commands.tools.snapStep, snapStepText, (choice: SnapStepChoice) => choice.kind === kind);
}

export function snapMenu(commands: EditorCommands): MenuEntry[] {
    return SNAP_KINDS.map(kind => submenuEntry(`${SNAP_KIND_LABELS[kind]} step`, snapKindEntries(commands, kind)));
}

export function gameViewAspectMenu(commands: EditorCommands): MenuEntry[] {
    return choiceEntries(commands.view.gameViewAspect, id => gameViewAspectOf(id).label);
}
