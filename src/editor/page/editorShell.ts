import type {Entity} from "../../engine/core";
import type {EditorMode} from "../editorProtocol";
import {closeChoicePopup, showChoicePopup} from "./choicePopup";
import type {MenuEntry} from "./commandMenus";
import {closeCommandPalette, isCommandPaletteOpen, showCommandPalette} from "./commandPalette";
import {CommandRegistry, keyChordOf} from "./commandRegistry";
import type {RegisteredCommand} from "./commandRegistry";
import {ConsoleView} from "./consoleView";
import {DataAssetsView, DIRTY_MARKER} from "./dataAssetsView";
import {createElement, isFocusWithin, isHtmlElement, isTextEntryElement, isValueInputElement, readStorage, visualScaleOf, writeStorage} from "./dom";
import {dockLayoutText, openDockPanels, parseDockLayout} from "./dockLayout";
import type {DockLayout} from "./dockLayout";
import {DockView} from "./dockView";
import type {DockPanel, DockViewHome} from "./dockView";
import type {DockSize} from "./dockGeometry";
import {registerEditorCommands} from "./editorCommands";
import type {EditorCommandHost, EditorCommands, FocusableView} from "./editorCommands";
import {dockTabMenu, editorMenuBar, FILE_MENU_LABEL} from "./editorMenus";
import {DOCK_LAYOUT_STORAGE_KEY, DOCK_PANEL_MINIMUMS, DOCK_PANEL_TITLES, defaultDockLayout, dockPanelHomesOf, dockPanelTitleOf} from "./editorPanels";
import {BrowserFloatingWindowHost} from "./floatingWindows";
import {FollowedElementSize} from "./followedElementSize";
import type {EditorNoticeLevel, EditorSession, EditorShell, EntityRemap, SceneViewSlot, SceneViewSlotWatcher} from "./editorSession";
import {buildToolbar, EditorStatusView} from "./editorToolbar";
import {EditorWorkspace} from "./editorWorkspace";
import {fittedAspectRect, GAME_VIEW_ASPECT_STORAGE_KEY, gameViewAspectOf} from "./gameViewAspect";
import {isLayoutMaximized} from "./gameViewOptions";
import {GameCameraNotice} from "./gameCameraNotice";
import {GameStatsOverlay} from "./gameStatsOverlay";
import {DEFAULT_HANDLE_MODES} from "./handleModes";
import {HierarchyView} from "./hierarchyView";
import type {Key} from "../../engine/input/key";
import type {GenerateProjectReport, PackageResult, TargetReportResult} from "../project/projectServerApi";
import type {ProjectTarget} from "../../engine/project/projectTargets";
import {PROJECT_MANIFEST_FILE} from "../../engine/project/projectManifest";
import {InspectorView} from "./inspectorView";
import {MenuBar} from "./menuBar";
import {closePopupMenu} from "./popupMenu";
import {sceneAndPrefabPaths} from "./projectFiles";
import {ProjectSettingsWindow} from "./projectSettingsWindow";
import {openBuildWindow} from "./buildWindow";
import type {BuildWindow} from "./buildWindow";
import {PreferencesDialog} from "./preferencesDialog";
import {ProjectView} from "./projectView";
import {applyPageUiScale, pageUiScale, storedPageUiScale, windowUiScale} from "./uiScale";
import type {UiScale} from "./uiScale";
import {RotationEulerCache} from "./rotationEulerCache";
import {SceneTabsView} from "./sceneTabsView";
import {SceneView} from "./sceneView";
import {FollowedDocumentVisibility, isSceneViewVisible} from "./sceneViewVisibility";
import {SettingsView} from "./settingsView";
import {showKeyboardShortcuts} from "./shortcutsDialog";
import {UndoHistoryView} from "./undoHistoryView";
import {EDITOR_VIEWPORT_HOOK, PREFAB_BREADCRUMB_HOOK, SCENE_OVERLAY_HOOK, TOOLBAR_HOOK} from "../project/editorUiHooks";
import {DOCK_PANEL_KINDS, FIRST_SCENE_VIEW, GAME_VIEW_ID, isSceneViewId, SCENE_VIEW_KIND} from "../project/dockPanelIds";
import type {DockPanelId, DockPanelKind, SceneViewId} from "../project/dockPanelIds";

export const EDITOR_VIEWPORT_ID = "viewport";
export const UNSAVED_CHANGES_PROMPT = "A scene, a data asset or the project settings have unsaved changes.";

