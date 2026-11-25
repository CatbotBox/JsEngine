import {showCommandMenu} from "./commandMenus";
import type {MenuEntry} from "./commandMenus";
import {DockArea, onPointerEnd} from "./dockArea";
import type {DockAreaHost} from "./dockArea";
import {capturePointer, createButton, createElement, releasePointer} from "./dom";
import {
    clientPointAt,
    contentOrigin,
    dockAreaContains,
    dockDropAt,
    estimatedChrome,
    floatingWindowBounds,
    measuredChrome,
    outerRectOf,
    screenPointAt,
} from "./dockGeometry";
import type {DockChrome, DockDrop, DockDropArea, DockMinimums, DockPoint, DockPointerSample, DockRect, DockSize, DockWindowMetrics} from "./dockGeometry";
import {
    activatePanel,
    closedDockPanels,
    closeFloatingWindow,
    closePanel,
    dockPanelHome,
    dockStacks,
    dockWindowOfNode,
    dockWindowOfPanel,
    dockWindowPanels,
    dockWindowRoot,
    EDGE_AXES,
    findDockStack,
    findFloatingWindow,
    floatPanel,
    hasOwnFloatingWindow,
    isFloatingPanel,
    MAIN_DOCK_WINDOW,
    MAX_SHARE,
    MIN_SHARE,
    moveFloatingWindow,
    movePanel,
    openDockPanels,
    openPanel,
    resizeSplit,
    stackOfPanel,
} from "./dockLayout";
import type {DockBounds, DockEdge, DockFloatingWindow, DockHome, DockLayout, DockNode, DockPanelId, DockStack, DockTarget} from "./dockLayout";
import type {FloatingWindow, FloatingWindowHost} from "./floatingWindows";
import {DOCK_PANEL_HOOK, DOCK_TAB_CLOSE_HOOK, DOCK_TAB_HOOK} from "../project/editorUiHooks";

export interface DockPanel {
    readonly id: DockPanelId;
    readonly title: string;
    readonly element: HTMLElement;
    readonly onShown?: (shown: boolean) => void;
}

export interface DockViewOptions {
    readonly panels: ReadonlyMap<DockPanelId, DockPanel>;
    readonly minimums: DockMinimums;
    readonly changed: (layout: DockLayout) => void;
    readonly closeRequested: (panel: DockPanelId) => void;
    readonly tabMenu: (panel: DockPanelId) => readonly MenuEntry[];
    readonly homes?: (panel: DockPanelId) => readonly DockViewHome[];
    readonly floatingHost?: FloatingWindowHost;
    readonly canFloat?: (panel: DockPanelId) => boolean;
    readonly screenScale?: () => number;
    readonly windowOpened?: (document: Document) => void;
    readonly floatingRefused?: (panels: readonly DockPanelId[]) => void;
}

export interface DockViewTabHome {
    readonly withPanel: DockPanelId;
}

export interface DockViewNeighbourHome {
    readonly nextTo: DockPanelId;
    readonly edge: DockEdge;
    readonly sizePx?: number;
}

export interface DockViewRootHome {
    readonly rootEdge: DockEdge;
    readonly sizePx?: number;
}

export type DockViewHome = DockViewTabHome | DockViewNeighbourHome | DockViewRootHome;

interface TabParts {
    readonly element: HTMLElement;
    readonly label: HTMLElement;
    readonly close: HTMLButtonElement;
}

interface PointerRecord {
    readonly sample: DockPointerSample;
    readonly metrics: DockWindowMetrics;
    readonly timeMs: number;
}

interface DragWindow {
    readonly id: string;
    readonly area: DockArea;
    readonly drop: DockDropArea;
    readonly origin: DockPoint;
    readonly rect: DockBounds;
    readonly accepts: boolean;
}

interface DragHover {
    readonly window: DragWindow;
    readonly drop: DockDrop | undefined;
    readonly inArea: boolean;
}

export const DRAG_THRESHOLD_PX = 5;
export const MAX_HOME_SHARE = 0.5;
export const FLOATING_TITLE_SUFFIX = " — JsEngine";
export const DEFAULT_FLOATING_SIZE: DockSize = {widthPx: 480, heightPx: 320};

