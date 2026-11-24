import type {Entity} from "../../engine/core";
import type {EditorComponentDetails, EditorView} from "../editorProtocol";
import type {Command, CommandRegistry, CommandSpec, VoidCommandSpec} from "./commandRegistry";
import type {DataAssetsView} from "./dataAssetsView";
import type {DockPanelId} from "./dockLayout";
import {DOCK_PANEL_TITLES} from "./editorPanels";
import {EDITOR_TOOLS} from "./editorTools";
import type {EditorTool} from "./editorTools";
import type {EditorWorkspace} from "./editorWorkspace";
import {ENTITY_TEMPLATE_NAMES} from "./entityTemplates";
import type {EntityTemplate} from "./entityTemplates";
import {GAME_VIEW_ASPECTS, gameViewAspectOf} from "./gameViewAspect";
import {handleRotationProblem, withHandlePositionToggled, withHandleRotationToggled} from "./handleModes";
import {GAME_VIEW_OPTION_LABELS, GAME_VIEW_OPTIONS} from "./gameViewOptions";
import type {GameViewOption} from "./gameViewOptions";
import type {HierarchyView} from "./hierarchyView";
import type {ImageFieldTarget} from "./imageExtraction";
import {UNPARENT_TARGET} from "./hierarchyDrop";
import {normalizeProjectPath, opensInEditor, projectFileKind, ROOT_FOLDER_PATH} from "./projectFiles";
import type {ProjectFileKind} from "./projectFiles";
import {LAST_LOADED_SCENE_REASON, PREFAB_TAB_SCENES_REASON} from "./sceneDocuments";
import type {EditorSceneTab, SceneDocuments} from "./sceneDocuments";
import type {SceneEntry} from "./sceneTabs";
import {EXTERNAL_EDITOR_UNAVAILABLE_TEXT} from "./projectPreview";
import type {ProjectView} from "./projectView";
import type {SceneView} from "./sceneView";
import {SNAP_KIND_LABELS, snapStepChoices, snapStepText} from "./snapSteps";
import type {SnapStepChoice} from "./snapSteps";
import {DOCK_PANEL_IDS} from "../project/editorUiHooks";

export interface EditorCommandViews {
    readonly workspace: EditorWorkspace;
    readonly scene: SceneView;
    readonly hierarchy: HierarchyView;
    readonly project: ProjectView;
    readonly dataAssets: DataAssetsView;
}

export interface EditorCommandHost {
    readonly closeProject: (() => void) | undefined;

    views(): EditorCommandViews | undefined;

    showPanel(panel: DockPanelId): void;

    panelOpen(panel: DockPanelId): boolean;

    closePanel(panel: DockPanelId): void;

    panelMaximized(panel: DockPanelId): boolean;

    toggleMaximized(panel: DockPanelId): void;

    addPanelBeside(panel: DockPanelId, besidePanel: DockPanelId): void;

    resetLayout(): void;

    gameViewAspect(): string;

    setGameViewAspect(id: string): void;

    textSelected(): boolean;

    entityKeysFocused(): boolean;

    toggleCommandPalette(): void;

    showKeyboardShortcuts(): void;

    openSceneChooser(): void;

    openProjectSettings(): void;

    buildUnavailableReason(): string | undefined;

    openBuildWindow(): void;

    openPreferences(): void;

    focusView(view: EditorView): void;
}

export interface DataAssetCreation {
    readonly folder: string;
    readonly typeName: string;
}

export interface DockPanelAddition {
    readonly panel: DockPanelId;
    readonly beside: DockPanelId;
}

export interface ProjectItem {
    readonly path: string;
    readonly kind: ProjectFileKind;
}

export interface ComponentTarget {
    readonly entities: readonly Entity[];
    readonly typeName: string;
    readonly first: EditorComponentDetails | undefined;
    readonly resettable: boolean;
}

export interface FileCommands {
    readonly newScene: Command<void>;
    readonly openScene: Command<void>;
    readonly openRecent: Command<string>;
    readonly clearRecent: Command<void>;
    readonly save: Command<void>;
    readonly saveAs: Command<void>;
    readonly saveAll: Command<void>;
    readonly setStartScene: Command<string | undefined>;
    readonly projectSettings: Command<void>;
    readonly build: Command<void>;
    readonly closeProject: Command<void>;
}

export interface SceneCommands {
    readonly setActive: Command<SceneEntry>;
    readonly save: Command<SceneEntry>;
    readonly saveAs: Command<SceneEntry>;
    readonly load: Command<SceneEntry>;
    readonly unload: Command<SceneEntry>;
    readonly remove: Command<SceneEntry>;
    readonly closeTab: Command<EditorSceneTab>;
}

export interface EditCommands {
    readonly undo: Command<void>;
    readonly redo: Command<void>;
    readonly undoHistory: Command<void>;
    readonly cut: Command<readonly Entity[]>;
    readonly copy: Command<readonly Entity[]>;
    readonly paste: Command<void>;
    readonly duplicate: Command<readonly Entity[]>;
    readonly rename: Command<Entity | undefined>;
    readonly remove: Command<readonly Entity[]>;
    readonly selectAll: Command<void>;
    readonly frameSelected: Command<void>;
    readonly preferences: Command<void>;
}