const GAME_VIEW = GAME_VIEW_ID;
const SCENE_FOCUS: FocusableView = SCENE_VIEW_KIND;
const NOT_SHOWN = false;
const PLAY_MODE: EditorMode = "play";
const EDIT_MODE: EditorMode = "edit";
const CANVAS_SELECTOR = "canvas";
const NOT_DISPLAYED = "none";
const CONNECTING_TEXT = "Waiting for the game…";
const ASPECT_FRAMED_CLASS = "aspect-framed";
const GAME_HEADER_TITLE = "The Game view: the game's own camera, input and aspect";
const GAME_HEADER_MENU_HINT = "; right-click it to pick the target the Scene and Game views simulate";
const SCENE_HEADER_TITLE = "The Scene view: the editor camera, picking and gizmos";
const NO_TARGET_LABEL = "";
const FRAME_STYLE_PROPERTIES: readonly string[] = ["inset", "left", "top", "width", "height"];
const FRAME_INSET = "auto";
const PIXELS = "px";
const SETTINGS_PANEL: DockPanelId = "settings";
const ASSETS_PANEL: DockPanelId = "assets";
const CONSOLE_PANEL: DockPanelId = "console";
const OPEN_SCENE_LABEL = "Open scene";
const OPEN_SCENE_PLACEHOLDER = "Search scenes and prefabs";
const NO_SCENES_TEXT = "No scenes or prefabs in the project";
const DEFAULT_SCREEN_SCALE = 1;
const SCREEN_SCALE_REFRESH_MS = 300;
const PANEL_LIST_SEPARATOR = ", ";
const RESIZE_EVENT = "resize";
const CANCEL_ENTITY_PICK_KEY = "Escape";
const CAPTURE = true;

function floatingRefusedText(panels: readonly DockPanelId[]): string {
    const titles = panels.map(dockPanelTitleOf).join(PANEL_LIST_SEPARATOR);
    return `A floating window could not open (the browser blocked the pop-up), so ${titles} went back to the main window. Allow pop-ups for this page to keep floating windows.`;
}

export interface ProjectBuildServices {
    readonly targetReport: (target: ProjectTarget) => Promise<TargetReportResult>;
    readonly packageProject: () => Promise<PackageResult>;
    readonly unavailableReason?: string;
}

export const BUILD_NEEDS_SERVER_REASON = "Building needs the project server: open the project through the dev server or the desktop app";

export interface EditorShellOptions {
    readonly targetLabel?: string;
    readonly closeProject?: () => void;
    readonly generate?: () => Promise<GenerateProjectReport>;
    readonly projectBuild?: ProjectBuildServices;
    readonly keyOfEvent?: (event: KeyboardEvent) => Key | undefined;
}

interface ShellLayout {
    readonly root: HTMLElement;
    readonly menuRow: HTMLElement;
    readonly menuStatus: HTMLElement;
    readonly toolbar: HTMLElement;
    readonly dock: HTMLElement;
    readonly hierarchy: HTMLElement;
    readonly sceneTabs: HTMLElement;
    readonly prefabBreadcrumb: HTMLElement;
    readonly firstScene: SceneViewParts;
    readonly stage: HTMLElement;
    readonly viewport: HTMLElement;
    readonly inspector: HTMLElement;
    readonly projectPanel: HTMLElement;
    readonly consolePanel: HTMLElement;
    readonly historyPanel: HTMLElement;
    readonly settingsPanel: HTMLElement;
    readonly assetsPanel: HTMLElement;
    readonly panels: Readonly<Record<DockPanelKind, HTMLElement>>;
}

interface SceneViewParts {
    readonly panel: HTMLElement;
    readonly stage: HTMLElement;
    readonly viewport: HTMLElement;
    readonly overlay: HTMLCanvasElement;
}

interface SceneViewState {
    readonly view: SceneViewId;
    readonly parts: SceneViewParts;
    readonly document: FollowedDocumentVisibility;
    readonly viewportSize: FollowedElementSize;
    panelShown: boolean;
    shown: boolean;
    controller: SceneView | undefined;
}

interface MountedViews {
    readonly workspace: EditorWorkspace;
    readonly scene: SceneView;
    readonly hierarchy: HierarchyView;
    readonly project: ProjectView;
    readonly settings: SettingsView;
    readonly dataAssets: DataAssetsView;
    readonly rotations: RotationEulerCache;
}

function panel(document: Document, tag: keyof HTMLElementTagNameMap, className: string, ariaLabel: string): HTMLElement {
    const element = createElement(document, tag, className);
    element.setAttribute("aria-label", ariaLabel);
    return element;
}

function buildSceneViewParts(document: Document, view: SceneViewId): SceneViewParts {
    const stage = createElement(document, "div", "editor-stage scene-stage");
    const viewport = panel(document, "div", "editor-viewport scene-viewport", "Scene viewport");
    viewport.setAttribute(EDITOR_VIEWPORT_HOOK, view);
    const overlay = createElement(document, "canvas", "scene-overlay");
    overlay.setAttribute(SCENE_OVERLAY_HOOK, view);
    stage.append(viewport, overlay);
    const scenePanel = panel(document, "section", "editor-view scene-view", `${dockPanelTitleOf(view)} view`);
    scenePanel.append(stage);
    return {panel: scenePanel, stage, viewport, overlay};
}