const LEFT_BUTTON = 0;
const MIDDLE_BUTTON = 1;
const ESCAPE_KEY = "Escape";
const CLOSE_TEXT = "×";
const ALERT_CLASS = "has-errors";
const PANEL_CLASS = "dock-panel";
const DRAGGED_CLASS = "dragged";
const TAB_INDEX_ATTRIBUTE = "tabindex";
const FOCUSABLE_BY_SCRIPT = "-1";
const CAPTURE = true;
const ONCE = {once: true};
const PASSIVE_CAPTURE = {capture: true, passive: true};
const COMMITTING_POINTER_EVENT = "pointerup";
const POINTER_MOVE_EVENT = "pointermove";
const POINTER_SAMPLE_INTERVAL_MS = 250;
const FLOAT_TAB_OFFSET_PX = 32;
const TITLE_SEPARATOR = ", ";
const UNIT_SCALE = 1;
const HALF = 2;
const NO_HOMES: readonly DockViewHome[] = [];

function homeShare(sizePx: number | undefined, lengthPx: number | undefined): {readonly share?: number} {
    if (sizePx === undefined || lengthPx === undefined || lengthPx <= 0) return {};
    return {share: Math.max(MIN_SHARE, Math.min(MAX_HOME_SHARE, MAX_SHARE, sizePx / lengthPx))};
}

function sampleOf(event: PointerEvent): DockPointerSample {
    return {screenX: event.screenX, screenY: event.screenY, clientX: event.clientX, clientY: event.clientY};
}

function metricsOfWindow(window: Window): DockWindowMetrics {
    return {screenX: window.screenX, screenY: window.screenY, outerWidth: window.outerWidth, outerHeight: window.outerHeight, innerWidth: window.innerWidth, innerHeight: window.innerHeight};
}

function inWindowTarget(target: DockTarget, window: string): DockTarget {
    return "rootEdge" in target ? {...target, window} : target;
}

export class DockView {
    private current: DockLayout;
    private userMaximized: string | undefined;
    private forcedPanel: DockPanelId | undefined;
    private dragging = false;
    private frontToBack: string[] = [];
    private readonly document: Document;
    private readonly mainArea: DockArea;
    private readonly areas = new Map<string, DockArea>();
    private readonly windows = new Map<string, FloatingWindow>();
    private readonly pointers = new Map<string, PointerRecord>();
    private readonly tabParts = new Map<DockPanelId, TabParts>();
    private readonly shown = new Map<DockPanelId, boolean>();
    private readonly areaHost: DockAreaHost;

    public constructor(root: HTMLElement, layout: DockLayout, private readonly options: DockViewOptions) {
        this.current = layout;
        this.document = root.ownerDocument;
        this.areaHost = {
            minimums: options.minimums,
            tabElement: panel => this.tabParts.get(panel)?.element,
            panelElement: panel => this.panelElement(panel),
            beginGesture: () => this.beginGesture(),
            endGesture: () => {
                this.dragging = false;
            },
            resizingSplit: (area, split, shares) => {
                this.current = resizeSplit(this.current, split, shares);
                area.place(this.shownRootOf(area.window));
            },
            resizedSplit: () => this.options.changed(this.current),
        };
        this.mainArea = new DockArea(root, MAIN_DOCK_WINDOW, this.areaHost);
        this.areas.set(MAIN_DOCK_WINDOW, this.mainArea);
        for (const panel of options.panels.values()) {
            panel.element.classList.add(PANEL_CLASS);
            panel.element.setAttribute(DOCK_PANEL_HOOK, panel.id);
            this.tabParts.set(panel.id, this.createTab(panel));
        }
        this.trackPointers(this.document, MAIN_DOCK_WINDOW);
        this.document.defaultView?.addEventListener("pagehide", () => this.closeWindowsForUnload());
        this.render();
        const restored = this.withOpenWindows(this.current);
        const changed = restored !== this.current;
        this.current = restored;
        this.render();
        if (changed) this.options.changed(restored);
    }

    public get layout(): DockLayout {
        return this.current;
    }

    public documents(): Document[] {
        return [this.document, ...[...this.windows.values()].map(window => window.document)];
    }

    public setLayout(layout: DockLayout): void {
        this.userMaximized = undefined;
        this.current = this.withOpenWindows(layout);
        this.render();
        this.options.changed(this.current);
    }

    public isOpen(panel: DockPanelId): boolean {
        return stackOfPanel(this.current, panel) !== undefined;
    }

    public isFloating(panel: DockPanelId): boolean {
        return isFloatingPanel(this.current, panel);
    }