export interface AssetCommands {
    readonly createFolder: Command<string>;
    readonly createScene: Command<string>;
    readonly createPrefab: Command<string>;
    readonly createScript: Command<string>;
    readonly createDataAsset: Command<DataAssetCreation>;
    readonly showInExplorer: Command<string>;
    readonly refresh: Command<void>;
    readonly open: Command<ProjectItem>;
    readonly openSceneAdditive: Command<string>;
    readonly addToScene: Command<string>;
    readonly rename: Command<string>;
    readonly duplicate: Command<readonly string[]>;
    readonly remove: Command<readonly string[]>;
}

export interface EntityCommands {
    readonly createEmpty: Command<void>;
    readonly createEmptyChild: Command<Entity | undefined>;
    readonly createCamera: Command<void>;
    readonly createSprite: Command<void>;
    readonly createText: Command<void>;
    readonly createMesh: Command<void>;
    readonly createDirectionalLight: Command<void>;
    readonly createPointLight: Command<void>;
    readonly createAmbientLight: Command<void>;
}

export interface PlayCommands {
    readonly play: Command<void>;
    readonly pause: Command<void>;
    readonly step: Command<void>;
}

export interface ToolCommands {
    readonly tools: Readonly<Record<EditorTool, Command<void>>>;
    readonly handlePosition: Command<void>;
    readonly handleRotation: Command<void>;
    readonly snap: Command<void>;
    readonly snapStep: Command<SnapStepChoice>;
}

export interface ViewCommands {
    readonly views: Readonly<Record<EditorView, Command<void>>>;
    readonly gameViewAspect: Command<string>;
    readonly gameViewOptions: Readonly<Record<GameViewOption, Command<void>>>;
}

export interface WindowCommands {
    readonly panels: Readonly<Record<DockPanelId, Command<void>>>;
    readonly closePanel: Command<DockPanelId>;
    readonly maximizePanel: Command<DockPanelId>;
    readonly addPanel: Command<DockPanelAddition>;
    readonly resetLayout: Command<void>;
}

export interface HelpCommands {
    readonly commandPalette: Command<void>;
    readonly keyboardShortcuts: Command<void>;
}

export interface ComponentCommands {
    readonly reset: Command<ComponentTarget>;
    readonly remove: Command<ComponentTarget>;
    readonly copyValues: Command<ComponentTarget>;
    readonly pasteValues: Command<ComponentTarget>;
    readonly extractImage: Command<ImageFieldTarget>;
    readonly inlinePattern: Command<ImageFieldTarget>;
}

export interface EditorCommands {
    readonly registry: CommandRegistry;
    readonly file: FileCommands;
    readonly scene: SceneCommands;
    readonly edit: EditCommands;
    readonly assets: AssetCommands;
    readonly entity: EntityCommands;
    readonly play: PlayCommands;
    readonly tools: ToolCommands;
    readonly view: ViewCommands;
    readonly window: WindowCommands;
    readonly help: HelpCommands;
    readonly component: ComponentCommands;
}

export const FILE_CATEGORY = "File";
export const SCENE_CATEGORY = "Scene";
export const EDIT_CATEGORY = "Edit";
export const ASSETS_CATEGORY = "Assets";
export const ENTITY_CATEGORY = "Entity";
export const PLAY_CATEGORY = "Play";
export const TOOLS_CATEGORY = "Tools";
export const SNAP_CATEGORY = "Snap";
export const VIEW_CATEGORY = "View";
export const GAME_VIEW_CATEGORY = "Game View";
export const WINDOW_CATEGORY = "Window";
export const HELP_CATEGORY = "Help";
export const COMPONENT_CATEGORY = "Component";
export const WAITING_REASON = "Waiting for the game…";
export const SESSION_ENDED_REASON = "The editor session ended";
export const NOTHING_SELECTED_REASON = "Nothing is selected";
export const SHOW_IN_EXPLORER_UNAVAILABLE_REASON = "Show in Explorer needs the desktop app; a browser page cannot open the file manager";
export const NOTHING_SELECTED_IN_PROJECT_REASON = "No files are selected in the Project panel";
export const CLOSE_PROJECT_UNAVAILABLE_REASON = "This editor page cannot return to the start screen";
export const STOP_GAME_REASON = "Stop the game first; scenes change only while editing";
export const NO_RECENT_SCENES_REASON = "No recent scenes";
export const UNSAVED_START_SCENE_REASON = "Save the scene first; the start scene is a file";
export const PREFAB_START_SCENE_REASON = "A prefab cannot be the start scene";
export const ALREADY_START_SCENE_REASON = "Already the start scene";
export const LAST_TAB_REASON = "The last tab stays open";
export const EXTRACT_ONE_ENTITY_REASON = "Select one entity; each inline image is extracted to its own file";
export const INLINE_ONE_ENTITY_REASON = "Select one entity; a pattern file is inlined into one entity at a time";
export const PANEL_CLOSED_REASON = "The panel is closed";
export const PANEL_ALREADY_OPEN_REASON = "The panel is already open";