function buildLayout(body: HTMLElement): ShellLayout {
    const document = body.ownerDocument;
    const root = createElement(document, "div", "editor");
    const menuRow = panel(document, "header", "editor-menubar", "Menu bar and status");
    const menuStatus = createElement(document, "div", "menu-status");
    menuRow.append(menuStatus);
    const toolbar = panel(document, "div", "editor-toolbar", "Toolbar");
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute(TOOLBAR_HOOK, "");
    const dock = panel(document, "div", "dock-root", "Panels");
    const hierarchy = panel(document, "nav", "editor-hierarchy editor-panel", "Hierarchy");
    const sceneTabs = createElement(document, "div", "editor-tabs scene-tabs");
    sceneTabs.setAttribute("role", "tablist");
    sceneTabs.setAttribute("aria-label", "Open scenes and prefabs");
    const prefabBreadcrumb = createElement(document, "nav", "prefab-breadcrumb");
    prefabBreadcrumb.setAttribute("aria-label", "Prefab breadcrumb");
    prefabBreadcrumb.setAttribute(PREFAB_BREADCRUMB_HOOK, "");
    prefabBreadcrumb.hidden = true;
    const firstScene = buildSceneViewParts(document, FIRST_SCENE_VIEW);
    firstScene.panel.prepend(sceneTabs, prefabBreadcrumb);
    const stage = createElement(document, "div", "editor-stage game-stage");
    const viewport = panel(document, "main", "editor-viewport game-viewport", "Game viewport");
    viewport.id = EDITOR_VIEWPORT_ID;
    viewport.setAttribute(EDITOR_VIEWPORT_HOOK, GAME_VIEW);
    stage.append(viewport);
    const gamePanel = panel(document, "section", "editor-view game-view", "Game view");
    gamePanel.append(stage);
    const inspector = panel(document, "aside", "editor-inspector editor-panel", "Inspector");
    const projectPanel = panel(document, "div", "project-panel", "Project");
    const consolePanel = panel(document, "div", "console-panel", "Console");
    const historyPanel = panel(document, "div", "undo-history-panel", "History");
    const settingsPanel = panel(document, "div", "settings-panel", "Settings");
    const assetsPanel = panel(document, "div", "data-assets-panel", "Data Assets");
    root.append(menuRow, toolbar, dock);
    for (const element of [hierarchy, inspector, projectPanel, historyPanel, settingsPanel, assetsPanel]) element.append(createElement(document, "p", "panel-placeholder", CONNECTING_TEXT));
    body.append(root);
    const panels: Readonly<Record<DockPanelKind, HTMLElement>> = {
        hierarchy, inspector, scene: firstScene.panel, game: gamePanel, project: projectPanel, console: consolePanel, history: historyPanel, settings: settingsPanel, assets: assetsPanel,
    };
    return {
        root, menuRow, menuStatus, toolbar, dock, hierarchy, sceneTabs, prefabBreadcrumb, firstScene, stage, viewport,
        inspector, projectPanel, consolePanel, historyPanel, settingsPanel, assetsPanel, panels,
    };
}

type ShellWindow = Window & typeof globalThis;

function windowOf(element: HTMLElement): ShellWindow | null {
    return element.ownerDocument.defaultView;
}

function shownCanvasIn(container: HTMLElement): HTMLCanvasElement | undefined {
    return [...container.querySelectorAll(CANVAS_SELECTOR)].find(canvas => canvas.style.display !== NOT_DISPLAYED);
}

function dispatchResize(element: HTMLElement): void {
    const window = windowOf(element);
    if (window !== null) element.dispatchEvent(new window.Event(RESIZE_EVENT));
}

function observeViewportSize(viewport: HTMLElement): FollowedElementSize {
    return new FollowedElementSize(viewport, () => dispatchResize(viewport));
}

class EditorShellImplementation implements EditorShell {
    public readonly viewport: HTMLElement;
    public readonly commands = new CommandRegistry();
    private readonly document: Document;
    private readonly layout: ShellLayout;
    private readonly dock: DockView;
    private readonly editorCommands: EditorCommands;
    private readonly menuBar: MenuBar;
    private readonly pendingNotices: {readonly level: EditorNoticeLevel, readonly text: string, readonly stack: string | undefined}[] = [];
    private readonly focusValues = new WeakMap<Element, string>();
    private mounted: MountedViews | undefined;
    private gameViewAspectId: string;
    private targetLabel: string;
    private gameTargetMenu: readonly MenuEntry[] | undefined;
    private projectSettings: ProjectSettingsWindow | undefined;
    private buildWindow: BuildWindow | undefined;
    private preferences: PreferencesDialog | undefined;
    private readonly sceneViews = new Map<SceneViewId, SceneViewState>();
    private readonly sceneViewWatchers = new Set<SceneViewSlotWatcher>();
    private activeSceneView: SceneViewId = FIRST_SCENE_VIEW;
    private shownMode: EditorMode | undefined;
    private screenScale = DEFAULT_SCREEN_SCALE;
    private screenScaleTimer: number | undefined;
    private keyDocument: Document | undefined;
    private readonly gameViewSizes: readonly FollowedElementSize[];