    public hasOwnWindow(panel: DockPanelId): boolean {
        return hasOwnFloatingWindow(this.current, panel);
    }

    public isShown(panel: DockPanelId): boolean {
        const stack = stackOfPanel(this.current, panel);
        if (stack === undefined || stack.active !== panel) return false;
        const window = dockWindowOfNode(this.current, stack.id);
        if (window === undefined || !this.areas.has(window)) return false;
        const maximized = this.maximizedIn(window);
        return maximized === undefined || maximized.id === stack.id;
    }

    public closedPanels(): DockPanelId[] {
        return closedDockPanels(this.current);
    }

    public isMaximized(panel: DockPanelId): boolean {
        const stack = stackOfPanel(this.current, panel);
        return stack !== undefined && stack.id === this.userMaximized;
    }

    public toggleMaximized(panel: DockPanelId): void {
        const stack = stackOfPanel(this.current, panel);
        if (stack === undefined) return;
        this.userMaximized = this.userMaximized === stack.id ? undefined : stack.id;
        this.render();
    }

    public setForcedPanel(panel: DockPanelId | undefined): void {
        if (panel === this.forcedPanel) return;
        this.forcedPanel = panel;
        const activated = panel === undefined ? this.current : activatePanel(this.current, panel);
        if (activated === this.current) this.render();
        else this.update(activated);
    }

    public revealPanel(panel: DockPanelId, homes: readonly DockViewHome[] = []): void {
        const revealed = openPanel(this.current, panel, this.resolvedHomes(homes));
        const maximizedWindow = this.userMaximized === undefined ? undefined : dockWindowOfNode(revealed, this.userMaximized);
        if (maximizedWindow !== undefined && maximizedWindow === dockWindowOfPanel(revealed, panel) && stackOfPanel(revealed, panel)?.id !== this.userMaximized) this.userMaximized = undefined;
        if (revealed === this.current) this.render();
        else this.update(revealed);
        this.focusWindowOf(panel);
    }

    public closePanel(panel: DockPanelId): void {
        this.update(closePanel(this.current, panel));
    }

    public movePanel(panel: DockPanelId, target: DockTarget): void {
        this.update(movePanel(this.current, panel, target));
    }

    public addPanelBeside(panel: DockPanelId, besidePanel: DockPanelId): void {
        const stack = stackOfPanel(this.current, besidePanel);
        if (stack === undefined) return;
        this.movePanel(panel, {stack: stack.id, index: stack.panels.length});
    }

    public floatPanel(panel: DockPanelId): void {
        if (!this.canFloat(panel)) return;
        this.update(floatPanel(this.current, panel, this.floatTabBounds(panel)));
        this.focusWindowOf(panel);
    }

    public dockPanel(panel: DockPanelId): void {
        this.update(dockPanelHome(this.current, panel, this.resolvedHomes(this.homesOf(panel))));
    }

    public focusPanel(panel: DockPanelId): void {
        const element = this.options.panels.get(panel)?.element;
        if (element === undefined || !this.isShown(panel)) return;
        this.focusWindowOf(panel);
        if (!element.hasAttribute(TAB_INDEX_ATTRIBUTE)) {
            element.setAttribute(TAB_INDEX_ATTRIBUTE, FOCUSABLE_BY_SCRIPT);
            element.addEventListener("blur", () => element.removeAttribute(TAB_INDEX_ATTRIBUTE), ONCE);
        }
        element.focus({preventScroll: true});
    }

    public setTabTitle(panel: DockPanelId, title: string): void {
        const tab = this.tabParts.get(panel);
        if (tab !== undefined) tab.label.textContent = title;
    }

    public setTabTooltip(panel: DockPanelId, tooltip: string): void {
        const tab = this.tabParts.get(panel);
        if (tab !== undefined) tab.element.title = tooltip;
    }

    public setTabAlert(panel: DockPanelId, alert: boolean): void {
        this.tabParts.get(panel)?.element.classList.toggle(ALERT_CLASS, alert);
    }

    private update(layout: DockLayout): void {
        if (layout === this.current) return;
        this.current = this.withOpenWindows(layout);
        if (this.userMaximized !== undefined && findDockStack(this.current, this.userMaximized) === undefined) this.userMaximized = undefined;
        this.render();
        this.options.changed(this.current);
    }

