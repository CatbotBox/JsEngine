import type {Entity} from "../../engine/core";
import type {EditorMode, EditorView} from "../editorProtocol";
import {showChoicePopup} from "./choicePopup";
import type {MenuEntry} from "./commandMenus";
import {closeCommandPalette, isCommandPaletteOpen, showCommandPalette} from "./commandPalette";
import {CommandRegistry, keyChordOf} from "./commandRegistry";
import type {RegisteredCommand} from "./commandRegistry";
import {ConsoleView} from "./consoleView";
import {DataAssetsView, DIRTY_MARKER} from "./dataAssetsView";
import {createElement, isHtmlElement, isTextEntryElement, isValueInputElement, readStorage, visualScaleOf, writeStorage} from "./dom";
import {dockLayoutText, parseDockLayout} from "./dockLayout";
import type {DockPanelId} from "./dockLayout";
import {DockView} from "./dockView";
import type {DockPanel} from "./dockView";
import type {DockSize} from "./dockGeometry";
import {registerEditorCommands} from "./editorCommands";
import type {EditorCommandHost, EditorCommands} from "./editorCommands";
import {dockTabMenu, editorMenuBar, FILE_MENU_LABEL} from "./editorMenus";
import {canFloatPanel, DOCK_LAYOUT_STORAGE_KEY, DOCK_PANEL_HOMES, DOCK_PANEL_MINIMUMS, DOCK_PANEL_TITLES, defaultDockLayout} from "./editorPanels";
import {BrowserFloatingWindowHost} from "./floatingWindows";
import type {EditorNoticeLevel, EditorSession, EditorShell, EntityRemap} from "./editorSession";
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
import {SettingsView} from "./settingsView";
import {showKeyboardShortcuts} from "./shortcutsDialog";
import {UndoHistoryView} from "./undoHistoryView";
import {DOCK_PANEL_IDS, EDITOR_VIEWPORT_HOOK, PREFAB_BREADCRUMB_HOOK, TOOLBAR_HOOK} from "../project/editorUiHooks";

export const EDITOR_VIEWPORT_ID = "viewport";
export const UNSAVED_CHANGES_PROMPT = "A scene, a data asset or the project settings have unsaved changes.";

const SCENE_VIEW: EditorView = "scene";
const GAME_VIEW: EditorView = "game";
const SCENE_VIEW_SHOWN_AT_START = true;
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

function floatingRefusedText(panels: readonly DockPanelId[]): string {
    const titles = panels.map(panel => DOCK_PANEL_TITLES[panel]).join(PANEL_LIST_SEPARATOR);
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
    readonly sceneStage: HTMLElement;
    readonly sceneViewport: HTMLElement;
    readonly stage: HTMLElement;
    readonly viewport: HTMLElement;
    readonly overlay: HTMLCanvasElement;
    readonly inspector: HTMLElement;
    readonly projectPanel: HTMLElement;
    readonly consolePanel: HTMLElement;
    readonly historyPanel: HTMLElement;
    readonly settingsPanel: HTMLElement;
    readonly assetsPanel: HTMLElement;
    readonly panels: Readonly<Record<DockPanelId, HTMLElement>>;
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
    const sceneStage = createElement(document, "div", "editor-stage scene-stage");
    const sceneViewport = panel(document, "div", "editor-viewport scene-viewport", "Scene viewport");
    sceneViewport.setAttribute(EDITOR_VIEWPORT_HOOK, SCENE_VIEW);
    const overlay = createElement(document, "canvas", "scene-overlay");
    sceneStage.append(sceneViewport, overlay);
    const scenePanel = panel(document, "section", "editor-view scene-view", "Scene view");
    scenePanel.append(sceneTabs, prefabBreadcrumb, sceneStage);
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
    const panels: Readonly<Record<DockPanelId, HTMLElement>> = {
        hierarchy, inspector, scene: scenePanel, game: gamePanel, project: projectPanel, console: consolePanel, history: historyPanel, settings: settingsPanel, assets: assetsPanel,
    };
    return {
        root, menuRow, menuStatus, toolbar, dock, hierarchy, sceneTabs, prefabBreadcrumb, sceneStage, sceneViewport, stage, viewport, overlay,
        inspector, projectPanel, consolePanel, historyPanel, settingsPanel, assetsPanel, panels,
    };
}