    public constructor(body: HTMLElement, private readonly options: EditorShellOptions) {
        this.document = body.ownerDocument;
        const window = this.document.defaultView;
        this.layout = buildLayout(body);
        this.viewport = this.layout.viewport;
        applyPageUiScale(this.document.documentElement, storedPageUiScale(window));
        this.followScreenScale(window);
        this.gameViewAspectId = gameViewAspectOf(readStorage(window, GAME_VIEW_ASPECT_STORAGE_KEY)).id;
        const layout = parseDockLayout(readStorage(window, DOCK_LAYOUT_STORAGE_KEY)) ?? defaultDockLayout(this.dockArea());
        this.gameViewSizes = [observeViewportSize(this.viewport), new FollowedElementSize(this.layout.stage, () => this.applyGameViewAspect())];
        this.registerSceneView(FIRST_SCENE_VIEW, this.layout.firstScene);
        for (const panel of openDockPanels(layout)) {
            if (isSceneViewId(panel) && !this.sceneViews.has(panel)) this.registerSceneView(panel, buildSceneViewParts(this.document, panel));
        }
        this.dock = this.createDock(window, layout);
        for (const state of this.sceneViews.values()) {
            state.document.follow(state.parts.panel.ownerDocument);
            state.viewportSize.follow();
        }
        for (const size of this.gameViewSizes) size.follow();
        this.targetLabel = options.targetLabel ?? NO_TARGET_LABEL;
        this.editorCommands = registerEditorCommands(this.commands, this.commandHost());
        this.menuBar = new MenuBar(this.document, editorMenuBar(this.editorCommands));
        this.layout.menuRow.prepend(this.menuBar.element);
        buildToolbar(this.layout.toolbar, this.editorCommands, {
            gameViewAspectLabel: () => gameViewAspectOf(this.gameViewAspectId).label,
            gameTargetLabel: () => this.targetLabel,
            gameTargetMenu: () => this.gameTargetMenu,
            handleModes: () => this.mounted?.workspace.handleModes ?? DEFAULT_HANDLE_MODES,
        });
        this.installWindowInput(this.document);
        this.installUnloadGuard();
        window?.addEventListener("pagehide", () => this.stopObservingSizes());
    }

    public async mount(session: EditorSession): Promise<void> {
        if (this.mounted !== undefined) {
            await this.replaceSession(session, new Map(this.mounted.workspace.entities.map(summary => [summary.entity, summary.entity])));
            return;
        }
        const workspace = new EditorWorkspace(session, this.document);
        workspace.setDialogDocument(() => this.activeDocument());
        const rotations = new RotationEulerCache();
        new EditorStatusView(this.layout.menuStatus, workspace);
        new SceneTabsView(this.layout.sceneTabs, this.layout.prefabBreadcrumb, workspace, this.editorCommands);
        const hierarchy = new HierarchyView(this.layout.hierarchy, workspace, this.editorCommands);
        new InspectorView(this.layout.inspector, workspace, rotations, this.editorCommands);
        const project = new ProjectView(this.layout.projectPanel, workspace, this.editorCommands, {rebuildsOnCodeChange: this.options.generate !== undefined});
        const consoleView = new ConsoleView(this.layout.consolePanel, workspace);
        consoleView.onCountsChanged(() => this.showConsoleBadge(workspace));
        new UndoHistoryView(this.layout.historyPanel, workspace);
        for (const state of this.sceneViews.values()) this.attachSceneView(state, workspace);
        this.layout.stage.append(new GameCameraNotice(this.document, workspace).element);
        this.layout.stage.append(new GameStatsOverlay(this.document, workspace, this.viewport, () => this.targetLabel).element);
        const settings = new SettingsView(this.layout.settingsPanel, workspace, rotations);
        const dataAssets = new DataAssetsView(this.layout.assetsPanel, workspace, rotations);
        const activeScene = (): SceneView => this.activeSceneController();
        this.mounted = {workspace, hierarchy, project, settings, dataAssets, rotations, get scene() {
            return activeScene();
        }};
        settings.setVisible(this.dock.isShown(SETTINGS_PANEL));
        dataAssets.setVisible(this.dock.isShown(ASSETS_PANEL));
        dataAssets.onDirtyChanged(() => this.showDataAssetsTitle(dataAssets));
        workspace.on("openDataAsset", () => this.revealPanel(ASSETS_PANEL));
        workspace.on("state", () => this.stateChanged(workspace));
        workspace.on("document", () => this.commands.changed());
        workspace.on("handles", () => this.commands.changed());
        workspace.on("entities", () => rotations.retainEntities(new Set(workspace.entities.map(summary => summary.entity))));
        for (const notice of this.pendingNotices.splice(0)) workspace.notice(notice.level, notice.text, notice.stack);
        this.stateChanged(workspace);
        await workspace.start();
        await workspace.scenes.openStartScene();
    }

    public async replaceSession(session: EditorSession, remap: EntityRemap): Promise<void> {
        const mounted = this.mounted;
        if (mounted === undefined) {
            await this.mount(session);
            return;
        }
        const {workspace, project, dataAssets, rotations} = mounted;
        rotations.retainEntities(new Set<Entity>());
        await workspace.replaceSession(session, remap);
        project.rebind();
        dataAssets.rebind();
        for (const state of this.sceneViews.values()) state.controller?.resendCamera();
        workspace.emit("state");
        workspace.emit("document");
    }

    public notice(level: EditorNoticeLevel, text: string, stack?: string): void {
        if (this.mounted === undefined) this.pendingNotices.push({level, text, stack});
        else this.mounted.workspace.notice(level, text, stack);
    }

    public showTargetLabel(text: string): void {
        this.targetLabel = text;
        this.commands.changed();
    }

    public setGameTargetMenu(entries: readonly MenuEntry[]): void {
        this.gameTargetMenu = entries;
        this.dock.setTabTooltip(GAME_VIEW, GAME_HEADER_TITLE + GAME_HEADER_MENU_HINT);
        this.commands.changed();
    }

