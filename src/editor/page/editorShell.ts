import type {Entity} from "../../engine/core";
import type {EditorView} from "../editorProtocol";
import {ConsoleView} from "./consoleView";
import {capturePointer, createButton, createElement, hasCommandModifier, isTextEntryElement, readStorage, writeStorage} from "./dom";
import type {EditorNoticeLevel, EditorSession, EditorShell, EntityRemap} from "./editorSession";
import {ToolbarView} from "./editorToolbar";
import {TOOL_SHORTCUT_KEYS} from "./editorTools";
import {EditorWorkspace} from "./editorWorkspace";
import {HierarchyView} from "./hierarchyView";
import {InspectorView} from "./inspectorView";
import {clampPanelSizes, PANEL_SIZES_STORAGE_KEY, panelSizesText, parsePanelSizes, resizedPanel} from "./panelSizes";
import type {AvailableArea, PanelSizeKey, PanelSizes} from "./panelSizes";
import {ProjectView} from "./projectView";
import {RotationEulerCache} from "./rotationEulerCache";
import {SceneView} from "./sceneView";

export const EDITOR_VIEWPORT_ID = "viewport";
export const BOTTOM_TAB_STORAGE_KEY = "jsengine.editor.bottomTab";

type BottomTab = "project" | "console";

const BOTTOM_TABS: readonly BottomTab[] = ["project", "console"];
const BOTTOM_TAB_LABELS: Readonly<Record<BottomTab, string>> = {project: "Project", console: "Console"};
const VIEW_TAB_LABELS: Readonly<Record<EditorView, string>> = {scene: "Scene", game: "Game"};
const VIEW_TABS: readonly EditorView[] = ["scene", "game"];
const CSS_VARIABLES: Readonly<Record<PanelSizeKey, string>> = {
    hierarchyWidthPx: "--hierarchy-width",
    inspectorWidthPx: "--inspector-width",
    bottomHeightPx: "--bottom-height",
};
const CONNECTING_TEXT = "Waiting for the game…";
const ACTIVE_CLASS = "active";
const DRAGGING_CLASS = "resizing";
const SCENE_PLAY_HINT = "The Scene view is not available while the game plays; pause first";
const RENDER_BACKEND_CLASS = "view-tabs-renderer";
const RENDER_BACKEND_HINT = "The renderer that draws the Scene and Game views; pick it with ?backend= in the page address";

export interface EditorShellOptions {
    readonly renderBackendLabel?: string;
}

interface ShellLayout {
    readonly root: HTMLElement;
    readonly toolbar: HTMLElement;
    readonly hierarchy: HTMLElement;
    readonly center: HTMLElement;
    readonly viewTabs: HTMLElement;
    readonly stage: HTMLElement;
    readonly viewport: HTMLElement;
    readonly overlay: HTMLCanvasElement;
    readonly inspector: HTMLElement;
    readonly bottom: HTMLElement;
    readonly bottomTabs: HTMLElement;
    readonly projectPanel: HTMLElement;
    readonly consolePanel: HTMLElement;
    readonly splitters: ReadonlyMap<PanelSizeKey, HTMLElement>;
}