    private canFloat(panel: DockPanelId): boolean {
        return this.options.floatingHost !== undefined && (this.options.canFloat?.(panel) ?? true);
    }

    private homesOf(panel: DockPanelId): readonly DockViewHome[] {
        return this.options.homes?.(panel) ?? NO_HOMES;
    }

    private screenScale(): number {
        const scale = this.options.screenScale?.() ?? UNIT_SCALE;
        return Number.isFinite(scale) && scale > 0 ? scale : UNIT_SCALE;
    }

    private beginGesture(): boolean {
        if (this.dragging) return false;
        this.dragging = true;
        return true;
    }

    private withOpenWindows(layout: DockLayout): DockLayout {
        let result = layout;
        const refused: DockPanelId[] = [];
        for (const floating of layout.floating) {
            for (const panel of dockWindowPanels(result, floating.id)) {
                if (!this.canFloat(panel)) result = dockPanelHome(result, panel, this.resolvedHomes(this.homesOf(panel)));
            }
            const window = findFloatingWindow(result, floating.id);
            if (window === undefined || this.windows.has(window.id)) continue;
            const opened = this.openWindow(window);
            if (opened !== undefined) {
                result = moveFloatingWindow(result, window.id, opened.openedAt);
                continue;
            }
            const panels = dockWindowPanels(result, window.id);
            refused.push(...panels);
            result = closeFloatingWindow(result, window.id);
            for (const panel of panels) result = openPanel(result, panel, this.resolvedHomes(this.homesOf(panel)));
        }
        if (refused.length > 0) this.options.floatingRefused?.(refused);
        return result;
    }

    private openWindow(floating: DockFloatingWindow): FloatingWindow | undefined {
        const host = this.options.floatingHost;
        if (host === undefined) return undefined;
        const id = floating.id;
        const opened = host.open(id, floating.bounds, {
            moved: bounds => this.update(moveFloatingWindow(this.current, id, bounds)),
            closedByUser: () => this.closedByUser(id),
            focused: () => this.bringToFront(id),
        });
        if (opened === undefined) return undefined;
        this.windows.set(id, opened);
        this.areas.set(id, new DockArea(opened.root, id, this.areaHost));
        this.bringToFront(id);
        this.trackPointers(opened.document, id);
        this.options.windowOpened?.(opened.document);
        return opened;
    }

    private bringToFront(id: string): void {
        this.frontToBack = [id, ...this.frontToBack.filter(entry => entry !== id)];
    }

    private closedByUser(id: string): void {
        this.forgetWindow(id);
        this.update(closeFloatingWindow(this.current, id));
    }

    private forgetWindow(id: string): void {
        const window = this.windows.get(id);
        if (window !== undefined) this.adoptFrom(window.document);
        this.areas.get(id)?.detach();
        this.windows.delete(id);
        this.areas.delete(id);
        this.pointers.delete(id);
        this.frontToBack = this.frontToBack.filter(entry => entry !== id);
    }

    private adoptFrom(document: Document): void {
        for (const [panel, tab] of this.tabParts) {
            if (tab.element.ownerDocument === document) this.document.adoptNode(tab.element);
            const element = this.panelElement(panel);
            if (element !== undefined && element.ownerDocument === document) this.document.adoptNode(element);
        }
    }

    private closeWindowsForUnload(): void {
        let layout = this.current;
        for (const [id, window] of this.windows) layout = moveFloatingWindow(layout, id, window.bounds());
        if (layout !== this.current) {
            this.current = layout;
            this.options.changed(layout);
        }
        for (const [id, window] of [...this.windows]) {
            this.forgetWindow(id);
            window.close();
        }
    }

    private maximizedIn(window: string): DockStack | undefined {
        const forced = this.forcedPanel === undefined ? undefined : stackOfPanel(this.current, this.forcedPanel);
        if (forced !== undefined && dockWindowOfNode(this.current, forced.id) === window) return forced;
        const user = this.userMaximized === undefined ? undefined : findDockStack(this.current, this.userMaximized);
        return user !== undefined && dockWindowOfNode(this.current, user.id) === window ? user : undefined;
    }

    private shownRootOf(window: string): DockNode | undefined {
        return this.maximizedIn(window) ?? dockWindowRoot(this.current, window);
    }

    private panelElement(panel: DockPanelId): HTMLElement | undefined {
        return this.options.panels.get(panel)?.element;
    }