const SAVE_WHILE_PLAYING_REASON = "The scene can only be saved while editing; stop the game first";
const UNDO_WHILE_PLAYING_REASON = "Undo is not available while the game runs; stop it first";
const REDO_WHILE_PLAYING_REASON = "Redo is not available while the game runs; stop it first";
const NOTHING_TO_UNDO_REASON = "Nothing to undo";
const NOTHING_TO_REDO_REASON = "Nothing to redo";
const EMPTY_CLIPBOARD_REASON = "Nothing copied yet";
const NO_ENTITIES_REASON = "The scene has no entities";
const NO_PARENT_REASON = "Select the parent entity first";
const FRAME_NEEDS_SCENE_VIEW_REASON = "Frame Selected works in the Scene view, which is hidden while the game view is maximized";
const SCENE_VIEW_HIDDEN_REASON = "The Scene view is hidden while the game view is maximized";
const NOT_RESETTABLE_REASON = "This component has required entity fields, so it has no default to reset to";
const NO_COMPONENT_VALUES_REASON = "Nothing to copy yet";
const NO_COPIED_VALUES_REASON = "No component values copied";
const UNDO_LABEL = "Undo";
const REDO_LABEL = "Redo";
const HISTORY_PANEL: DockPanelId = "history";
const PLAY_LABEL = "Play";
const STOP_LABEL = "Stop";
const OPEN_LABEL = "Open";
const OPEN_RECENT_LABEL = "Open Recent";
const NOT_A_SCENE_REASON = "Only a scene file opens as a scene";
const ALREADY_OPEN_REASON = "This scene is already open";
const NOT_LOADED_REASON = "The scene is not loaded; load it first";
const ALREADY_LOADED_REASON = "The scene is already loaded";
const NO_FILE_REASON = "The scene has no file to load from";
const ALREADY_ACTIVE_REASON = "Already the active scene";
const OPEN_IN_EDITOR_LABEL = "Open in Editor";
const VIEW_LABELS: Readonly<Record<EditorView, string>> = {scene: "Focus Scene View", game: "Focus Game View"};
const VIEW_ORDER: readonly EditorView[] = ["scene", "game"];
const TOOL_LABELS: Readonly<Record<EditorTool, string>> = {hand: "Hand", move: "Move", rotate: "Rotate", scale: "Scale"};
const TOOL_SHORTCUTS: Readonly<Record<EditorTool, string>> = {hand: "Q", move: "W", rotate: "E", scale: "R"};

function recordOf<K extends string, V>(keys: readonly K[], valueOf: (key: K) => V): Record<K, V> {
    return Object.fromEntries(keys.map(key => [key, valueOf(key)])) as Record<K, V>;
}

function sessionProblem(views: EditorCommandViews | undefined): string | undefined {
    if (views === undefined) return WAITING_REASON;
    return views.workspace.closed ? SESSION_ENDED_REASON : undefined;
}

function worldStoppedReason(workspace: EditorWorkspace): string | undefined {
    const error = workspace.worldStoppedError;
    return error === null ? undefined : `World stopped: ${error}. Load a scene to reset it.`;
}

function selectionProblem(entities: readonly Entity[]): string | undefined {
    return entities.length === 0 ? NOTHING_SELECTED_REASON : undefined;
}

function editingProblem(workspace: EditorWorkspace): string | undefined {
    return workspace.mode === "edit" ? undefined : STOP_GAME_REASON;
}

function isActiveEntry(scenes: SceneDocuments, entry: SceneEntry): boolean {
    return entry.loaded && entry.sceneId !== null && entry.sceneId === scenes.worldScenes.activeSceneId;
}

function startSceneTarget(scenes: SceneDocuments): string | undefined {
    if (scenes.activeTab.kind !== "scene") return undefined;
    return scenes.activeEntry()?.path ?? undefined;
}

function startSceneProblem(scenes: SceneDocuments, path: string | undefined): string | undefined {
    if (path === undefined) return scenes.activeTab.kind === "prefab" ? PREFAB_START_SCENE_REASON : UNSAVED_START_SCENE_REASON;
    const kind = projectFileKind(path);
    if (kind !== "scene") return kind === "prefab" ? PREFAB_START_SCENE_REASON : NOT_A_SCENE_REASON;
    return scenes.startScene === normalizeProjectPath(path) ? ALREADY_START_SCENE_REASON : undefined;
}

function sceneEntryProblem(scenes: SceneDocuments, entry: SceneEntry, needsLoaded: boolean): string | undefined {
    if (!scenes.activeTab.scenes.includes(entry)) return NOT_LOADED_REASON;
    return needsLoaded && !entry.loaded ? NOT_LOADED_REASON : undefined;
}

function unloadProblem(scenes: SceneDocuments, entry: SceneEntry): string | undefined {
    const tab = scenes.activeTab;
    if (tab.kind === "prefab") return PREFAB_TAB_SCENES_REASON;
    return entry.loaded && tab.loadedScenes().every(other => other === entry) ? LAST_LOADED_SCENE_REASON : undefined;
}

function additiveProblem(scenes: SceneDocuments, path: string): string | undefined {
    if (projectFileKind(path) !== "scene") return NOT_A_SCENE_REASON;
    if (scenes.activeTab.kind === "prefab") return PREFAB_TAB_SCENES_REASON;
    return scenes.tabs.tabHolding(path) === undefined ? undefined : ALREADY_OPEN_REASON;
}