interface MountedViews {
    readonly workspace: EditorWorkspace;
    readonly scene: SceneView;
    readonly hierarchy: HierarchyView;
    readonly project: ProjectView;
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
    const toolbar = panel(document, "header", "editor-toolbar", "Toolbar");
    const hierarchy = panel(document, "nav", "editor-hierarchy editor-panel", "Hierarchy");
    const center = panel(document, "section", "editor-center", "Views");
    const viewTabs = createElement(document, "div", "editor-tabs view-tabs");
    viewTabs.setAttribute("role", "tablist");
    const stage = createElement(document, "div", "editor-stage");
    const viewport = panel(document, "main", "editor-viewport", "Game viewport");
    viewport.id = EDITOR_VIEWPORT_ID;
    const overlay = createElement(document, "canvas", "scene-overlay");
    stage.append(viewport, overlay);
    center.append(viewTabs, stage);
    const inspector = panel(document, "aside", "editor-inspector editor-panel", "Inspector");
    const bottom = panel(document, "section", "editor-bottom", "Project and Console");
    const bottomTabs = createElement(document, "div", "editor-tabs bottom-tabs");
    bottomTabs.setAttribute("role", "tablist");
    const projectPanel = createElement(document, "div", "bottom-panel project-panel");
    const consolePanel = createElement(document, "div", "bottom-panel console-panel");
    bottom.append(bottomTabs, projectPanel, consolePanel);
    const splitters = new Map<PanelSizeKey, HTMLElement>();
    for (const key of ["hierarchyWidthPx", "inspectorWidthPx", "bottomHeightPx"] as const) {
        const splitter = createElement(document, "div", `splitter splitter-${key}`);
        splitter.setAttribute("role", "separator");
        splitter.setAttribute("aria-orientation", key === "bottomHeightPx" ? "horizontal" : "vertical");
        splitters.set(key, splitter);
    }
    root.append(toolbar, hierarchy, splitters.get("hierarchyWidthPx")!, center, splitters.get("inspectorWidthPx")!, inspector, splitters.get("bottomHeightPx")!, bottom);
    for (const element of [hierarchy, inspector, projectPanel]) element.append(createElement(document, "p", "panel-placeholder", CONNECTING_TEXT));
    body.append(root);
    return {root, toolbar, hierarchy, center, viewTabs, stage, viewport, overlay, inspector, bottom, bottomTabs, projectPanel, consolePanel, splitters};
}

class PanelResizer {
    private sizes: PanelSizes;

    public constructor(private readonly layout: ShellLayout, private readonly window: Window | null) {
        this.sizes = parsePanelSizes(readStorage(window, PANEL_SIZES_STORAGE_KEY));
        this.apply(this.clamped(this.sizes));
        for (const [key, splitter] of layout.splitters) this.installSplitter(key, splitter);
        window?.addEventListener("resize", () => this.apply(this.clamped(this.sizes)));
    }

    private area(): AvailableArea {
        const bounds = this.layout.root.getBoundingClientRect();
        const toolbarHeight = this.layout.toolbar.getBoundingClientRect().height;
        return {widthPx: bounds.width, heightPx: bounds.height - toolbarHeight};
    }

    private clamped(sizes: PanelSizes): PanelSizes {
        const area = this.area();
        return area.widthPx > 0 && area.heightPx > 0 ? clampPanelSizes(sizes, area) : sizes;
    }

    private apply(sizes: PanelSizes): void {
        this.sizes = sizes;
        for (const [key, variable] of Object.entries(CSS_VARIABLES) as [PanelSizeKey, string][]) {
            this.layout.root.style.setProperty(variable, `${sizes[key]}px`);
        }
    }

    private installSplitter(key: PanelSizeKey, splitter: HTMLElement): void {
        const vertical = key !== "bottomHeightPx";
        splitter.addEventListener("pointerdown", event => {
            if (event.button !== 0) return;
            event.preventDefault();
            capturePointer(splitter, event.pointerId);
            const start = vertical ? event.clientX : event.clientY;
            const startSize = this.sizes[key];
            this.layout.root.classList.add(DRAGGING_CLASS);
            const onMove = (move: PointerEvent): void => {
                const delta = (vertical ? move.clientX : move.clientY) - start;
                this.apply(resizedPanel(this.sizes, key, startSize, delta, this.area()));
            };
            const onUp = (): void => {
                splitter.removeEventListener("pointermove", onMove);
                splitter.removeEventListener("pointerup", onUp);
                splitter.removeEventListener("pointercancel", onUp);
                this.layout.root.classList.remove(DRAGGING_CLASS);
                writeStorage(this.window, PANEL_SIZES_STORAGE_KEY, panelSizesText(this.sizes));
            };
            splitter.addEventListener("pointermove", onMove);
            splitter.addEventListener("pointerup", onUp);
            splitter.addEventListener("pointercancel", onUp);
        });
    }
}

function observeViewportSize(viewport: HTMLElement): void {
    const window = viewport.ownerDocument.defaultView;
    if (window === null || typeof window.ResizeObserver !== "function") return;
    let width = -1;
    let height = -1;
    let scheduled = false;
    new window.ResizeObserver(() => {
        const bounds = viewport.getBoundingClientRect();
        if (bounds.width === width && bounds.height === height) return;
        width = bounds.width;
        height = bounds.height;
        if (scheduled) return;
        scheduled = true;
        window.requestAnimationFrame(() => {
            scheduled = false;
            window.dispatchEvent(new window.Event("resize"));
        });
    }).observe(viewport);
}