    public watchSceneViews(watcher: SceneViewSlotWatcher): () => void {
        this.sceneViewWatchers.add(watcher);
        for (const state of this.sceneViews.values()) watcher.opened(this.slotOf(state), state.shown);
        return () => {
            this.sceneViewWatchers.delete(watcher);
        };
    }

    private commandHost(): EditorCommandHost {
        return {
            closeProject: this.options.closeProject,
            views: () => this.mounted,
            showPanel: panel => this.showPanel(panel),
            panelOpen: panel => this.dock.isOpen(panel),
            closePanel: panel => this.dock.closePanel(panel),
            panelMaximized: panel => this.dock.isMaximized(panel),
            toggleMaximized: panel => {
                this.dock.toggleMaximized(panel);
                this.commands.changed();
            },
            addPanelBeside: (panel, besidePanel) => this.addPanelBeside(panel, besidePanel),
            openSceneView: () => this.openSceneView(),
            panelFloating: panel => this.dock.isFloating(panel),
            panelHasOwnWindow: panel => this.dock.hasOwnWindow(panel),
            floatPanel: panel => this.dock.floatPanel(panel),
            dockPanel: panel => this.dock.dockPanel(panel),
            resetLayout: () => this.resetLayout(),
            gameViewAspect: () => this.gameViewAspectId,
            setGameViewAspect: id => this.setGameViewAspect(id),
            textSelected: () => this.activeDocument().getSelection()?.isCollapsed === false,
            entityKeysFocused: () => this.entityKeysFocused(),
            toggleCommandPalette: () => this.toggleCommandPalette(),
            showKeyboardShortcuts: () => showKeyboardShortcuts(this.activeDocument(), this.commands.all()),
            openSceneChooser: () => this.openSceneChooser(),
            openProjectSettings: () => this.openProjectSettings(),
            buildUnavailableReason: () => this.options.projectBuild === undefined ? BUILD_NEEDS_SERVER_REASON : this.options.projectBuild.unavailableReason,
            openBuildWindow: () => this.openBuildWindow(),
            openPreferences: () => this.openPreferences(),
            focusView: view => this.focusView(view),
        };
    }

    private createDock(window: (Window & typeof globalThis) | null, layout: DockLayout): DockView {
        const panels = new Map<DockPanelId, DockPanel>(DOCK_PANEL_KINDS.filter(kind => kind !== SCENE_VIEW_KIND).map(kind => [kind, {
            id: kind,
            title: DOCK_PANEL_TITLES[kind],
            element: this.layout.panels[kind],
            onShown: shown => this.panelShown(kind, shown),
            onMoved: () => this.panelMoved(kind),
        }]));
        for (const state of this.sceneViews.values()) panels.set(state.view, this.sceneViewPanel(state));
        const dock = new DockView(this.layout.dock, layout, {
            panels,
            minimums: DOCK_PANEL_MINIMUMS,
            changed: layout => {
                writeStorage(window, DOCK_LAYOUT_STORAGE_KEY, dockLayoutText(layout));
                this.commands.changed();
            },
            closeRequested: panel => void this.editorCommands.window.closePanel.runWith(panel),
            tabMenu: panel => dockTabMenu(this.editorCommands, panel, this.dock.addablePanels(), panel === GAME_VIEW ? this.gameTargetMenu ?? [] : []),
            homes: dockPanelHomesOf,
            ...(window === null ? {} : {floatingHost: new BrowserFloatingWindowHost(window)}),
            screenScale: () => this.screenScale,
            windowOpened: document => this.installWindowInput(document),
            floatingRefused: panels => this.notice("warn", floatingRefusedText(panels)),
            released: panel => this.panelReleased(panel),
        });
        for (const view of this.sceneViews.keys()) dock.setTabTooltip(view, SCENE_HEADER_TITLE);
        dock.setTabTooltip(GAME_VIEW, GAME_HEADER_TITLE);
        return dock;
    }

    private registerSceneView(view: SceneViewId, parts: SceneViewParts): SceneViewState {
        const state: SceneViewState = {
            view,
            parts,
            document: new FollowedDocumentVisibility(() => this.updateSceneViewShown(state)),
            viewportSize: observeViewportSize(parts.viewport),
            panelShown: NOT_SHOWN,
            shown: NOT_SHOWN,
            controller: undefined,
        };
        this.sceneViews.set(view, state);
        return state;
    }

    private sceneViewPanel(state: SceneViewState): DockPanel {
        const view = state.view;
        return {
            id: view,
            title: dockPanelTitleOf(view),
            element: state.parts.panel,
            onShown: shown => {
                state.panelShown = shown;
                this.updateSceneViewShown(state);
            },
            onMoved: document => this.sceneViewMoved(state, document),
        };
    }

    private attachSceneView(state: SceneViewState, workspace: EditorWorkspace): void {
        const view = state.view;
        const {stage, viewport, overlay} = state.parts;
        state.controller = new SceneView(stage, viewport, overlay, workspace, {
            view,
            activated: () => this.activateSceneView(view),
            isFocusTarget: () => this.focusedSceneView().view === view,
        });
        state.controller.setShown(state.shown);
    }

    private slotOf(state: SceneViewState): SceneViewSlot {
        return {view: state.view, viewport: state.parts.viewport};
    }