    private render(): void {
        for (const [window, area] of this.areas) {
            const maximized = this.maximizedIn(window);
            area.render(dockStacks(dockWindowRoot(this.current, window)), this.shownRootOf(window), maximized);
        }
        this.parkClosedPanels();
        this.closeRemovedWindows();
        this.placeWindows();
        this.notifyShown();
    }

    private parkClosedPanels(): void {
        const open = new Set(openDockPanels(this.current));
        for (const [panel, tab] of this.tabParts) {
            if (open.has(panel)) continue;
            this.document.adoptNode(tab.element);
            const element = this.panelElement(panel);
            if (element !== undefined) this.document.adoptNode(element);
        }
    }

    private closeRemovedWindows(): void {
        const live = new Set(this.current.floating.map(window => window.id));
        for (const [id, window] of [...this.windows]) {
            if (live.has(id)) continue;
            this.forgetWindow(id);
            window.close();
        }
    }

    private placeWindows(): void {
        for (const floating of this.current.floating) {
            const window = this.windows.get(floating.id);
            if (window === undefined) continue;
            window.place(floating.bounds);
            window.setTitle(this.titleOf(floating.id));
        }
    }

    private titleOf(window: string): string {
        return dockWindowPanels(this.current, window).map(panel => this.options.panels.get(panel)?.title ?? panel).join(TITLE_SEPARATOR) + FLOATING_TITLE_SUFFIX;
    }

    private notifyShown(): void {
        for (const [id, panel] of this.options.panels) {
            const shown = this.isShown(id);
            if (this.shown.get(id) === shown) continue;
            this.shown.set(id, shown);
            panel.onShown?.(shown);
        }
    }

    private focusWindowOf(panel: DockPanelId): void {
        const window = dockWindowOfPanel(this.current, panel);
        if (window !== undefined && window !== MAIN_DOCK_WINDOW) this.windows.get(window)?.focus();
    }

    private resolvedHomes(homes: readonly DockViewHome[]): DockHome[] {
        return homes.map((home): DockHome => {
            if ("withPanel" in home) return home;
            if ("rootEdge" in home) {
                const area = this.mainArea.area();
                return {rootEdge: home.rootEdge, ...homeShare(home.sizePx, EDGE_AXES[home.rootEdge] === "row" ? area.width : area.height)};
            }
            const anchor = stackOfPanel(this.current, home.nextTo);
            const rect = anchor === undefined ? undefined : this.mainArea.placement.stacks.get(anchor.id);
            const length = rect === undefined ? undefined : EDGE_AXES[home.edge] === "row" ? rect.width : rect.height;
            return {nextTo: home.nextTo, edge: home.edge, ...homeShare(home.sizePx, length)};
        });
    }

    private metricsOf(window: string): DockWindowMetrics | undefined {
        if (window !== MAIN_DOCK_WINDOW) return this.windows.get(window)?.metrics();
        const view = this.document.defaultView;
        return view === null ? undefined : metricsOfWindow(view);
    }

    private chromeOf(window: string, metrics: DockWindowMetrics, scale: number): DockChrome {
        const record = this.pointers.get(window);
        return record === undefined ? estimatedChrome(metrics, scale) : measuredChrome(record.metrics, record.sample, scale);
    }

    private trackPointers(document: Document, window: string): void {
        const record = (event: PointerEvent): void => {
            const last = this.pointers.get(window);
            if (event.type === POINTER_MOVE_EVENT && last !== undefined && event.timeStamp - last.timeMs < POINTER_SAMPLE_INTERVAL_MS) return;
            const metrics = this.metricsOf(window);
            if (metrics !== undefined) this.pointers.set(window, {sample: sampleOf(event), metrics, timeMs: event.timeStamp});
        };
        document.addEventListener("pointermove", record, PASSIVE_CAPTURE);
        document.addEventListener("pointerdown", record, PASSIVE_CAPTURE);
    }

    private shownStackSize(panel: DockPanelId): DockRect | undefined {
        const stack = stackOfPanel(this.current, panel);
        const window = stack === undefined ? undefined : dockWindowOfNode(this.current, stack.id);
        const element = stack === undefined || window === undefined ? undefined : this.areas.get(window)?.stackElement(stack.id);
        if (element === undefined || element.hidden) return undefined;
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0 ? {left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height} : undefined;
    }