class EditorShellImplementation implements EditorShell {
    public readonly viewport: HTMLElement;
    private readonly document: Document;
    private readonly layout: ShellLayout;
    private readonly pendingNotices: {readonly level: EditorNoticeLevel, readonly text: string}[] = [];
    private readonly focusValues = new WeakMap<Element, string>();
    private mounted: MountedViews | undefined;
    private bottomTab: BottomTab;
    private readonly bottomTabButtons = new Map<BottomTab, HTMLButtonElement>();
    private readonly viewTabButtons = new Map<EditorView, HTMLButtonElement>();

    public constructor(body: HTMLElement, private readonly options: EditorShellOptions) {
        this.document = body.ownerDocument;
        this.layout = buildLayout(body);
        this.viewport = this.layout.viewport;
        new PanelResizer(this.layout, this.document.defaultView);
        observeViewportSize(this.viewport);
        const stored = readStorage(this.document.defaultView, BOTTOM_TAB_STORAGE_KEY);
        this.bottomTab = BOTTOM_TABS.find(tab => tab === stored) ?? "project";
        this.buildTabs();
        this.showBottomTab(this.bottomTab);
    }

    public async mount(session: EditorSession): Promise<void> {
        if (this.mounted !== undefined) {
            await this.replaceSession(session, new Map(this.mounted.workspace.entities.map(summary => [summary.entity, summary.entity])));
            return;
        }
        const workspace = new EditorWorkspace(session, this.document);
        const rotations = new RotationEulerCache();
        new ToolbarView(this.layout.toolbar, workspace);
        const hierarchy = new HierarchyView(this.layout.hierarchy, workspace);
        new InspectorView(this.layout.inspector, workspace, rotations);
        const project = new ProjectView(this.layout.projectPanel, workspace);
        const consoleView = new ConsoleView(this.layout.consolePanel, workspace);
        consoleView.onCountsChanged(() => this.showConsoleBadge(workspace));
        const scene = new SceneView(this.layout.stage, this.viewport, this.layout.overlay, workspace);
        this.mounted = {workspace, scene, hierarchy, project, rotations};
        workspace.on("state", () => this.showViewTabs(workspace));
        workspace.on("entities", () => rotations.retainEntities(new Set(workspace.entities.map(summary => summary.entity))));
        this.installKeyboard();
        for (const notice of this.pendingNotices.splice(0)) workspace.notice(notice.level, notice.text);
        this.showViewTabs(workspace);
        await workspace.start();
        const startScene = session.project.startScene;
        if (startScene !== null) await workspace.loadDocument(startScene);
    }

    public async replaceSession(session: EditorSession, remap: EntityRemap): Promise<void> {
        const mounted = this.mounted;
        if (mounted === undefined) {
            await this.mount(session);
            return;
        }
        const {workspace, scene, project, rotations} = mounted;
        const view = workspace.view;
        rotations.retainEntities(new Set<Entity>());
        await workspace.replaceSession(session, remap);
        project.rebind();
        scene.resendCamera();
        if (workspace.mode !== "play") await workspace.setView(view);
        workspace.emit("state");
        workspace.emit("document");
    }

    public notice(level: EditorNoticeLevel, text: string): void {
        if (this.mounted === undefined) this.pendingNotices.push({level, text});
        else this.mounted.workspace.notice(level, text);
    }

