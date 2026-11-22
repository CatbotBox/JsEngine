import type {Entity} from "../../engine/core";
import type {EditorView} from "../editorProtocol";
import {showChoicePopup} from "./choicePopup";
import {showCommandMenu} from "./commandMenus";
import type {MenuEntry} from "./commandMenus";
import {closeCommandPalette, isCommandPaletteOpen, showCommandPalette} from "./commandPalette";
import {CommandRegistry, keyChordOf} from "./commandRegistry";
import type {RegisteredCommand} from "./commandRegistry";
import {ConsoleView} from "./consoleView";
import {DataAssetsView, DIRTY_MARKER} from "./dataAssetsView";
import {capturePointer, createButton, createElement, isTextEntryElement, readStorage, visualScaleOf, writeStorage} from "./dom";
import {registerEditorCommands} from "./editorCommands";
import type {EditorCommandHost, EditorCommands} from "./editorCommands";
import {editorMenuBar, FILE_MENU_LABEL} from "./editorMenus";
import {BOTTOM_TAB_LABELS, BOTTOM_TABS, DEFAULT_BOTTOM_TAB} from "./editorPanels";
import type {BottomTab} from "./editorPanels";
import type {EditorNoticeLevel, EditorSession, EditorShell, EntityRemap} from "./editorSession";
import {buildToolbar, EditorStatusView} from "./editorToolbar";
import {EditorWorkspace} from "./editorWorkspace";
import {fittedAspectRect, GAME_VIEW_ASPECT_STORAGE_KEY, gameViewAspectOf} from "./gameViewAspect";
import {isLayoutMaximized} from "./gameViewOptions";
import {GameStatsOverlay} from "./gameStatsOverlay";
import {DEFAULT_HANDLE_MODES} from "./handleModes";
import {HierarchyView} from "./hierarchyView";
import type {Key} from "../../engine/input/key";
import type {GenerateProjectReport, PackageResult, TargetReportResult} from "../project/projectServerApi";
import type {ProjectTarget} from "../../engine/project/projectTargets";
import {PROJECT_MANIFEST_FILE} from "../../engine/project/projectManifest";
import {InspectorView} from "./inspectorView";
import {MenuBar} from "./menuBar";
import {
    ALL_PANELS_SHOWN,
    clampPanelSizes,
    DEFAULT_PANEL_SIZES,
    LAYOUT_PANELS,
    PANEL_SIZES_STORAGE_KEY,
    panelSizesText,
    parsePanelSizes,
    parsePanelVisibility,
    resizedPanel,
    shownPanelSizes,
    splitterThicknessPx,
    withPanelToggled,
} from "./panelSizes";
import type {AvailableArea, LayoutPanel, PanelSizeKey, PanelSizes, PanelVisibility} from "./panelSizes";
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

export const EDITOR_VIEWPORT_ID = "viewport";
export const BOTTOM_TAB_STORAGE_KEY = "jsengine.editor.bottomTab";
export const UNSAVED_CHANGES_PROMPT = "A scene, a data asset or the project settings have unsaved changes.";