function onSizeChange(element: HTMLElement, changed: () => void): void {
    const window = element.ownerDocument.defaultView;
    if (window === null || typeof window.ResizeObserver !== "function") return;
    let width = -1;
    let height = -1;
    let scheduled = false;
    new window.ResizeObserver(() => {
        const bounds = element.getBoundingClientRect();
        if (bounds.width === width && bounds.height === height) return;
        width = bounds.width;
        height = bounds.height;
        if (scheduled) return;
        scheduled = true;
        window.requestAnimationFrame(() => {
            scheduled = false;
            changed();
        });
    }).observe(element);
}

function shownCanvasIn(container: HTMLElement): HTMLCanvasElement | undefined {
    return [...container.querySelectorAll(CANVAS_SELECTOR)].find(canvas => canvas.style.display !== NOT_DISPLAYED);
}

function observeViewportSize(viewport: HTMLElement): void {
    const window = viewport.ownerDocument.defaultView;
    onSizeChange(viewport, () => window?.dispatchEvent(new window.Event("resize")));
}

class EditorShellImplementation implements EditorShell {
    public readonly viewport: HTMLElement;
    public readonly sceneViewport: HTMLElement;
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
    private readonly sceneViewShownListeners = new Set<(shown: boolean) => void>();
    private sceneViewShown = SCENE_VIEW_SHOWN_AT_START;
    private sceneViewDocked = SCENE_VIEW_SHOWN_AT_START;
    private shownMode: EditorMode | undefined;
    private screenScale = DEFAULT_SCREEN_SCALE;
    private screenScaleTimer: number | undefined;
    private keyDocument: Document | undefined;