    private buildTabs(): void {
        const document = this.document;
        for (const view of VIEW_TABS) {
            const button = createButton(document, {className: "editor-tab", text: VIEW_TAB_LABELS[view], title: `Show the ${VIEW_TAB_LABELS[view]} view`, onClick: () => {
                const workspace = this.mounted?.workspace;
                if (workspace !== undefined && workspace.view !== view) void workspace.setView(view);
            }});
            button.setAttribute("role", "tab");
            this.viewTabButtons.set(view, button);
            this.layout.viewTabs.append(button);
        }
        const renderBackendLabel = this.options.renderBackendLabel;
        if (renderBackendLabel !== undefined) {
            const label = createElement(document, "span", RENDER_BACKEND_CLASS, renderBackendLabel);
            label.title = RENDER_BACKEND_HINT;
            this.layout.viewTabs.append(label);
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
    }

    private showViewTabs(workspace: EditorWorkspace): void {
        for (const [view, button] of this.viewTabButtons) {
            const active = view === workspace.view;
            button.classList.toggle(ACTIVE_CLASS, active);
            button.setAttribute("aria-selected", String(active));
            const unavailable = view === "scene" && workspace.mode === "play";
            button.disabled = unavailable || workspace.closed;
            button.title = unavailable ? SCENE_PLAY_HINT : `Show the ${VIEW_TAB_LABELS[view]} view`;
        }
        this.layout.stage.dataset.view = workspace.view;
    }

    private showConsoleBadge(workspace: EditorWorkspace): void {
        const counts = workspace.consoleLog.levelCounts;
        const button = this.bottomTabButtons.get("console");
        if (button === undefined) return;
        const problems = counts.error + counts.warn;
        button.textContent = problems === 0 ? BOTTOM_TAB_LABELS.console : `${BOTTOM_TAB_LABELS.console} (${problems})`;
        button.classList.toggle("has-errors", counts.error > 0);
    }

    private installKeyboard(): void {
        const document = this.document;
        document.addEventListener("focusin", event => {
            const target = event.target;
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) this.focusValues.set(target, target.value);
        });
        document.addEventListener("keydown", event => this.onKeyDown(event));
    }

    private hasTextEdits(element: Element): boolean {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
        return this.focusValues.get(element) !== element.value;
    }

    private onKeyDown(event: KeyboardEvent): void {
        const mounted = this.mounted;
        if (mounted === undefined || event.defaultPrevented) return;
        const {workspace, scene, hierarchy} = mounted;
        const active = this.document.activeElement;
        if (active !== null && this.viewport.contains(active)) return;
        const command = hasCommandModifier(event);
        const key = event.key.toLowerCase();
        const inText = isTextEntryElement(active);
        if (command && key === "s") {
            event.preventDefault();
            void workspace.saveDocument();
            return;
        }
        if (command && (key === "z" || key === "y")) {
            if (inText && active !== null && this.hasTextEdits(active)) return;
            event.preventDefault();
            if (inText && active instanceof HTMLElement) active.blur();
            const redo = key === "y" || event.shiftKey;
            void (redo ? workspace.redoLast() : workspace.undoLast());
            return;
        }
        if (inText || event.altKey) return;
        const selection = workspace.selection;
        if (command) {
            const handled = this.commandShortcut(key, workspace, selection);
            if (handled) event.preventDefault();
            return;
        }
        switch (event.key) {
            case "Delete":
                if (selection.length === 0) return;
                event.preventDefault();
                void workspace.destroy(selection);
                return;
            case "F2": {
                const primary = workspace.primary;
                if (primary === undefined) return;
                event.preventDefault();
                hierarchy.beginRename(primary);
                return;
            }
        }
        if (key === "f" && !event.shiftKey) {
            event.preventDefault();
            void scene.focusSelection();
            return;
        }
        const tool = TOOL_SHORTCUT_KEYS[key];
        if (tool !== undefined && !scene.capturesKeys && !event.shiftKey) {
            event.preventDefault();
            workspace.setTool(tool);
        }
    }

    private commandShortcut(key: string, workspace: EditorWorkspace, selection: readonly Entity[]): boolean {
        switch (key) {
            case "d":
                if (selection.length > 0) void workspace.duplicate(selection);
                return true;
            case "c":
                if (this.document.getSelection()?.isCollapsed === false) return false;
                if (selection.length > 0) void workspace.copy(selection);
                return true;
            case "v":
                void workspace.paste();
                return true;
            case "p":
                void workspace.setMode(workspace.mode === "edit" ? "play" : "edit");
                return true;
            default:
                return false;
        }
    }
}

export function createEditorShell(body: HTMLElement, options: EditorShellOptions = {}): EditorShell {
    return new EditorShellImplementation(body, options);
}