const VIEW_TAB_LABELS: Readonly<Record<EditorView, string>> = {scene: "Scene", game: "Game"};
const VIEW_TABS: readonly EditorView[] = ["scene", "game"];
const GAME_VIEW: EditorView = "game";
const CSS_VARIABLES: Readonly<Record<PanelSizeKey, string>> = {
    hierarchyWidthPx: "--hierarchy-width",
    inspectorWidthPx: "--inspector-width",
    bottomHeightPx: "--bottom-height",
};
const SPLITTER_CSS_VARIABLES: Readonly<Record<LayoutPanel, string>> = {
    hierarchy: "--hierarchy-splitter",
    inspector: "--inspector-splitter",
    bottom: "--bottom-splitter",
};
const HIDDEN_PANEL_CLASSES: Readonly<Record<LayoutPanel, string>> = {
    hierarchy: "hierarchy-hidden",
    inspector: "inspector-hidden",
    bottom: "bottom-hidden",
};
const CONNECTING_TEXT = "Waiting for the game…";
const ACTIVE_CLASS = "active";
const DRAGGING_CLASS = "resizing";
const ASPECT_FRAMED_CLASS = "aspect-framed";
const MAXIMIZED_CLASS = "maximized";
const SCENE_PLAY_HINT = "The Scene view is not available while the game plays; pause first";
const GAME_TAB_MENU_HINT = "; right-click it to pick the target the Scene and Game views simulate";
const NO_TARGET_LABEL = "";
const FRAME_STYLE_PROPERTIES: readonly string[] = ["inset", "left", "top", "width", "height"];
const FRAME_INSET = "auto";
const PIXELS = "px";
const OPEN_SCENE_LABEL = "Open scene";
const OPEN_SCENE_PLACEHOLDER = "Search scenes and prefabs";
const NO_SCENES_TEXT = "No scenes or prefabs in the project";

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
    readonly hierarchy: HTMLElement;
    readonly center: HTMLElement;
    readonly sceneTabs: HTMLElement;
    readonly prefabBreadcrumb: HTMLElement;
    readonly viewTabs: HTMLElement;
    readonly stage: HTMLElement;
    readonly viewport: HTMLElement;
    readonly overlay: HTMLCanvasElement;
    readonly inspector: HTMLElement;
    readonly bottom: HTMLElement;
    readonly bottomTabs: HTMLElement;
    readonly projectPanel: HTMLElement;
    readonly consolePanel: HTMLElement;
    readonly historyPanel: HTMLElement;
    readonly settingsPanel: HTMLElement;
    readonly assetsPanel: HTMLElement;
    readonly splitters: ReadonlyMap<PanelSizeKey, HTMLElement>;
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
    const hierarchy = panel(document, "nav", "editor-hierarchy editor-panel", "Hierarchy");
    const center = panel(document, "section", "editor-center", "Views");
    const sceneTabs = createElement(document, "div", "editor-tabs scene-tabs");
    sceneTabs.setAttribute("role", "tablist");
    sceneTabs.setAttribute("aria-label", "Open scenes and prefabs");
    const prefabBreadcrumb = createElement(document, "nav", "prefab-breadcrumb");
    prefabBreadcrumb.setAttribute("aria-label", "Prefab breadcrumb");
    prefabBreadcrumb.hidden = true;
    const viewTabs = createElement(document, "div", "editor-tabs view-tabs");
    viewTabs.setAttribute("role", "tablist");
    const stage = createElement(document, "div", "editor-stage");
    const viewport = panel(document, "main", "editor-viewport", "Game viewport");
    viewport.id = EDITOR_VIEWPORT_ID;
    const overlay = createElement(document, "canvas", "scene-overlay");
    stage.append(viewport, overlay);
    center.append(sceneTabs, prefabBreadcrumb, viewTabs, stage);
    const inspector = panel(document, "aside", "editor-inspector editor-panel", "Inspector");
    const bottom = panel(document, "section", "editor-bottom", "Project, Console, History, Settings and Data Assets");
    const bottomTabs = createElement(document, "div", "editor-tabs bottom-tabs");
    bottomTabs.setAttribute("role", "tablist");
    const projectPanel = createElement(document, "div", "bottom-panel project-panel");
    const consolePanel = createElement(document, "div", "bottom-panel console-panel");
    const historyPanel = createElement(document, "div", "bottom-panel undo-history-panel");
    const settingsPanel = createElement(document, "div", "bottom-panel settings-panel");
    const assetsPanel = createElement(document, "div", "bottom-panel data-assets-panel");
    bottom.append(bottomTabs, projectPanel, consolePanel, historyPanel, settingsPanel, assetsPanel);
    const splitters = new Map<PanelSizeKey, HTMLElement>();
    for (const key of ["hierarchyWidthPx", "inspectorWidthPx", "bottomHeightPx"] as const) {
        const splitter = createElement(document, "div", `splitter splitter-${key}`);
        splitter.setAttribute("role", "separator");
        splitter.setAttribute("aria-orientation", key === "bottomHeightPx" ? "horizontal" : "vertical");
        splitters.set(key, splitter);
    }
    root.append(menuRow, toolbar, hierarchy, splitters.get("hierarchyWidthPx")!, center, splitters.get("inspectorWidthPx")!, inspector, splitters.get("bottomHeightPx")!, bottom);
    for (const element of [hierarchy, inspector, projectPanel, historyPanel, settingsPanel, assetsPanel]) element.append(createElement(document, "p", "panel-placeholder", CONNECTING_TEXT));
    body.append(root);
    return {
        root, menuRow, menuStatus, toolbar, hierarchy, center, sceneTabs, prefabBreadcrumb, viewTabs, stage, viewport, overlay, inspector, bottom, bottomTabs,
        projectPanel, consolePanel, historyPanel, settingsPanel, assetsPanel, splitters,
    };
}