    private floatTabBounds(panel: DockPanelId): DockBounds {
        const scale = this.screenScale();
        const shownIn = dockWindowOfPanel(this.current, panel);
        const placed = this.shownStackSize(panel);
        const window = placed !== undefined && shownIn !== undefined ? shownIn : MAIN_DOCK_WINDOW;
        const metrics = this.metricsOf(window) ?? this.metricsOf(MAIN_DOCK_WINDOW)!;
        const chrome = this.chromeOf(window, metrics, scale);
        const origin = contentOrigin(metrics, chrome);
        if (placed === undefined) {
            const centred = {x: (metrics.innerWidth - DEFAULT_FLOATING_SIZE.widthPx) / HALF, y: (metrics.innerHeight - DEFAULT_FLOATING_SIZE.heightPx) / HALF};
            return floatingWindowBounds(screenPointAt(centred, origin, scale), DEFAULT_FLOATING_SIZE, scale, chrome);
        }
        const topLeft = screenPointAt({x: placed.left + FLOAT_TAB_OFFSET_PX, y: placed.top + FLOAT_TAB_OFFSET_PX}, origin, scale);
        return floatingWindowBounds(topLeft, {widthPx: placed.width, heightPx: placed.height}, scale, chrome);
    }

    private soleStackOf(panel: DockPanelId): string | undefined {
        const stack = stackOfPanel(this.current, panel);
        return stack !== undefined && stack.panels.length === 1 ? stack.id : undefined;
    }

    private createTab(panel: DockPanel): TabParts {
        const document = this.document;
        const element = createElement(document, "div", "dock-tab");
        element.setAttribute("role", "tab");
        element.setAttribute(DOCK_TAB_HOOK, panel.id);
        element.title = panel.title;
        const label = createElement(document, "span", "dock-tab-label", panel.title);
        const close = createButton(document, {
            className: "dock-tab-close",
            text: CLOSE_TEXT,
            title: `Close ${panel.title}`,
            onClick: event => {
                event.stopPropagation();
                this.options.closeRequested(panel.id);
            },
        });
        close.setAttribute(DOCK_TAB_CLOSE_HOOK, "");
        element.append(label, close);
        element.addEventListener("pointerdown", event => {
            if (event.button !== LEFT_BUTTON || this.dragging || close.contains(event.target as Node | null)) return;
            this.beginTabPointer(panel.id, element, event);
        });
        element.addEventListener("mousedown", event => {
            if (event.button === MIDDLE_BUTTON) event.preventDefault();
        });
        element.addEventListener("auxclick", event => {
            if (event.button !== MIDDLE_BUTTON) return;
            event.preventDefault();
            this.options.closeRequested(panel.id);
        });
        element.addEventListener("contextmenu", event => {
            event.preventDefault();
            showCommandMenu(element.ownerDocument, event.clientX, event.clientY, this.options.tabMenu(panel.id));
        });
        return {element, label, close};
    }

    private dragWindows(panel: DockPanelId, sourceWindow: string, down: PointerEvent, scale: number): DragWindow[] {
        const floats = this.canFloat(panel);
        return [...this.frontToBack, MAIN_DOCK_WINDOW].flatMap(id => {
            const area = this.areas.get(id);
            const metrics = this.metricsOf(id);
            if (area === undefined || metrics === undefined) return [];
            const origin = id === sourceWindow
                ? {x: down.screenX - down.clientX * scale, y: down.screenY - down.clientY * scale}
                : contentOrigin(metrics, this.chromeOf(id, metrics, scale));
            const drop = area.dropArea(dockStacks(this.shownRootOf(id)));
            return [{id, area, drop, origin, rect: outerRectOf(metrics), accepts: floats || id === MAIN_DOCK_WINDOW}];
        });
    }

    private insideViewport(window: string, client: DockPoint): boolean {
        const metrics = this.metricsOf(window);
        return metrics !== undefined && client.x >= 0 && client.y >= 0 && client.x < metrics.innerWidth && client.y < metrics.innerHeight;
    }

    private hoverAt(sample: DockPointerSample, sourceWindow: string, windows: readonly DragWindow[], excluded: string | undefined, scale: number): DragHover | undefined {
        const screen = {x: sample.screenX, y: sample.screenY};
        for (const window of windows) {
            if (window.id === sourceWindow) {
                const client = {x: sample.clientX, y: sample.clientY};
                if (this.insideViewport(sourceWindow, client)) return this.hoverIn(window, client, excluded);
                continue;
            }
            const rect = window.rect;
            const inside = screen.x >= rect.x && screen.x < rect.x + rect.width && screen.y >= rect.y && screen.y < rect.y + rect.height;
            if (inside) return this.hoverIn(window, clientPointAt(screen, window.origin, scale), excluded);
        }
        return undefined;
    }