    private addSceneView(view: SceneViewId, place: (view: SceneViewId) => void): void {
        if (this.sceneViews.has(view)) {
            place(view);
            this.activateSceneView(view);
            return;
        }
        const state = this.registerSceneView(view, buildSceneViewParts(this.document, view));
        this.dock.addPanel(this.sceneViewPanel(state));
        this.dock.setTabTooltip(view, SCENE_HEADER_TITLE);
        place(view);
        state.document.follow(state.parts.panel.ownerDocument);
        state.viewportSize.follow();
        const workspace = this.mounted?.workspace;
        if (workspace !== undefined) this.attachSceneView(state, workspace);
        for (const watcher of [...this.sceneViewWatchers]) watcher.opened(this.slotOf(state), state.shown);
        this.activateSceneView(view);
    }

    private addPanelBeside(panel: DockPanelId, besidePanel: DockPanelId): void {
        if (isSceneViewId(panel)) this.addSceneView(panel, view => this.dock.addPanelBeside(view, besidePanel));
        else this.dock.addPanelBeside(panel, besidePanel);
    }

    private openSceneView(): void {
        const view = this.dock.addablePanels().find(isSceneViewId);
        if (view === undefined) return;
        this.addSceneView(view, added => this.dock.revealPanel(added, this.newSceneViewHomes(added)));
        this.focusView(SCENE_FOCUS);
    }

    private newSceneViewHomes(view: SceneViewId): DockViewHome[] {
        const beside = this.focusedSceneView().view;
        const homes = dockPanelHomesOf(view);
        return beside !== view && this.dock.isOpen(beside) ? [{withPanel: beside}, ...homes] : [...homes];
    }

    private panelReleased(panel: DockPanelId): void {
        if (!isSceneViewId(panel)) return;
        const state = this.sceneViews.get(panel);
        if (state === undefined) return;
        this.sceneViews.delete(panel);
        state.controller?.forgetCamera();
        state.controller?.dispose();
        state.document.dispose();
        state.viewportSize.dispose();
        if (this.activeSceneView === panel) this.activeSceneView = FIRST_SCENE_VIEW;
        for (const watcher of [...this.sceneViewWatchers]) watcher.closed(panel);
        this.commands.changed();
    }

    private activateSceneView(view: SceneViewId): void {
        if (view === this.activeSceneView || !this.sceneViews.has(view)) return;
        this.activeSceneView = view;
        this.commands.changed();
    }

    private focusedSceneView(): SceneViewState {
        const active = this.sceneViews.get(this.activeSceneView);
        const first = this.sceneViews.get(FIRST_SCENE_VIEW)!;
        return active !== undefined && this.dock.isOpen(active.view) ? active : first;
    }

    private activeSceneController(): SceneView {
        return this.focusedSceneView().controller ?? this.sceneViews.get(FIRST_SCENE_VIEW)!.controller!;
    }

    private isSceneOverlay(element: Element | null): boolean {
        return [...this.sceneViews.values()].some(state => state.parts.overlay === element);
    }

    private dockArea(): DockSize {
        const dock = this.layout.dock;
        return {widthPx: dock.clientWidth, heightPx: dock.clientHeight};
    }

    private panelShown(panel: DockPanelKind, shown: boolean): void {
        if (panel === SETTINGS_PANEL) this.mounted?.settings.setVisible(shown);
        else if (panel === ASSETS_PANEL) this.mounted?.dataAssets.setVisible(shown);
    }

    private panelMoved(panel: DockPanelKind): void {
        if (panel !== GAME_VIEW) return;
        for (const size of this.gameViewSizes) size.follow();
        dispatchResize(this.viewport);
        this.applyGameViewAspect();
    }

    private sceneViewMoved(state: SceneViewState, document: Document): void {
        state.document.follow(document);
        state.viewportSize.follow();
        dispatchResize(state.parts.viewport);
        state.controller?.relocated();
    }

    private revealPanel(panel: DockPanelId): void {
        this.dock.revealPanel(panel, dockPanelHomesOf(panel));
    }

    private showPanel(panel: DockPanelKind): void {
        if (panel === SCENE_VIEW_KIND || panel === GAME_VIEW) {
            this.focusView(panel);
            return;
        }
        this.revealPanel(panel);
        this.dock.focusPanel(panel);
    }

    private resetLayout(): void {
        this.dock.setLayout(defaultDockLayout(this.dockArea()));
    }

    private stateChanged(workspace: EditorWorkspace): void {
        this.layout.toolbar.dataset.mode = workspace.mode;
        this.dock.setForcedPanel(isLayoutMaximized(workspace.gameViewOptions, workspace.mode) ? GAME_VIEW : undefined);
        for (const state of this.sceneViews.values()) this.updateSceneViewShown(state);
        this.moveFocusWithMode(workspace.mode);
        this.applyGameViewAspect();
        this.commands.changed();
    }

    private updateSceneViewShown(state: SceneViewState): void {
        const workspace = this.mounted?.workspace;
        const shown = isSceneViewVisible({
            panelShown: state.panelShown,
            layoutShowsSceneView: workspace === undefined || workspace.sceneViewShown,
            documentVisible: state.document.visible,
        });
        if (shown === state.shown) return;
        state.shown = shown;
        state.controller?.setShown(shown);
        for (const watcher of [...this.sceneViewWatchers]) watcher.shown(state.view, shown);
    }

