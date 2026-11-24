import {showCommandMenu} from "./commandMenus";
import type {MenuEntry} from "./commandMenus";
import {capturePointer, createButton, createElement, releasePointer, visualScaleOf} from "./dom";
import {dockDropAt, EMPTY_PLACEMENT, placeDock, resizedLengths, sharesOf} from "./dockGeometry";
import type {DockDrop, DockDropArea, DockMinimums, DockPlacement, DockRect, DockStackArea} from "./dockGeometry";
import {
    activatePanel,
    closedDockPanels,
    closePanel,
    dockStacks,
    EDGE_AXES,
    findDockStack,
    MAX_SHARE,
    MIN_SHARE,
    movePanel,
    openDockPanels,
    openPanel,
    resizeSplit,
    stackOfPanel,
} from "./dockLayout";
import type {DockEdge, DockHome, DockLayout, DockPanelId, DockStack, DockTarget} from "./dockLayout";
import {DOCK_PANEL_HOOK, DOCK_STACK_HOOK, DOCK_TAB_CLOSE_HOOK, DOCK_TAB_HOOK} from "../project/editorUiHooks";

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

interface StackParts {
    readonly element: HTMLElement;
    readonly strip: HTMLElement;
    readonly content: HTMLElement;
}

interface Point {
    readonly x: number;
    readonly y: number;
}

export const DRAG_THRESHOLD_PX = 5;
export const MAX_HOME_SHARE = 0.5;

const LEFT_BUTTON = 0;
const MIDDLE_BUTTON = 1;
const ESCAPE_KEY = "Escape";
const CLOSE_TEXT = "×";
const ACTIVE_CLASS = "active";
const ALERT_CLASS = "has-errors";
const PANEL_CLASS = "dock-panel";
const RESIZING_CLASS = "resizing";
const DRAGGING_CLASS = "dock-dragging";
const DRAGGED_CLASS = "dragged";
const SPLITTER_CLASS = "dock-splitter";
const PIXELS = "px";
const TAB_INDEX_ATTRIBUTE = "tabindex";
const FOCUSABLE_BY_SCRIPT = "-1";
const CAPTURE = true;
const ONCE = {once: true};
const COMMITTING_POINTER_EVENT = "pointerup";

function onPointerEnd(element: HTMLElement, listener: (event: PointerEvent) => void): () => void {
    element.addEventListener("pointerup", listener);
    element.addEventListener("pointercancel", listener);
    element.addEventListener("lostpointercapture", listener);
    return () => {
        element.removeEventListener("pointerup", listener);
        element.removeEventListener("pointercancel", listener);
        element.removeEventListener("lostpointercapture", listener);
    };
}

function setRect(element: HTMLElement, rect: DockRect): void {
    const style = element.style;
    style.left = `${rect.left}${PIXELS}`;
    style.top = `${rect.top}${PIXELS}`;
    style.width = `${Math.max(0, rect.width)}${PIXELS}`;
    style.height = `${Math.max(0, rect.height)}${PIXELS}`;
}

function placeChildren(parent: HTMLElement, children: readonly HTMLElement[]): void {
    children.forEach((child, index) => {
        const current = parent.children[index];
        if (current !== child) parent.insertBefore(child, current ?? null);
    });
    while (parent.children.length > children.length) parent.lastElementChild?.remove();
}

function homeShare(sizePx: number | undefined, lengthPx: number | undefined): {readonly share?: number} {
    if (sizePx === undefined || lengthPx === undefined || lengthPx <= 0) return {};
    return {share: Math.max(MIN_SHARE, Math.min(MAX_HOME_SHARE, MAX_SHARE, sizePx / lengthPx))};
}

export class DockView {
    private current: DockLayout;
    private placement: DockPlacement = EMPTY_PLACEMENT;
    private userMaximized: string | undefined;
    private forcedPanel: DockPanelId | undefined;
    private dragging = false;
    private readonly document: Document;
    private readonly preview: HTMLElement;
    private readonly stackParts = new Map<string, StackParts>();
    private readonly tabParts = new Map<DockPanelId, TabParts>();
    private readonly splitters = new Map<string, HTMLElement>();
    private readonly shown = new Map<DockPanelId, boolean>();