class PanelResizer {
    private sizes: PanelSizes;
    private visibility: PanelVisibility;

    public constructor(private readonly layout: ShellLayout, private readonly window: Window | null) {
        const stored = readStorage(window, PANEL_SIZES_STORAGE_KEY);
        this.sizes = parsePanelSizes(stored);
        this.visibility = parsePanelVisibility(stored);
        this.apply(this.clamped(this.sizes));
        for (const [key, splitter] of layout.splitters) this.installSplitter(key, splitter);
        window?.addEventListener("resize", () => this.apply(this.clamped(this.sizes)));
    }

    public shown(panel: LayoutPanel): boolean {
        return this.visibility[panel];
    }

    public toggle(panel: LayoutPanel): void {
        this.visibility = withPanelToggled(this.visibility, panel);
        this.apply(this.clamped(this.sizes));
        this.store();
    }

    public reset(): void {
        this.visibility = ALL_PANELS_SHOWN;
        this.apply(this.clamped(DEFAULT_PANEL_SIZES));
        this.store();
    }

    private store(): void {
        writeStorage(this.window, PANEL_SIZES_STORAGE_KEY, panelSizesText(this.sizes, this.visibility));
    }

    private area(): AvailableArea {
        const bounds = this.layout.root.getBoundingClientRect();
        const barsHeight = this.layout.menuRow.getBoundingClientRect().height + this.layout.toolbar.getBoundingClientRect().height;
        const scale = visualScaleOf(this.layout.root);
        return {widthPx: bounds.width / scale, heightPx: (bounds.height - barsHeight) / scale};
    }

    private clamped(sizes: PanelSizes): PanelSizes {
        const area = this.area();
        return area.widthPx > 0 && area.heightPx > 0 ? clampPanelSizes(sizes, area, this.visibility) : sizes;
    }

    private apply(sizes: PanelSizes): void {
        this.sizes = sizes;
        const shown = shownPanelSizes(sizes, this.visibility);
        const root = this.layout.root;
        for (const [key, variable] of Object.entries(CSS_VARIABLES) as [PanelSizeKey, string][]) root.style.setProperty(variable, `${shown[key]}${PIXELS}`);
        for (const panel of LAYOUT_PANELS) {
            root.style.setProperty(SPLITTER_CSS_VARIABLES[panel], `${splitterThicknessPx(this.visibility, panel)}${PIXELS}`);
            root.classList.toggle(HIDDEN_PANEL_CLASSES[panel], !this.visibility[panel]);
        }
    }

    private installSplitter(key: PanelSizeKey, splitter: HTMLElement): void {
        const vertical = key !== "bottomHeightPx";
        splitter.addEventListener("pointerdown", event => {
            if (event.button !== 0) return;
            event.preventDefault();
            capturePointer(splitter, event.pointerId);
            const start = vertical ? event.clientX : event.clientY;
            const scale = visualScaleOf(this.layout.root);
            const startSize = this.sizes[key];
            this.layout.root.classList.add(DRAGGING_CLASS);
            const onMove = (move: PointerEvent): void => {
                const delta = ((vertical ? move.clientX : move.clientY) - start) / scale;
                this.apply(resizedPanel(this.sizes, key, startSize, delta, this.area(), this.visibility));
            };
            const onUp = (): void => {
                splitter.removeEventListener("pointermove", onMove);
                splitter.removeEventListener("pointerup", onUp);
                splitter.removeEventListener("pointercancel", onUp);
                this.layout.root.classList.remove(DRAGGING_CLASS);
                this.store();
            };
            splitter.addEventListener("pointermove", onMove);
            splitter.addEventListener("pointerup", onUp);
            splitter.addEventListener("pointercancel", onUp);
        });
    }
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

function observeViewportSize(viewport: HTMLElement): void {
    const window = viewport.ownerDocument.defaultView;
    onSizeChange(viewport, () => window?.dispatchEvent(new window.Event("resize")));
}

class EditorShellImplementation implements EditorShell {
    public readonly viewport: HTMLElement;
    public readonly commands = new CommandRegistry();
    private readonly document: Document;
    private readonly layout: ShellLayout;
    private readonly resizer: PanelResizer;
    private readonly editorCommands: EditorCommands;
    private readonly menuBar: MenuBar;
    private readonly pendingNotices: {readonly level: EditorNoticeLevel, readonly text: string}[] = [];
    private readonly focusValues = new WeakMap<Element, string>();
    private mounted: MountedViews | undefined;
    private bottomTab: BottomTab;
    private gameViewAspectId: string;
    private targetLabel: string;
    private gameTargetMenu: readonly MenuEntry[] | undefined;
    private projectSettings: ProjectSettingsWindow | undefined;
    private buildWindow: BuildWindow | undefined;
    private preferences: PreferencesDialog | undefined;
    private readonly bottomTabButtons = new Map<BottomTab, HTMLButtonElement>();
    private readonly viewTabButtons = new Map<EditorView, HTMLButtonElement>();