    private moveFocusWithMode(mode: EditorMode): void {
        const previous = this.shownMode;
        this.shownMode = mode;
        if (previous === undefined || previous === mode) return;
        if (mode === PLAY_MODE) this.focusView(GAME_VIEW);
        else if (mode === EDIT_MODE && isFocusWithin(this.viewport) && this.dock.isOpen(this.focusedSceneView().view)) this.focusView(SCENE_FOCUS);
    }

    private focusView(view: FocusableView): void {
        if (view === SCENE_FOCUS) {
            const scene = this.focusedSceneView();
            this.revealPanel(scene.view);
            scene.parts.overlay.focus();
            return;
        }
        this.revealPanel(GAME_VIEW);
        shownCanvasIn(this.viewport)?.focus();
    }

    private setGameViewAspect(id: string): void {
        this.gameViewAspectId = gameViewAspectOf(id).id;
        writeStorage(this.document.defaultView, GAME_VIEW_ASPECT_STORAGE_KEY, this.gameViewAspectId);
        this.applyGameViewAspect();
        this.commands.changed();
    }

    private applyGameViewAspect(): void {
        const widthToHeight = gameViewAspectOf(this.gameViewAspectId).widthToHeight;
        const stage = this.layout.stage;
        const style = this.viewport.style;
        const framed = widthToHeight !== undefined;
        stage.classList.toggle(ASPECT_FRAMED_CLASS, framed);
        if (!framed) {
            for (const property of FRAME_STYLE_PROPERTIES) style.removeProperty(property);
            return;
        }
        const bounds = stage.getBoundingClientRect();
        const scale = visualScaleOf(stage);
        const frame = fittedAspectRect(bounds.width / scale, bounds.height / scale, widthToHeight);
        style.setProperty("inset", FRAME_INSET);
        style.setProperty("left", `${frame.left}${PIXELS}`);
        style.setProperty("top", `${frame.top}${PIXELS}`);
        style.setProperty("width", `${frame.width}${PIXELS}`);
        style.setProperty("height", `${frame.height}${PIXELS}`);
    }

    private toggleCommandPalette(): void {
        const document = this.activeDocument();
        if (isCommandPaletteOpen(document)) closeCommandPalette(document);
        else showCommandPalette(document, this.commands);
    }

    private activeDocument(): Document {
        return this.keyDocument ?? this.dock.documents().find(document => document.hasFocus()) ?? this.document;
    }

    private focusMainWindow(): void {
        this.document.defaultView?.focus();
    }

    private followScreenScale(window: (Window & typeof globalThis) | null): void {
        if (window === null) return;
        const refresh = async (): Promise<boolean> => {
            const scale = await windowUiScale((path, init) => window.fetch(path, init));
            this.screenScale = scale?.factor ?? DEFAULT_SCREEN_SCALE;
            return scale !== undefined;
        };
        void refresh().then(scalesWindow => {
            if (!scalesWindow) return;
            window.addEventListener("resize", () => {
                if (this.screenScaleTimer !== undefined) window.clearTimeout(this.screenScaleTimer);
                this.screenScaleTimer = window.setTimeout(() => {
                    this.screenScaleTimer = undefined;
                    void refresh();
                }, SCREEN_SCALE_REFRESH_MS);
            });
        });
    }

    private openSceneChooser(): void {
        const workspace = this.mounted?.workspace;
        if (workspace === undefined) return;
        const anchor = this.menuBar.buttonOf(FILE_MENU_LABEL) ?? this.layout.menuRow;
        showChoicePopup(this.document, anchor, {
            ariaLabel: OPEN_SCENE_LABEL,
            searchPlaceholder: OPEN_SCENE_PLACEHOLDER,
            emptyText: NO_SCENES_TEXT,
            loadChoices: async () => sceneAndPrefabPaths(await workspace.session.files.list()).map(path => ({label: path, value: path, key: path})),
            choose: path => void workspace.scenes.open(path),
        });
    }

    private openProjectSettings(): void {
        const workspace = this.mounted?.workspace;
        if (workspace === undefined) return;
        this.focusMainWindow();
        if (this.projectSettings !== undefined) {
            this.projectSettings.focus();
            return;
        }
        const generate = this.options.generate;
        this.projectSettings = ProjectSettingsWindow.open({
            document: this.document,
            services: {
                files: () => workspace.session.files,
                report: (level, text) => workspace.notice(level, text),
                manifestSaved: () => workspace.scenes.manifestChanged(),
                ...(generate === undefined ? {} : {generate}),
            },
            typeNames: () => [...workspace.schemas.keys(), ...workspace.resourceSchemas.keys()].sort((a, b) => a.localeCompare(b)),
            ...(this.options.keyOfEvent === undefined ? {} : {keyOfEvent: this.options.keyOfEvent}),
            onFilesChanged: listener => workspace.session.files.onChange(listener),
        }, () => {
            this.projectSettings = undefined;
        });
    }