    public constructor(private readonly root: HTMLElement, layout: DockLayout, private readonly options: DockViewOptions) {
        this.current = layout;
        this.document = root.ownerDocument;
        this.preview = createElement(this.document, "div", "dock-drop-preview");
        this.preview.hidden = true;
        root.append(this.preview);
        for (const panel of options.panels.values()) {
            panel.element.classList.add(PANEL_CLASS);
            panel.element.setAttribute(DOCK_PANEL_HOOK, panel.id);
            this.tabParts.set(panel.id, this.createTab(panel));
        }
        this.observeSize();
        this.render();
    }

    public get layout(): DockLayout {
        return this.current;
    }

    public setLayout(layout: DockLayout): void {
        this.userMaximized = undefined;
        this.current = layout;
        this.render();
        this.options.changed(layout);
    }

    public isOpen(panel: DockPanelId): boolean {
        return stackOfPanel(this.current, panel) !== undefined;
    }

    public isShown(panel: DockPanelId): boolean {
        const stack = stackOfPanel(this.current, panel);
        if (stack === undefined || stack.active !== panel) return false;
        const maximized = this.maximizedStack();
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
        if (this.userMaximized !== undefined && stackOfPanel(revealed, panel)?.id !== this.userMaximized) this.userMaximized = undefined;
        if (revealed === this.current) this.render();
        else this.update(revealed);
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

    public focusPanel(panel: DockPanelId): void {
        const element = this.options.panels.get(panel)?.element;
        if (element === undefined || !this.isShown(panel)) return;
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
        this.current = layout;
        if (this.userMaximized !== undefined && findDockStack(layout, this.userMaximized) === undefined) this.userMaximized = undefined;
        this.render();
        this.options.changed(layout);
    }

    private maximizedStack(): DockStack | undefined {
        const forced = this.forcedPanel === undefined ? undefined : stackOfPanel(this.current, this.forcedPanel);
        if (forced !== undefined) return forced;
        return this.userMaximized === undefined ? undefined : findDockStack(this.current, this.userMaximized);
    }

    private panelElement(panel: DockPanelId): HTMLElement | undefined {
        return this.options.panels.get(panel)?.element;
    }

    private render(): void {
        const stacks = dockStacks(this.current.root);
        const maximized = this.maximizedStack();
        for (const stack of stacks) {
            const parts = this.stackPartsOf(stack.id);
            const panels = stack.panels.filter(panel => this.tabParts.has(panel));
            placeChildren(parts.strip, panels.map(panel => this.tabParts.get(panel)!.element));
            placeChildren(parts.content, panels.flatMap(panel => this.panelElement(panel) ?? []));
            for (const panel of panels) {
                const active = panel === stack.active;
                const tab = this.tabParts.get(panel)!;
                tab.element.classList.toggle(ACTIVE_CLASS, active);
                tab.element.setAttribute("aria-selected", String(active));
                const element = this.panelElement(panel);
                if (element !== undefined) element.hidden = !active;
            }
            parts.element.hidden = maximized !== undefined && maximized.id !== stack.id;
        }
        const live = new Set(stacks.map(stack => stack.id));
        for (const [id, parts] of this.stackParts) {
            if (live.has(id)) continue;
            parts.element.remove();
            this.stackParts.delete(id);
        }
        const open = new Set(openDockPanels(this.current));
        for (const [panel, tab] of this.tabParts) {
            if (open.has(panel)) continue;
            tab.element.remove();
            this.panelElement(panel)?.remove();
        }
        this.applyPlacement();
        this.notifyShown();
    }

    private notifyShown(): void {
        for (const [id, panel] of this.options.panels) {
            const shown = this.isShown(id);
            if (this.shown.get(id) === shown) continue;
            this.shown.set(id, shown);
            panel.onShown?.(shown);
        }
    }

    private area(): DockRect {
        return {left: 0, top: 0, width: this.root.clientWidth, height: this.root.clientHeight};
    }

    private applyPlacement(): void {
        const placement = placeDock(this.maximizedStack() ?? this.current.root, this.area(), this.options.minimums);
        this.placement = placement;
        for (const [id, parts] of this.stackParts) {
            const rect = placement.stacks.get(id);
            if (rect !== undefined) setRect(parts.element, rect);
        }
        const live = new Set<string>();
        for (const splitter of placement.splitters) {
            const key = `${splitter.split}:${splitter.index}`;
            live.add(key);
            const element = this.splitterOf(key, splitter.split, splitter.index);
            element.classList.toggle("row", splitter.axis === "row");
            element.classList.toggle("column", splitter.axis === "column");
            element.setAttribute("aria-orientation", splitter.axis === "row" ? "vertical" : "horizontal");
            setRect(element, splitter.rect);
        }
        for (const [key, element] of this.splitters) {
            if (live.has(key)) continue;
            element.remove();
            this.splitters.delete(key);
        }
    }

    private observeSize(): void {
        const window = this.document.defaultView;
        if (window === null) return;
        if (typeof window.ResizeObserver === "function") new window.ResizeObserver(() => this.applyPlacement()).observe(this.root);
        else window.addEventListener("resize", () => this.applyPlacement());
    }

    private resolvedHomes(homes: readonly DockViewHome[]): DockHome[] {
        return homes.map((home): DockHome => {
            if ("withPanel" in home) return home;
            if ("rootEdge" in home) {
                const area = this.area();
                return {rootEdge: home.rootEdge, ...homeShare(home.sizePx, EDGE_AXES[home.rootEdge] === "row" ? area.width : area.height)};
            }
            const anchor = stackOfPanel(this.current, home.nextTo);
            const rect = anchor === undefined ? undefined : this.placement.stacks.get(anchor.id);
            const length = rect === undefined ? undefined : EDGE_AXES[home.edge] === "row" ? rect.width : rect.height;
            return {nextTo: home.nextTo, edge: home.edge, ...homeShare(home.sizePx, length)};
        });
    }

    private stackPartsOf(id: string): StackParts {
        const existing = this.stackParts.get(id);
        if (existing !== undefined) return existing;
        const element = createElement(this.document, "section", "dock-stack");
        element.setAttribute(DOCK_STACK_HOOK, id);
        const strip = createElement(this.document, "div", "dock-tabs");
        strip.setAttribute("role", "tablist");
        const content = createElement(this.document, "div", "dock-content");
        element.append(strip, content);
        this.root.insertBefore(element, this.preview);
        const parts = {element, strip, content};
        this.stackParts.set(id, parts);
        return parts;
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
            showCommandMenu(document, event.clientX, event.clientY, this.options.tabMenu(panel.id));
        });
        return {element, label, close};
    }

    private localPoint(clientX: number, clientY: number): Point {
        const bounds = this.root.getBoundingClientRect();
        const scale = visualScaleOf(this.root);
        return {x: (clientX - bounds.left) / scale, y: (clientY - bounds.top) / scale};
    }

    private localRect(element: Element): DockRect {
        const bounds = this.root.getBoundingClientRect();
        const scale = visualScaleOf(this.root);
        const rect = element.getBoundingClientRect();
        return {left: (rect.left - bounds.left) / scale, top: (rect.top - bounds.top) / scale, width: rect.width / scale, height: rect.height / scale};
    }

    private dropArea(): DockDropArea {
        const stacks: DockStackArea[] = [];
        for (const stack of dockStacks(this.current.root)) {
            const parts = this.stackParts.get(stack.id);
            if (parts === undefined || parts.element.hidden) continue;
            stacks.push({
                stack: stack.id,
                rect: this.localRect(parts.element),
                strip: this.localRect(parts.strip),
                tabs: stack.panels.flatMap(panel => {
                    const tab = this.tabParts.get(panel);
                    return tab === undefined ? [] : [this.localRect(tab.element)];
                }),
            });
        }
        return {root: this.area(), stacks};
    }

    private soleStackOf(panel: DockPanelId): string | undefined {
        const stack = stackOfPanel(this.current, panel);
        return stack !== undefined && stack.panels.length === 1 ? stack.id : undefined;
    }

    private showPreview(drop: DockDrop | undefined): void {
        this.preview.hidden = drop === undefined;
        if (drop !== undefined) setRect(this.preview, drop.preview);
    }

    private beginTabPointer(panel: DockPanelId, element: HTMLElement, down: PointerEvent): void {
        const pointerId = down.pointerId;
        const startX = down.clientX;
        const startY = down.clientY;
        let moved = false;
        let finished = false;
        let area: DockDropArea | undefined;
        let drop: DockDrop | undefined;
        let stopEndListening = (): void => undefined;
        this.dragging = true;
        capturePointer(element, pointerId);
        const finish = (commit: boolean): void => {
            if (finished) return;
            finished = true;
            element.removeEventListener("pointermove", onMove);
            stopEndListening();
            this.document.removeEventListener("keydown", onKey, CAPTURE);
            releasePointer(element, pointerId);
            this.root.classList.remove(DRAGGING_CLASS);
            element.classList.remove(DRAGGED_CLASS);
            this.showPreview(undefined);
            this.dragging = false;
            if (!commit) return;
            if (!moved) this.update(activatePanel(this.current, panel));
            else if (drop !== undefined) this.movePanel(panel, drop.target);
        };
        const onMove = (event: PointerEvent): void => {
            if (event.pointerId !== pointerId) return;
            if (!moved) {
                if (Math.hypot(event.clientX - startX, event.clientY - startY) < DRAG_THRESHOLD_PX) return;
                moved = true;
                area = this.dropArea();
                this.root.classList.add(DRAGGING_CLASS);
                element.classList.add(DRAGGED_CLASS);
            }
            const point = this.localPoint(event.clientX, event.clientY);
            drop = area === undefined ? undefined : dockDropAt(point.x, point.y, area, this.soleStackOf(panel));
            this.showPreview(drop);
        };
        const onEnd = (event: PointerEvent): void => {
            if (event.pointerId !== pointerId) return;
            finish(event.type === COMMITTING_POINTER_EVENT);
        };
        const onKey = (event: KeyboardEvent): void => {
            if (event.key !== ESCAPE_KEY) return;
            event.preventDefault();
            event.stopPropagation();
            finish(false);
        };
        element.addEventListener("pointermove", onMove);
        stopEndListening = onPointerEnd(element, onEnd);
        this.document.addEventListener("keydown", onKey, CAPTURE);
    }

    private splitterOf(key: string, split: string, index: number): HTMLElement {
        const existing = this.splitters.get(key);
        if (existing !== undefined) return existing;
        const element = createElement(this.document, "div", SPLITTER_CLASS);
        element.setAttribute("role", "separator");
        element.addEventListener("pointerdown", event => this.beginSplitterDrag(element, split, index, event));
        this.root.insertBefore(element, this.preview);
        this.splitters.set(key, element);
        return element;
    }

    private beginSplitterDrag(element: HTMLElement, split: string, index: number, down: PointerEvent): void {
        const placed = this.placement.splits.get(split);
        if (down.button !== LEFT_BUTTON || placed === undefined || this.dragging) return;
        down.preventDefault();
        const pointerId = down.pointerId;
        const horizontal = placed.axis === "row";
        const start = horizontal ? down.clientX : down.clientY;
        const scale = visualScaleOf(this.root);
        const {lengths, minimums} = placed;
        let finished = false;
        let stopEndListening = (): void => undefined;
        this.dragging = true;
        capturePointer(element, pointerId);
        this.root.classList.add(RESIZING_CLASS);
        element.classList.add(DRAGGED_CLASS);
        const onMove = (event: PointerEvent): void => {
            if (event.pointerId !== pointerId) return;
            const deltaPx = ((horizontal ? event.clientX : event.clientY) - start) / scale;
            this.current = resizeSplit(this.current, split, sharesOf(resizedLengths(lengths, index, deltaPx, minimums)));
            this.applyPlacement();
        };
        const onEnd = (event: PointerEvent): void => {
            if (finished || event.pointerId !== pointerId) return;
            finished = true;
            element.removeEventListener("pointermove", onMove);
            stopEndListening();
            releasePointer(element, pointerId);
            this.root.classList.remove(RESIZING_CLASS);
            element.classList.remove(DRAGGED_CLASS);
            this.dragging = false;
            this.options.changed(this.current);
        };
        element.addEventListener("pointermove", onMove);
        stopEndListening = onPointerEnd(element, onEnd);
    }
}