export function registerEditorCommands(registry: CommandRegistry, host: EditorCommandHost): EditorCommands {
    const mounted = (): EditorCommandViews => {
        const views = host.views();
        if (views === undefined) throw new Error(WAITING_REASON);
        return views;
    };
    const blocked = (): string | undefined => sessionProblem(host.views());
    const whenOpen = (problem: (views: EditorCommandViews) => string | undefined) => (): string | undefined => {
        const views = host.views();
        return sessionProblem(views) ?? (views === undefined ? undefined : problem(views));
    };
    const selection = (): readonly Entity[] => host.views()?.workspace.selection ?? [];
    const primary = (): Entity | undefined => host.views()?.workspace.primary;
    const currentFolder = (): string => host.views()?.project.currentFolder ?? ROOT_FOLDER_PATH;
    const selectedPaths = (): readonly string[] => host.views()?.project.selectedPaths ?? [];
    const shownPath = (): string => {
        const selected = selectedPaths();
        return selected[selected.length - 1] ?? currentFolder();
    };
    const playing = (): boolean => host.views()?.workspace.recording === false;
    const action = (id: string, category: string, label: string, run: (views: EditorCommandViews) => void, extra: Partial<VoidCommandSpec> = {}): Command<void> =>
        registry.add({id, category, label, disabledReason: blocked, run: () => run(mounted()), ...extra});

    const editing = whenOpen(({workspace}) => editingProblem(workspace));
    const scenes = (): SceneDocuments => mounted().workspace.scenes;
    const file: FileCommands = {
        newScene: action("file.newScene", FILE_CATEGORY, "New Scene", ({workspace}) => void workspace.scenes.newScene(), {
            shortcuts: ["Ctrl+N"],
            disabledReason: editing,
            explainsWhenDisabled: playing,
        }),
        openScene: action("file.openScene", FILE_CATEGORY, "Open Scene…", () => host.openSceneChooser(), {
            shortcuts: ["Ctrl+O"],
            disabledReason: editing,
            explainsWhenDisabled: playing,
        }),
        openRecent: registry.addTargeted<string>({
            id: "file.openRecent", category: FILE_CATEGORY, label: OPEN_RECENT_LABEL,
            labelFor: path => `${OPEN_RECENT_LABEL}: ${path}`,
            choices: () => host.views()?.workspace.scenes.recentScenes() ?? [],
            disabledReason: () => editing(),
            run: path => void scenes().openRecent(path),
        }),
        clearRecent: action("file.clearRecentScenes", FILE_CATEGORY, "Clear Recent Scenes", ({workspace}) => {
            workspace.scenes.clearRecentScenes();
            registry.changed();
        }, {
            disabledReason: whenOpen(({workspace}) => workspace.scenes.recentScenes().length === 0 ? NO_RECENT_SCENES_REASON : undefined),
        }),
        save: action("file.save", FILE_CATEGORY, "Save", ({workspace, dataAssets}) => {
            if (dataAssets.hasFocus()) void dataAssets.save();
            else void workspace.scenes.save();
        }, {
            shortcuts: ["Ctrl+S"],
            inTextEntry: "allowed",
            disabledReason: whenOpen(({workspace, dataAssets}) => dataAssets.hasFocus() || workspace.recording ? undefined : SAVE_WHILE_PLAYING_REASON),
            explainsWhenDisabled: playing,
        }),
        saveAs: action("file.saveAs", FILE_CATEGORY, "Save As…", ({workspace}) => void workspace.scenes.saveAs(), {
            shortcuts: ["Ctrl+Shift+S"],
            disabledReason: whenOpen(({workspace}) => workspace.recording ? undefined : SAVE_WHILE_PLAYING_REASON),
            explainsWhenDisabled: playing,
        }),
        saveAll: action("file.saveAll", FILE_CATEGORY, "Save All", ({workspace, dataAssets}) => void (async () => {
            if (dataAssets.dirty) await dataAssets.save();
            await workspace.scenes.saveAll();
        })(), {
            disabledReason: whenOpen(({workspace}) => workspace.recording ? undefined : SAVE_WHILE_PLAYING_REASON),
            explainsWhenDisabled: playing,
        }),
        setStartScene: registry.addTargeted<string | undefined>({
            id: "file.setStartScene", category: FILE_CATEGORY, label: "Set as Start Scene",
            target: () => {
                const views = host.views();
                return views === undefined ? undefined : startSceneTarget(views.workspace.scenes);
            },
            checked: path => {
                const start = host.views()?.workspace.scenes.startScene;
                return path !== undefined && start !== undefined && start === normalizeProjectPath(path);
            },
            disabledReason: path => blocked() ?? startSceneProblem(scenes(), path),
            run: path => {
                if (path !== undefined) void scenes().setStartScene(path);
            },
        }),
        projectSettings: action("file.projectSettings", FILE_CATEGORY, "Project Settings…", () => host.openProjectSettings()),
        build: action("file.build", FILE_CATEGORY, "Build…", () => host.openBuildWindow(), {
            shortcuts: ["Ctrl+Shift+B"],
            disabledReason: () => blocked() ?? host.buildUnavailableReason(),
        }),
        closeProject: registry.add({
            id: "file.closeProject",
            category: FILE_CATEGORY,
            label: "Close Project",
            disabledReason: () => host.closeProject === undefined ? CLOSE_PROJECT_UNAVAILABLE_REASON : undefined,
            run: () => host.closeProject?.(),
        }),
    };

    const sceneCommand = (
        id: string,
        label: string,
        problem: (documents: SceneDocuments, entry: SceneEntry) => string | undefined,
        run: (documents: SceneDocuments, entry: SceneEntry) => void,
        extra: Partial<CommandSpec<SceneEntry>> = {},
    ): Command<SceneEntry> => registry.addTargeted<SceneEntry>({
        id,
        category: SCENE_CATEGORY,
        label,
        disabledReason: entry => editing() ?? problem(scenes(), entry),
        run: entry => run(scenes(), entry),
        ...extra,
    });
    const scene: SceneCommands = {
        setActive: sceneCommand("scene.setActive", "Set Active Scene", (documents, entry) => {
            const problem = sceneEntryProblem(documents, entry, true);
            return problem ?? (isActiveEntry(documents, entry) ? ALREADY_ACTIVE_REASON : undefined);
        }, (documents, entry) => void documents.setActiveScene(entry), {
            checked: entry => {
                const views = host.views();
                return views !== undefined && isActiveEntry(views.workspace.scenes, entry);
            },
        }),
        save: sceneCommand("scene.save", "Save Scene", (documents, entry) => sceneEntryProblem(documents, entry, true), (documents, entry) => void documents.saveEntry(entry)),
        saveAs: sceneCommand("scene.saveAs", "Save Scene As…", (documents, entry) => sceneEntryProblem(documents, entry, true), (documents, entry) => void documents.saveEntryAs(entry)),
        load: sceneCommand("scene.load", "Load Scene", (documents, entry) => {
            const problem = sceneEntryProblem(documents, entry, false);
            if (problem !== undefined) return problem;
            if (entry.loaded) return ALREADY_LOADED_REASON;
            return entry.path === null ? NO_FILE_REASON : undefined;
        }, (documents, entry) => void documents.loadScene(entry)),
        unload: sceneCommand("scene.unload", "Unload Scene", (documents, entry) => sceneEntryProblem(documents, entry, true) ?? unloadProblem(documents, entry),
            (documents, entry) => void documents.unloadScene(entry, false)),
        remove: sceneCommand("scene.remove", "Remove Scene", (documents, entry) => sceneEntryProblem(documents, entry, false) ?? unloadProblem(documents, entry),
            (documents, entry) => void documents.unloadScene(entry, true)),
        closeTab: registry.addTargeted<EditorSceneTab>({
            id: "scene.closeTab", category: SCENE_CATEGORY, label: "Close Tab",
            disabledReason: tab => blocked() ?? (scenes().tabs.tabs.length <= 1 || !scenes().tabs.tabs.includes(tab) ? LAST_TAB_REASON : undefined),
            run: tab => void scenes().closeTab(tab),
        }),
    };

    const edit: EditCommands = {
        undo: action("edit.undo", EDIT_CATEGORY, UNDO_LABEL, ({workspace}) => void workspace.undoLast(), {
            labelFor: () => {
                const label = host.views()?.workspace.undo.undoLabel;
                return label === undefined ? UNDO_LABEL : `${UNDO_LABEL} ${label}`;
            },
            shortcuts: ["Ctrl+Z"],
            inTextEntry: "allowedWithoutEdits",
            disabledReason: whenOpen(({workspace}) => !workspace.recording ? UNDO_WHILE_PLAYING_REASON : workspace.undo.canUndo ? undefined : NOTHING_TO_UNDO_REASON),
            explainsWhenDisabled: playing,
        }),
        redo: action("edit.redo", EDIT_CATEGORY, REDO_LABEL, ({workspace}) => void workspace.redoLast(), {
            labelFor: () => {
                const label = host.views()?.workspace.undo.redoLabel;
                return label === undefined ? REDO_LABEL : `${REDO_LABEL} ${label}`;
            },
            shortcuts: ["Ctrl+Y", "Ctrl+Shift+Z"],
            inTextEntry: "allowedWithoutEdits",
            disabledReason: whenOpen(({workspace}) => !workspace.recording ? REDO_WHILE_PLAYING_REASON : workspace.undo.canRedo ? undefined : NOTHING_TO_REDO_REASON),
            explainsWhenDisabled: playing,
        }),
        undoHistory: registry.add({id: "edit.undoHistory", category: EDIT_CATEGORY, label: "Undo History", run: () => host.showPanel(HISTORY_PANEL)}),
        cut: registry.addTargeted<readonly Entity[]>({
            id: "edit.cut", category: EDIT_CATEGORY, label: "Cut", shortcuts: ["Ctrl+X"], target: selection,
            disabledReason: entities => blocked() ?? selectionProblem(entities),
            run: entities => void mounted().workspace.cut(entities),
        }),
        copy: registry.addTargeted<readonly Entity[]>({
            id: "edit.copy", category: EDIT_CATEGORY, label: "Copy", shortcuts: ["Ctrl+C"], target: selection, yieldsKey: () => host.textSelected(),
            disabledReason: entities => blocked() ?? selectionProblem(entities),
            run: entities => void mounted().workspace.copy(entities),
        }),
        paste: action("edit.paste", EDIT_CATEGORY, "Paste", ({workspace}) => void workspace.paste(), {
            shortcuts: ["Ctrl+V"],
            disabledReason: whenOpen(({workspace}) => workspace.entityClipboard === undefined ? EMPTY_CLIPBOARD_REASON : undefined),
        }),
        duplicate: registry.addTargeted<readonly Entity[]>({
            id: "edit.duplicate", category: EDIT_CATEGORY, label: "Duplicate", shortcuts: ["Ctrl+D"], target: selection,
            disabledReason: entities => blocked() ?? selectionProblem(entities),
            run: entities => void mounted().workspace.duplicate(entities),
        }),
        rename: registry.addTargeted<Entity | undefined>({
            id: "edit.rename", category: EDIT_CATEGORY, label: "Rename", shortcuts: ["F2"], target: primary,
            disabledReason: entity => blocked() ?? (entity === undefined ? NOTHING_SELECTED_REASON : undefined),
            run: entity => {
                if (entity !== undefined) mounted().hierarchy.beginRename(entity);
            },
        }),
        remove: registry.addTargeted<readonly Entity[]>({
            id: "edit.delete", category: EDIT_CATEGORY, label: "Delete", shortcuts: ["Delete"], target: selection,
            disabledReason: entities => blocked() ?? selectionProblem(entities),
            run: entities => void mounted().workspace.destroy(entities),
        }),
        selectAll: action("edit.selectAll", EDIT_CATEGORY, "Select All", ({workspace}) => workspace.select(workspace.entities.map(summary => summary.entity)), {
            shortcuts: ["Ctrl+A"],
            yieldsKey: () => !host.entityKeysFocused(),
            disabledReason: whenOpen(({workspace}) => workspace.entities.length === 0 ? NO_ENTITIES_REASON : undefined),
        }),
        frameSelected: action("edit.frameSelected", EDIT_CATEGORY, "Frame Selected", ({scene}) => void scene.focusSelection(), {
            shortcuts: ["F"],
            disabledReason: whenOpen(({workspace}) => {
                if (workspace.selection.length === 0) return NOTHING_SELECTED_REASON;
                return workspace.sceneViewShown ? undefined : FRAME_NEEDS_SCENE_VIEW_REASON;
            }),
        }),
        preferences: registry.add({id: "edit.preferences", category: EDIT_CATEGORY, label: "Preferences…", run: () => host.openPreferences()}),
    };

    const assets: AssetCommands = {
        createFolder: registry.addTargeted<string>({
            id: "assets.createFolder", category: ASSETS_CATEGORY, label: "Create Folder", target: currentFolder, disabledReason: blocked,
            run: folder => void mounted().project.createFolder(folder),
        }),
        createScene: registry.addTargeted<string>({
            id: "assets.createScene", category: ASSETS_CATEGORY, label: "Create Scene", target: currentFolder, disabledReason: blocked,
            run: folder => void mounted().project.createScene(folder),
        }),
        createPrefab: registry.addTargeted<string>({
            id: "assets.createPrefab", category: ASSETS_CATEGORY, label: "Create Prefab", target: currentFolder, disabledReason: blocked,
            run: folder => void mounted().project.createPrefab(folder),
        }),
        createScript: registry.addTargeted<string>({
            id: "assets.createScript", category: ASSETS_CATEGORY, label: "Create Script", target: currentFolder, disabledReason: blocked,
            run: folder => void mounted().project.createScript(folder),
        }),
        createDataAsset: registry.addTargeted<DataAssetCreation>({
            id: "assets.createDataAsset", category: ASSETS_CATEGORY, label: "Create Data Asset",
            labelFor: creation => `Create ${creation.typeName} Data Asset`,
            choices: () => {
                const folder = currentFolder();
                return (host.views()?.workspace.dataAssetTypeNames() ?? []).map(typeName => ({folder, typeName}));
            },
            disabledReason: blocked,
            run: creation => void mounted().project.createDataAsset(creation.folder, creation.typeName),
        }),
        showInExplorer: registry.addTargeted<string>({
            id: "assets.showInExplorer", category: ASSETS_CATEGORY, label: "Show in Explorer", target: shownPath,
            disabledReason: () => blocked() ?? (mounted().workspace.session.files.showInFolder === undefined ? SHOW_IN_EXPLORER_UNAVAILABLE_REASON : undefined),
            run: path => void mounted().project.showInExplorer(path),
        }),
        refresh: action("assets.refresh", ASSETS_CATEGORY, "Refresh", ({project}) => void project.reload()),
        openSceneAdditive: registry.addTargeted<string>({
            id: "assets.openSceneAdditive", category: ASSETS_CATEGORY, label: "Open Scene Additive",
            disabledReason: path => editing() ?? additiveProblem(scenes(), path),
            run: path => void scenes().openSceneAdditive(path),
        }),
        open: registry.addTargeted<ProjectItem>({
            id: "assets.open", category: ASSETS_CATEGORY, label: OPEN_LABEL,
            labelFor: item => opensInEditor(item.kind) ? OPEN_LABEL : OPEN_IN_EDITOR_LABEL,
            disabledReason: item => blocked() ?? (opensInEditor(item.kind) || mounted().workspace.session.files.openExternally !== undefined ? undefined : EXTERNAL_EDITOR_UNAVAILABLE_TEXT),
            run: item => mounted().project.open(item.path, item.kind),
        }),
        addToScene: registry.addTargeted<string>({
            id: "assets.addToScene", category: ASSETS_CATEGORY, label: "Add to Scene", disabledReason: blocked,
            run: path => void mounted().workspace.instantiateAsset(path, {target: UNPARENT_TARGET}),
        }),
        rename: registry.addTargeted<string>({
            id: "assets.rename", category: ASSETS_CATEGORY, label: "Rename", disabledReason: blocked,
            run: path => void mounted().project.rename(path),
        }),
        duplicate: registry.addTargeted<readonly string[]>({
            id: "assets.duplicate", category: ASSETS_CATEGORY, label: "Duplicate", target: selectedPaths,
            labelFor: paths => paths.length > 1 ? `Duplicate ${paths.length} items` : "Duplicate",
            disabledReason: paths => blocked() ?? (paths.length === 0 ? NOTHING_SELECTED_IN_PROJECT_REASON : undefined),
            run: paths => void mounted().project.duplicate(paths),
        }),
        remove: registry.addTargeted<readonly string[]>({
            id: "assets.delete", category: ASSETS_CATEGORY, label: "Delete", target: selectedPaths,
            labelFor: paths => paths.length > 1 ? `Delete ${paths.length} items` : "Delete",
            disabledReason: paths => blocked() ?? (paths.length === 0 ? NOTHING_SELECTED_IN_PROJECT_REASON : undefined),
            run: paths => void mounted().project.remove(paths),
        }),
    };

    const template = (id: string, kind: EntityTemplate): Command<void> => action(id, ENTITY_CATEGORY, `Create ${ENTITY_TEMPLATE_NAMES[kind]}`, ({workspace}) => void workspace.createFromTemplate(kind), {
        disabledReason: whenOpen(({workspace}) => workspace.templateProblem(kind)),
    });
    const entity: EntityCommands = {
        createEmpty: action("entity.createEmpty", ENTITY_CATEGORY, "Create Empty", ({workspace}) => void workspace.createEmpty(null)),
        createEmptyChild: registry.addTargeted<Entity | undefined>({
            id: "entity.createEmptyChild", category: ENTITY_CATEGORY, label: "Create Empty Child", target: primary,
            disabledReason: parent => blocked() ?? (parent === undefined ? NO_PARENT_REASON : undefined),
            run: parent => {
                if (parent !== undefined) void mounted().workspace.createEmpty(parent);
            },
        }),
        createCamera: template("entity.createCamera", "camera"),
        createSprite: template("entity.createSprite", "sprite"),
        createText: template("entity.createText", "text"),
        createMesh: template("entity.createMesh", "mesh"),
        createDirectionalLight: template("entity.createDirectionalLight", "directionalLight"),
        createPointLight: template("entity.createPointLight", "pointLight"),
        createAmbientLight: template("entity.createAmbientLight", "ambientLight"),
    };

    const play: PlayCommands = {
        play: action("play.play", PLAY_CATEGORY, PLAY_LABEL, ({workspace}) => void workspace.setMode(workspace.mode === "edit" ? "play" : "edit"), {
            labelFor: () => (host.views()?.workspace.mode ?? "edit") === "edit" ? PLAY_LABEL : STOP_LABEL,
            shortcuts: ["Ctrl+P"],
            checked: () => (host.views()?.workspace.mode ?? "edit") !== "edit",
            disabledReason: whenOpen(({workspace}) => workspace.mode === "edit" ? worldStoppedReason(workspace) : undefined),
        }),
        pause: action("play.pause", PLAY_CATEGORY, "Pause", ({workspace}) => void workspace.setMode(workspace.mode === "paused" ? "play" : "paused"), {
            checked: () => host.views()?.workspace.mode === "paused",
            disabledReason: whenOpen(({workspace}) => worldStoppedReason(workspace)),
        }),
        step: action("play.step", PLAY_CATEGORY, "Step", ({workspace}) => void workspace.step(), {
            disabledReason: whenOpen(({workspace}) => worldStoppedReason(workspace)),
        }),
    };

    const tools: ToolCommands = {
        tools: recordOf(EDITOR_TOOLS, tool => action(`tools.${tool}`, TOOLS_CATEGORY, TOOL_LABELS[tool], ({workspace}) => workspace.setTool(tool), {
            shortcuts: [TOOL_SHORTCUTS[tool]],
            checked: () => host.views()?.workspace.tool === tool,
            yieldsKey: () => host.views()?.scene.capturesKeys === true,
        })),
        handlePosition: action("tools.togglePivotCenter", TOOLS_CATEGORY, "Toggle Pivot/Center", ({workspace}) => workspace.setHandleModes(withHandlePositionToggled(workspace.handleModes))),
        handleRotation: action("tools.toggleLocalGlobal", TOOLS_CATEGORY, "Toggle Local/Global Handles", ({workspace}) => workspace.setHandleModes(withHandleRotationToggled(workspace.handleModes)), {
            disabledReason: whenOpen(({workspace, scene}) => handleRotationProblem(workspace.tool, scene.selectionRotated)),
        }),
        snap: action("tools.toggleSnap", SNAP_CATEGORY, "Snap", ({workspace}) => workspace.setSnapEnabled(!workspace.snapEnabled), {
            checked: () => host.views()?.workspace.snapEnabled === true,
        }),
        snapStep: registry.addTargeted<SnapStepChoice>({
            id: "tools.snapStep", category: SNAP_CATEGORY, label: "Snap Step",
            labelFor: choice => `${SNAP_KIND_LABELS[choice.kind]} step ${snapStepText(choice)}`,
            choices: snapStepChoices,
            checked: choice => host.views()?.workspace.snapSteps[choice.kind] === choice.step,
            disabledReason: blocked,
            run: choice => mounted().workspace.setSnapStep(choice),
        }),
    };

    const view: ViewCommands = {
        views: recordOf(VIEW_ORDER, shown => action(`view.${shown}`, VIEW_CATEGORY, VIEW_LABELS[shown], () => host.focusView(shown), {
            disabledReason: whenOpen(({workspace}) => shown === "scene" && !workspace.sceneViewShown ? SCENE_VIEW_HIDDEN_REASON : undefined),
        })),
        gameViewAspect: registry.addTargeted<string>({
            id: "view.gameViewAspect", category: GAME_VIEW_CATEGORY, label: "Aspect",
            labelFor: id => `Aspect ${gameViewAspectOf(id).label}`,
            choices: () => GAME_VIEW_ASPECTS.map(aspect => aspect.id),
            checked: id => host.gameViewAspect() === id,
            run: id => host.setGameViewAspect(id),
        }),
        gameViewOptions: recordOf(GAME_VIEW_OPTIONS, option => action(`view.${option}`, GAME_VIEW_CATEGORY, GAME_VIEW_OPTION_LABELS[option], ({workspace}) => {
            workspace.setGameViewOption({option, enabled: !workspace.gameViewOptions[option]});
        }, {
            checked: () => host.views()?.workspace.gameViewOptions[option] === true,
        })),
    };

    const openPanelProblem = (panel: DockPanelId): string | undefined => host.panelOpen(panel) ? undefined : PANEL_CLOSED_REASON;
    const windowCommands: WindowCommands = {
        panels: recordOf(DOCK_PANEL_IDS, panel => registry.add({
            id: `window.${panel}`,
            category: WINDOW_CATEGORY,
            label: DOCK_PANEL_TITLES[panel],
            run: () => host.showPanel(panel),
        })),
        closePanel: registry.addTargeted<DockPanelId>({
            id: "window.closeTab", category: WINDOW_CATEGORY, label: "Close Tab",
            disabledReason: openPanelProblem,
            run: panel => host.closePanel(panel),
        }),
        maximizePanel: registry.addTargeted<DockPanelId>({
            id: "window.maximize", category: WINDOW_CATEGORY, label: "Maximize",
            checked: panel => host.panelMaximized(panel),
            disabledReason: openPanelProblem,
            run: panel => host.toggleMaximized(panel),
        }),
        addPanel: registry.addTargeted<DockPanelAddition>({
            id: "window.addTab", category: WINDOW_CATEGORY, label: "Add Tab",
            labelFor: addition => DOCK_PANEL_TITLES[addition.panel],
            disabledReason: addition => host.panelOpen(addition.panel) ? PANEL_ALREADY_OPEN_REASON : openPanelProblem(addition.beside),
            run: addition => host.addPanelBeside(addition.panel, addition.beside),
        }),
        resetLayout: registry.add({id: "window.resetLayout", category: WINDOW_CATEGORY, label: "Reset Layout", run: () => host.resetLayout()}),
    };

    const help: HelpCommands = {
        commandPalette: registry.add({id: "help.commandPalette", category: HELP_CATEGORY, label: "Command Palette…", shortcuts: ["Ctrl+Shift+P"], inTextEntry: "allowed", run: () => host.toggleCommandPalette()}),
        keyboardShortcuts: registry.add({id: "help.keyboardShortcuts", category: HELP_CATEGORY, label: "Keyboard Shortcuts", run: () => host.showKeyboardShortcuts()}),
    };

    const component: ComponentCommands = {
        reset: registry.addTargeted<ComponentTarget>({
            id: "component.reset", category: COMPONENT_CATEGORY, label: "Reset",
            disabledReason: target => blocked() ?? (target.resettable ? undefined : NOT_RESETTABLE_REASON),
            run: target => void mounted().workspace.resetComponent(target.entities, target.typeName),
        }),
        remove: registry.addTargeted<ComponentTarget>({
            id: "component.remove", category: COMPONENT_CATEGORY, label: "Remove Component", disabledReason: blocked,
            run: target => void mounted().workspace.removeComponent(target.entities, target.typeName),
        }),
        copyValues: registry.addTargeted<ComponentTarget>({
            id: "component.copyValues", category: COMPONENT_CATEGORY, label: "Copy Component Values",
            disabledReason: target => blocked() ?? (target.first === undefined ? NO_COMPONENT_VALUES_REASON : undefined),
            run: target => {
                if (target.first !== undefined) mounted().workspace.copyComponentValues(target.first);
            },
        }),
        pasteValues: registry.addTargeted<ComponentTarget>({
            id: "component.pasteValues", category: COMPONENT_CATEGORY, label: "Paste Component Values",
            disabledReason: target => {
                const problem = blocked();
                if (problem !== undefined) return problem;
                const copied = mounted().workspace.componentClipboard;
                if (copied === undefined) return NO_COPIED_VALUES_REASON;
                return copied.typeName === target.typeName ? undefined : `The copied values are for ${copied.typeName}`;
            },
            run: target => void mounted().workspace.pasteComponentValues(target.entities, target.typeName),
        }),
        extractImage: registry.addTargeted<ImageFieldTarget>({
            id: "component.extractImage", category: COMPONENT_CATEGORY, label: "Extract to File…",
            labelFor: target => `Extract ${target.key} to File…`,
            disabledReason: target => blocked() ?? editingProblem(mounted().workspace) ?? (target.entities.length === 1 ? undefined : EXTRACT_ONE_ENTITY_REASON),
            run: target => void mounted().workspace.extractInlineImage(target.entities[0], target.typeName, target.key),
        }),
        inlinePattern: registry.addTargeted<ImageFieldTarget>({
            id: "component.inlinePattern", category: COMPONENT_CATEGORY, label: "Inline Pattern File",
            labelFor: target => `Inline ${target.key} Pattern File`,
            disabledReason: target => blocked() ?? editingProblem(mounted().workspace) ?? (target.entities.length === 1 ? undefined : INLINE_ONE_ENTITY_REASON),
            run: target => void mounted().workspace.inlinePatternFile(target.entities[0], target.typeName, target.key),
        }),
    };

    return {registry, file, scene, edit, assets, entity, play, tools, view, window: windowCommands, help, component};
}