    public constructor(body: HTMLElement, private readonly options: EditorShellOptions) {
        this.document = body.ownerDocument;
        const window = this.document.defaultView;
        this.layout = buildLayout(body);
        this.viewport = this.layout.viewport;
        applyPageUiScale(this.document.documentElement, storedPageUiScale(window));
        this.resizer = new PanelResizer(this.layout, window);
        observeViewportSize(this.viewport);
        onSizeChange(this.layout.stage, () => this.applyGameViewAspect());
        const stored = readStorage(window, BOTTOM_TAB_STORAGE_KEY);
        this.bottomTab = BOTTOM_TABS.find(tab => tab === stored) ?? DEFAULT_BOTTOM_TAB;
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
        this.buildTabs();
        this.showBottomTab(this.bottomTab);
        this.installKeyboard();
        this.installUnloadGuard();
    }

    public async mount(session: EditorSession): Promise<void> {
        if (this.mounted !== undefined) {
            await this.replaceSession(session, new Map(this.mounted.workspace.entities.map(summary => [summary.entity, summary.entity])));
            return;
        }
        const workspace = new EditorWorkspace(session, this.document);
        const rotations = new RotationEulerCache();
        new EditorStatusView(this.layout.menuStatus, workspace);
        new SceneTabsView(this.layout.sceneTabs, this.layout.prefabBreadcrumb, workspace, this.editorCommands);
        const hierarchy = new HierarchyView(this.layout.hierarchy, workspace, this.editorCommands);
        new InspectorView(this.layout.inspector, workspace, rotations, this.editorCommands);
        const project = new ProjectView(this.layout.projectPanel, workspace, this.editorCommands, {rebuildsOnCodeChange: this.options.generate !== undefined});
        const consoleView = new ConsoleView(this.layout.consolePanel, workspace);
        consoleView.onCountsChanged(() => this.showConsoleBadge(workspace));
        new UndoHistoryView(this.layout.historyPanel, workspace);
        const scene = new SceneView(this.layout.stage, this.viewport, this.layout.overlay, workspace);
        this.layout.stage.append(new GameStatsOverlay(this.document, workspace, this.viewport, () => this.targetLabel).element);
        const settings = new SettingsView(this.layout.settingsPanel, workspace, rotations);
        const dataAssets = new DataAssetsView(this.layout.assetsPanel, workspace, rotations);
        this.mounted = {workspace, scene, hierarchy, project, settings, dataAssets, rotations};
        settings.setVisible(this.bottomTab === "settings");
        dataAssets.setVisible(this.bottomTab === "assets");
        dataAssets.onDirtyChanged(() => this.showDataAssetsTitle(dataAssets));
        workspace.on("openDataAsset", () => this.showBottomTab("assets"));
        workspace.on("state", () => this.stateChanged(workspace));
        workspace.on("document", () => this.commands.changed());
        workspace.on("handles", () => this.commands.changed());
        workspace.on("entities", () => rotations.retainEntities(new Set(workspace.entities.map(summary => summary.entity))));
        for (const notice of this.pendingNotices.splice(0)) workspace.notice(notice.level, notice.text);
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
        const view = workspace.view;
        rotations.retainEntities(new Set<Entity>());
        await workspace.replaceSession(session, remap);
        project.rebind();
        dataAssets.rebind();
        scene.resendCamera();
        if (workspace.mode !== "play") await workspace.setView(view);
        workspace.emit("state");
        workspace.emit("document");
    }