    public constructor(body: HTMLElement, private readonly options: EditorShellOptions) {
        this.document = body.ownerDocument;
        const window = this.document.defaultView;
        this.layout = buildLayout(body);
        this.viewport = this.layout.viewport;
        this.sceneViewport = this.layout.sceneViewport;
        applyPageUiScale(this.document.documentElement, storedPageUiScale(window));
        this.followScreenScale(window);
        this.dock = this.createDock(window);
        observeViewportSize(this.viewport);
        observeViewportSize(this.sceneViewport);
        onSizeChange(this.layout.stage, () => this.applyGameViewAspect());
        this.gameViewAspectId = gameViewAspectOf(readStorage(window, GAME_VIEW_ASPECT_STORAGE_KEY)).id;
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
        this.installKeyboard(this.document);
        this.installUnloadGuard();
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
        const scene = new SceneView(this.layout.sceneStage, this.sceneViewport, this.layout.overlay, workspace);
        this.layout.stage.append(new GameCameraNotice(this.document, workspace).element);
        this.layout.stage.append(new GameStatsOverlay(this.document, workspace, this.viewport, () => this.targetLabel).element);
        const settings = new SettingsView(this.layout.settingsPanel, workspace, rotations);
        const dataAssets = new DataAssetsView(this.layout.assetsPanel, workspace, rotations);
        this.mounted = {workspace, scene, hierarchy, project, settings, dataAssets, rotations};
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
        const {workspace, scene, project, dataAssets, rotations} = mounted;
        rotations.retainEntities(new Set<Entity>());
        await workspace.replaceSession(session, remap);
        project.rebind();
        dataAssets.rebind();
        scene.resendCamera();
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

    public onSceneViewShown(listener: (shown: boolean) => void): () => void {
        const entry = (shown: boolean): void => listener(shown);
        this.sceneViewShownListeners.add(entry);
        if (this.sceneViewShown !== SCENE_VIEW_SHOWN_AT_START) entry(this.sceneViewShown);
        return () => {
            this.sceneViewShownListeners.delete(entry);
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
            addPanelBeside: (panel, besidePanel) => this.dock.addPanelBeside(panel, besidePanel),
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

    private createDock(window: (Window & typeof globalThis) | null): DockView {
        const panels = new Map<DockPanelId, DockPanel>(DOCK_PANEL_IDS.map(id => [id, {
            id,
            title: DOCK_PANEL_TITLES[id],
            element: this.layout.panels[id],
            onShown: shown => this.panelShown(id, shown),
        }]));
        const dock = new DockView(this.layout.dock, parseDockLayout(readStorage(window, DOCK_LAYOUT_STORAGE_KEY)) ?? defaultDockLayout(this.dockArea()), {
            panels,
            minimums: DOCK_PANEL_MINIMUMS,
            changed: layout => {
                writeStorage(window, DOCK_LAYOUT_STORAGE_KEY, dockLayoutText(layout));
                this.commands.changed();
            },
            closeRequested: panel => void this.editorCommands.window.closePanel.runWith(panel),
            tabMenu: panel => dockTabMenu(this.editorCommands, panel, this.dock.closedPanels(), panel === GAME_VIEW ? this.gameTargetMenu ?? [] : []),
            homes: panel => DOCK_PANEL_HOMES[panel],
            ...(window === null ? {} : {floatingHost: new BrowserFloatingWindowHost(window)}),
            canFloat: canFloatPanel,
            screenScale: () => this.screenScale,
            windowOpened: document => this.installKeyboard(document),
            floatingRefused: panels => this.notice("warn", floatingRefusedText(panels)),
        });
        dock.setTabTooltip(SCENE_VIEW, SCENE_HEADER_TITLE);
        dock.setTabTooltip(GAME_VIEW, GAME_HEADER_TITLE);
        return dock;
    }

    private dockArea(): DockSize {
        const dock = this.layout.dock;
        return {widthPx: dock.clientWidth, heightPx: dock.clientHeight};
    }

    private panelShown(panel: DockPanelId, shown: boolean): void {
        if (panel === SETTINGS_PANEL) this.mounted?.settings.setVisible(shown);
        else if (panel === ASSETS_PANEL) this.mounted?.dataAssets.setVisible(shown);
        else if (panel === SCENE_VIEW) {
            this.sceneViewDocked = shown;
            this.updateSceneViewShown();
        }
    }

    private revealPanel(panel: DockPanelId): void {
        this.dock.revealPanel(panel, DOCK_PANEL_HOMES[panel]);
    }

    private showPanel(panel: DockPanelId): void {
        if (panel === SCENE_VIEW || panel === GAME_VIEW) {
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
        this.updateSceneViewShown();
        this.moveFocusWithMode(workspace.mode);
        this.applyGameViewAspect();
        this.commands.changed();
    }

    private updateSceneViewShown(): void {
        const workspace = this.mounted?.workspace;
        this.showSceneViewShown(this.sceneViewDocked && (workspace === undefined || workspace.sceneViewShown));
    }

    private showSceneViewShown(shown: boolean): void {
        if (shown === this.sceneViewShown) return;
        this.sceneViewShown = shown;
        for (const listener of [...this.sceneViewShownListeners]) listener(shown);
    }

    private moveFocusWithMode(mode: EditorMode): void {
        const previous = this.shownMode;
        this.shownMode = mode;
        if (previous === undefined || previous === mode) return;
        if (mode === PLAY_MODE) this.focusView(GAME_VIEW);
        else if (mode === EDIT_MODE && this.viewport.contains(this.document.activeElement) && this.dock.isOpen(SCENE_VIEW)) this.focusView(SCENE_VIEW);
    }

    private focusView(view: EditorView): void {
        this.revealPanel(view);
        if (view === SCENE_VIEW) {
            this.layout.overlay.focus();
            return;
        }
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

    private installKeyboard(document: Document): void {
        document.addEventListener("focusin", event => {
            const target = event.target;
            if (isValueInputElement(target)) this.focusValues.set(target, target.value);
        });
        document.addEventListener("keydown", event => this.onKeyDown(event, document));
    }

    private entityKeysFocused(): boolean {
        const document = this.activeDocument();
        const active = document.activeElement;
        return active === null || active === document.body || active === this.layout.overlay || this.layout.hierarchy.contains(active);
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