    private hoverIn(window: DragWindow, client: DockPoint, excluded: string | undefined): DragHover {
        const local = window.area.localPoint(client.x, client.y);
        const inArea = dockAreaContains(window.drop, local.x, local.y);
        const found = window.accepts && inArea ? dockDropAt(local.x, local.y, window.drop, excluded) : undefined;
        return {window, inArea, drop: found === undefined ? undefined : {...found, target: inWindowTarget(found.target, window.id)}};
    }

    private dropAt(panel: DockPanelId, hover: DragHover | undefined, last: DockPointerSample, grab: DockPoint, sourceWindow: string, scale: number): void {
        if (hover?.drop !== undefined) {
            this.movePanel(panel, hover.drop.target);
            return;
        }
        if (hover?.inArea === true || !this.canFloat(panel)) return;
        const metrics = this.metricsOf(sourceWindow);
        if (metrics === undefined) return;
        const topLeft = {x: last.screenX - grab.x * scale, y: last.screenY - grab.y * scale};
        const placed = this.shownStackSize(panel);
        const size = placed === undefined ? DEFAULT_FLOATING_SIZE : {widthPx: placed.width, heightPx: placed.height};
        this.update(floatPanel(this.current, panel, floatingWindowBounds(topLeft, size, scale, this.chromeOf(sourceWindow, metrics, scale))));
        this.focusWindowOf(panel);
    }

    private beginTabPointer(panel: DockPanelId, element: HTMLElement, down: PointerEvent): void {
        const sourceWindow = dockWindowOfPanel(this.current, panel);
        if (sourceWindow === undefined || !this.areas.has(sourceWindow)) return;
        const document = element.ownerDocument;
        const pointerId = down.pointerId;
        const scale = this.screenScale();
        const tabBounds = element.getBoundingClientRect();
        const grab = {x: down.clientX - tabBounds.left, y: down.clientY - tabBounds.top};
        const excluded = this.soleStackOf(panel);
        let moved = false;
        let finished = false;
        let windows: DragWindow[] = [];
        let hover: DragHover | undefined;
        let last = sampleOf(down);
        let stopEndListening = (): void => undefined;
        this.dragging = true;
        capturePointer(element, pointerId);
        const showHover = (): void => {
            hover = this.hoverAt(last, sourceWindow, windows, excluded, scale);
            for (const window of windows) window.area.showPreview(hover?.window === window ? hover.drop : undefined);
        };
        const finish = (commit: boolean): void => {
            if (finished) return;
            finished = true;
            element.removeEventListener("pointermove", onMove);
            stopEndListening();
            document.removeEventListener("keydown", onKey, CAPTURE);
            releasePointer(element, pointerId);
            for (const area of this.areas.values()) area.setDragging(false);
            element.classList.remove(DRAGGED_CLASS);
            this.dragging = false;
            if (!commit) return;
            if (!moved) this.update(activatePanel(this.current, panel));
            else this.dropAt(panel, hover, last, grab, sourceWindow, scale);
        };
        const onMove = (event: PointerEvent): void => {
            if (event.pointerId !== pointerId) return;
            last = sampleOf(event);
            if (!moved) {
                if (Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY) < DRAG_THRESHOLD_PX) return;
                moved = true;
                windows = this.dragWindows(panel, sourceWindow, down, scale);
                for (const area of this.areas.values()) area.setDragging(true);
                element.classList.add(DRAGGED_CLASS);
            }
            showHover();
        };
        const onEnd = (event: PointerEvent): void => {
            if (event.pointerId !== pointerId) return;
            const commit = event.type === COMMITTING_POINTER_EVENT;
            if (commit && moved) {
                last = sampleOf(event);
                showHover();
            }
            finish(commit);
        };
        const onKey = (event: KeyboardEvent): void => {
            if (event.key !== ESCAPE_KEY) return;
            event.preventDefault();
            event.stopPropagation();
            finish(false);
        };
        element.addEventListener("pointermove", onMove);
        stopEndListening = onPointerEnd(element, onEnd);
        document.addEventListener("keydown", onKey, CAPTURE);
    }
}