    public notice(level: EditorNoticeLevel, text: string): void {
        if (this.mounted === undefined) this.pendingNotices.push({level, text});
        else this.mounted.workspace.notice(level, text);
    }

    public showTargetLabel(text: string): void {
        this.targetLabel = text;
        this.commands.changed();
    }

    public setGameTargetMenu(entries: readonly MenuEntry[]): void {
        this.gameTargetMenu = entries;
        this.refreshViewTabTitles();
        this.commands.changed();
    }

    private commandHost(): EditorCommandHost {
        return {
            closeProject: this.options.closeProject,
            views: () => this.mounted,
            bottomTab: () => this.bottomTab,
            showBottomTab: tab => this.showBottomTab(tab),
            resetLayout: () => this.resetLayout(),
            panelShown: panel => this.resizer.shown(panel),
            togglePanel: panel => {
                this.resizer.toggle(panel);
                this.commands.changed();
            },
            gameViewAspect: () => this.gameViewAspectId,
            setGameViewAspect: id => this.setGameViewAspect(id),
            textSelected: () => this.document.getSelection()?.isCollapsed === false,
            entityKeysFocused: () => this.entityKeysFocused(),
            toggleCommandPalette: () => this.toggleCommandPalette(),
            showKeyboardShortcuts: () => showKeyboardShortcuts(this.document, this.commands.all()),
            openSceneChooser: () => this.openSceneChooser(),
            openProjectSettings: () => this.openProjectSettings(),
            buildUnavailableReason: () => this.options.projectBuild === undefined ? BUILD_NEEDS_SERVER_REASON : this.options.projectBuild.unavailableReason,
            openBuildWindow: () => this.openBuildWindow(),
            openPreferences: () => this.openPreferences(),
        };
    }

    private viewTabTitle(view: EditorView): string {
        const shown = `Show the ${VIEW_TAB_LABELS[view]} view`;
        return view === GAME_VIEW && this.gameTargetMenu !== undefined ? shown + GAME_TAB_MENU_HINT : shown;
    }

    private buildTabs(): void {
        const document = this.document;
        for (const view of VIEW_TABS) {
            const button = createButton(document, {className: "editor-tab", text: VIEW_TAB_LABELS[view], title: this.viewTabTitle(view), onClick: () => {
                const workspace = this.mounted?.workspace;
                if (workspace !== undefined && workspace.view !== view) void workspace.setView(view);
            }});
            button.setAttribute("role", "tab");
            if (view === GAME_VIEW) {
                button.addEventListener("contextmenu", event => {
                    const menu = this.gameTargetMenu;
                    if (menu === undefined) return;
                    event.preventDefault();
                    showCommandMenu(document, event.clientX, event.clientY, menu);
                });
            }
            this.viewTabButtons.set(view, button);
            this.layout.viewTabs.append(button);
        }
        for (const tab of BOTTOM_TABS) {
            const button = createButton(document, {className: "editor-tab", text: BOTTOM_TAB_LABELS[tab], title: `Show the ${BOTTOM_TAB_LABELS[tab]}`, onClick: () => this.showBottomTab(tab)});
            button.setAttribute("role", "tab");
            this.bottomTabButtons.set(tab, button);
            this.layout.bottomTabs.append(button);
        }
    }

    private showBottomTab(tab: BottomTab): void {
        this.bottomTab = tab;
        writeStorage(this.document.defaultView, BOTTOM_TAB_STORAGE_KEY, tab);
        for (const [key, button] of this.bottomTabButtons) {
            button.classList.toggle(ACTIVE_CLASS, key === tab);
            button.setAttribute("aria-selected", String(key === tab));
        }
        this.layout.projectPanel.hidden = tab !== "project";
        this.layout.consolePanel.hidden = tab !== "console";
        this.layout.historyPanel.hidden = tab !== "history";
        this.layout.settingsPanel.hidden = tab !== "settings";
        this.layout.assetsPanel.hidden = tab !== "assets";
        this.mounted?.settings.setVisible(tab === "settings");
        this.mounted?.dataAssets.setVisible(tab === "assets");
        this.commands.changed();
    }