    private openBuildWindow(): void {
        const workspace = this.mounted?.workspace;
        const projectBuild = this.options.projectBuild;
        if (workspace === undefined || projectBuild === undefined) return;
        this.focusMainWindow();
        if (this.buildWindow !== undefined) {
            this.buildWindow.focus();
            return;
        }
        this.buildWindow = openBuildWindow({
            document: this.document,
            services: {
                readManifest: () => workspace.session.files.readText(PROJECT_MANIFEST_FILE),
                targetReport: projectBuild.targetReport,
                packageProject: projectBuild.packageProject,
                log: (level, text) => workspace.log(level, text),
            },
            ...(projectBuild.unavailableReason === undefined ? {} : {unavailableReason: projectBuild.unavailableReason}),
        }, () => {
            this.buildWindow = undefined;
        });
    }

    private openPreferences(): void {
        this.focusMainWindow();
        if (this.preferences !== undefined) {
            this.preferences.focus();
            return;
        }
        this.preferences = PreferencesDialog.open({
            document: this.document,
            uiScale: () => this.uiScale(),
            snapSteps: () => this.mounted?.workspace.snapSteps,
            setSnapStep: choice => this.mounted?.workspace.setSnapStep(choice),
        }, () => {
            this.preferences = undefined;
        });
    }

    private async uiScale(): Promise<UiScale> {
        const window = this.document.defaultView;
        const scalesWindow = window === null ? undefined : await windowUiScale((path, init) => window.fetch(path, init));
        return scalesWindow ?? pageUiScale(this.document.documentElement, window);
    }

    private showDataAssetsTitle(dataAssets: DataAssetsView): void {
        this.dock.setTabTitle(ASSETS_PANEL, DOCK_PANEL_TITLES.assets + (dataAssets.dirty ? DIRTY_MARKER : ""));
    }

    private showConsoleBadge(workspace: EditorWorkspace): void {
        const counts = workspace.consoleLog.levelCounts;
        const problems = counts.error + counts.warn;
        const title = DOCK_PANEL_TITLES.console;
        this.dock.setTabTitle(CONSOLE_PANEL, problems === 0 ? title : `${title} (${problems})`);
        this.dock.setTabAlert(CONSOLE_PANEL, counts.error > 0);
    }

    private hasUnsavedChanges(): boolean {
        const mounted = this.mounted;
        return mounted !== undefined && (mounted.workspace.scenes.dirty || mounted.dataAssets.dirty || this.projectSettings?.dirty === true);
    }

    private installUnloadGuard(): void {
        this.document.defaultView?.addEventListener("beforeunload", event => {
            if (!this.hasUnsavedChanges()) return;
            event.preventDefault();
            event.returnValue = UNSAVED_CHANGES_PROMPT;
        });
    }

    private stopObservingSizes(): void {
        for (const size of this.gameViewSizes) size.dispose();
        for (const state of this.sceneViews.values()) state.viewportSize.dispose();
    }

    private installWindowInput(document: Document): void {
        document.addEventListener("focusin", event => {
            const target = event.target;
            if (isValueInputElement(target)) this.focusValues.set(target, target.value);
        });
        document.addEventListener("keydown", event => this.cancelEntityPickOn(event), CAPTURE);
        document.addEventListener("keydown", event => this.onKeyDown(event, document));
        document.addEventListener("pointerdown", () => this.closePopupsOutside(document), CAPTURE);
    }

    private cancelEntityPickOn(event: KeyboardEvent): void {
        const workspace = this.mounted?.workspace;
        if (event.key === CANCEL_ENTITY_PICK_KEY && workspace?.pickingEntity === true) workspace.cancelEntityPick();
    }

    private closePopupsOutside(document: Document): void {
        for (const other of this.dock.documents()) {
            if (other === document) continue;
            closePopupMenu(other);
            closeChoicePopup(other);
            closeCommandPalette(other);
        }
    }

    private entityKeysFocused(): boolean {
        const document = this.activeDocument();
        const active = document.activeElement;
        return active === null || active === document.body || this.isSceneOverlay(active) || this.layout.hierarchy.contains(active);
    }

    private hasTextEdits(element: Element): boolean {
        if (!isValueInputElement(element)) return false;
        return this.focusValues.get(element) !== element.value;
    }

    private onKeyDown(event: KeyboardEvent, document: Document): void {
        if (event.defaultPrevented) return;
        const active = document.activeElement;
        if (active !== null && this.viewport.contains(active)) return;
        this.keyDocument = document;
        try {
            const resolution = this.commands.resolveKey(keyChordOf(event), {
                inTextEntry: isTextEntryElement(active),
                textEdited: active !== null && this.hasTextEdits(active),
            });
            if (resolution.kind !== "bound") return;
            event.preventDefault();
            if (resolution.leavesTextEntry && isHtmlElement(active)) active.blur();
            if (resolution.command.runAlone() || event.repeat || !resolution.command.explainsWhenDisabled()) return;
            this.explainUnavailable(resolution.command);
        } finally {
            this.keyDocument = undefined;
        }
    }

    private explainUnavailable(command: RegisteredCommand): void {
        const state = command.stateAlone();
        const workspace = this.mounted?.workspace;
        if (workspace === undefined || workspace.closed || state.reason === undefined) return;
        workspace.notice(state.planned ? "info" : "warn", `${state.label}: ${state.reason}`);
    }
}

export function createEditorShell(body: HTMLElement, options: EditorShellOptions = {}): EditorShell {
    return new EditorShellImplementation(body, options);
}