    private resetLayout(): void {
        this.resizer.reset();
        this.showBottomTab(DEFAULT_BOTTOM_TAB);
    }

    private stateChanged(workspace: EditorWorkspace): void {
        this.layout.toolbar.dataset.mode = workspace.mode;
        this.layout.root.classList.toggle(MAXIMIZED_CLASS, isLayoutMaximized(workspace.gameViewOptions, workspace.mode));
        this.showViewTabs(workspace);
        this.commands.changed();
    }

    private refreshViewTabTitles(): void {
        const workspace = this.mounted?.workspace;
        if (workspace !== undefined) {
            this.showViewTabs(workspace);
            return;
        }
        for (const [view, button] of this.viewTabButtons) button.title = this.viewTabTitle(view);
    }

    private showViewTabs(workspace: EditorWorkspace): void {
        for (const [view, button] of this.viewTabButtons) {
            const active = view === workspace.view;
            button.classList.toggle(ACTIVE_CLASS, active);
            button.setAttribute("aria-selected", String(active));
            const unavailable = view === "scene" && workspace.mode === "play";
            button.disabled = unavailable || workspace.closed;
            button.title = unavailable ? SCENE_PLAY_HINT : this.viewTabTitle(view);
        }
        this.layout.stage.dataset.view = workspace.view;
        this.applyGameViewAspect();
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
        const framed = stage.dataset.view === GAME_VIEW && widthToHeight !== undefined;
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
        if (isCommandPaletteOpen(this.document)) closeCommandPalette(this.document);
        else showCommandPalette(this.document, this.commands);
    }

    private openSceneChooser(): void {
        const workspace = this.mounted?.workspace;
        if (workspace === undefined) return;
        const anchor = this.menuBar.buttonOf(FILE_MENU_LABEL) ?? this.layout.menuRow;
        showChoicePopup(this.document, anchor, {
            ariaLabel: OPEN_SCENE_LABEL,
            searchPlaceholder: OPEN_SCENE_PLACEHOLDER,
            emptyText: NO_SCENES_TEXT,
            loadChoices: async () => sceneAndPrefabPaths(await workspace.session.files.list()).map(path => ({label: path, value: path})),
            choose: path => void workspace.scenes.open(path),
        });
    }

    private openProjectSettings(): void {
        const workspace = this.mounted?.workspace;
        if (workspace === undefined) return;
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
        const button = this.bottomTabButtons.get("assets");
        if (button !== undefined) button.textContent = BOTTOM_TAB_LABELS.assets + (dataAssets.dirty ? DIRTY_MARKER : "");
    }

    private showConsoleBadge(workspace: EditorWorkspace): void {
        const counts = workspace.consoleLog.levelCounts;
        const button = this.bottomTabButtons.get("console");
        if (button === undefined) return;
        const problems = counts.error + counts.warn;
        button.textContent = problems === 0 ? BOTTOM_TAB_LABELS.console : `${BOTTOM_TAB_LABELS.console} (${problems})`;
        button.classList.toggle("has-errors", counts.error > 0);
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

    private installKeyboard(): void {
        const document = this.document;
        document.addEventListener("focusin", event => {
            const target = event.target;
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) this.focusValues.set(target, target.value);
        });
        document.addEventListener("keydown", event => this.onKeyDown(event));
    }

    private entityKeysFocused(): boolean {
        const active = this.document.activeElement;
        return active === null || active === this.document.body || active === this.layout.overlay || this.layout.hierarchy.contains(active);
    }

    private hasTextEdits(element: Element): boolean {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
        return this.focusValues.get(element) !== element.value;
    }

    private onKeyDown(event: KeyboardEvent): void {
        if (event.defaultPrevented) return;
        const active = this.document.activeElement;
        if (active !== null && this.viewport.contains(active)) return;
        const resolution = this.commands.resolveKey(keyChordOf(event), {
            inTextEntry: isTextEntryElement(active),
            textEdited: active !== null && this.hasTextEdits(active),
        });
        if (resolution.kind !== "bound") return;
        event.preventDefault();
        if (resolution.leavesTextEntry && active instanceof HTMLElement) active.blur();
        if (resolution.command.runAlone() || event.repeat || !resolution.command.explainsWhenDisabled()) return;
        this.explainUnavailable(resolution.command);
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
