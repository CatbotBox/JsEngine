import {capturePointer, createElement, releasePointer, visualScaleOf} from "./dom";
import {EMPTY_PLACEMENT, placeDock, resizedLengths, sharesOf} from "./dockGeometry";
import type {DockDrop, DockDropArea, DockMinimums, DockPlacement, DockPoint, DockRect, DockStackArea} from "./dockGeometry";
import type {DockNode, DockPanelId, DockStack} from "./dockLayout";
import {DOCK_STACK_HOOK, DOCK_WINDOW_HOOK} from "../project/editorUiHooks";

export interface DockAreaHost {
    readonly minimums: DockMinimums;

    tabElement(panel: DockPanelId): HTMLElement | undefined;

    panelElement(panel: DockPanelId): HTMLElement | undefined;

    beginGesture(): boolean;

    endGesture(): void;

    resizingSplit(area: DockArea, split: string, shares: readonly number[]): void;

    resizedSplit(): void;
}

interface StackParts {
    readonly element: HTMLElement;
    readonly strip: HTMLElement;
    readonly content: HTMLElement;
}

const LEFT_BUTTON = 0;
const ACTIVE_CLASS = "active";
const RESIZING_CLASS = "resizing";
const DRAGGING_CLASS = "dock-dragging";
const DRAGGED_CLASS = "dragged";
const SPLITTER_CLASS = "dock-splitter";
const PIXELS = "px";

export function onPointerEnd(element: HTMLElement, listener: (event: PointerEvent) => void): () => void {
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

export class DockArea {
    public readonly document: Document;
    private placementNow: DockPlacement = EMPTY_PLACEMENT;
    private shownRoot: DockNode | undefined;
    private readonly preview: HTMLElement;
    private readonly stackParts = new Map<string, StackParts>();
    private readonly splitters = new Map<string, HTMLElement>();
    private readonly stopObserving: () => void;

    public constructor(public readonly root: HTMLElement, public readonly window: string, private readonly host: DockAreaHost) {
        this.document = root.ownerDocument;
        root.setAttribute(DOCK_WINDOW_HOOK, window);
        this.preview = createElement(this.document, "div", "dock-drop-preview");
        this.preview.hidden = true;
        root.append(this.preview);
        this.stopObserving = this.observeSize();
    }

    public get placement(): DockPlacement {
        return this.placementNow;
    }

    public render(stacks: readonly DockStack[], shownRoot: DockNode | undefined, maximized: DockStack | undefined): void {
        for (const stack of stacks) {
            const parts = this.stackPartsOf(stack.id);
            const panels = stack.panels.filter(panel => this.host.tabElement(panel) !== undefined);
            placeChildren(parts.strip, panels.flatMap(panel => this.host.tabElement(panel) ?? []));
            placeChildren(parts.content, panels.flatMap(panel => this.host.panelElement(panel) ?? []));
            for (const panel of panels) {
                const active = panel === stack.active;
                const tab = this.host.tabElement(panel)!;
                tab.classList.toggle(ACTIVE_CLASS, active);
                tab.setAttribute("aria-selected", String(active));
                const element = this.host.panelElement(panel);
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
        this.place(shownRoot);
    }

    public place(shownRoot: DockNode | undefined): void {
        this.shownRoot = shownRoot;
        this.applyPlacement();
    }

    public area(): DockRect {
        return {left: 0, top: 0, width: this.root.clientWidth, height: this.root.clientHeight};
    }

    public stackElement(id: string): HTMLElement | undefined {
        return this.stackParts.get(id)?.element;
    }

    public localPoint(clientX: number, clientY: number): DockPoint {
        const bounds = this.root.getBoundingClientRect();
        const scale = visualScaleOf(this.root);
        return {x: (clientX - bounds.left) / scale, y: (clientY - bounds.top) / scale};
    }

    public dropArea(stacks: readonly DockStack[]): DockDropArea {
        const areas: DockStackArea[] = [];
        for (const stack of stacks) {
            const parts = this.stackParts.get(stack.id);
            if (parts === undefined || parts.element.hidden) continue;
            areas.push({
                stack: stack.id,
                rect: this.localRect(parts.element),
                strip: this.localRect(parts.strip),
                tabs: stack.panels.flatMap(panel => {
                    const tab = this.host.tabElement(panel);
                    return tab === undefined ? [] : [this.localRect(tab)];
                }),
            });
        }
        return {root: this.area(), stacks: areas};
    }

    public showPreview(drop: DockDrop | undefined): void {
        this.preview.hidden = drop === undefined;
        if (drop !== undefined) setRect(this.preview, drop.preview);
    }

    public setDragging(dragging: boolean): void {
        this.root.classList.toggle(DRAGGING_CLASS, dragging);
        if (!dragging) this.showPreview(undefined);
    }

    public detach(): void {
        this.stopObserving();
        for (const parts of this.stackParts.values()) parts.element.remove();
        this.stackParts.clear();
        for (const splitter of this.splitters.values()) splitter.remove();
        this.splitters.clear();
    }

    private localRect(element: Element): DockRect {
        const bounds = this.root.getBoundingClientRect();
        const scale = visualScaleOf(this.root);
        const rect = element.getBoundingClientRect();
        return {left: (rect.left - bounds.left) / scale, top: (rect.top - bounds.top) / scale, width: rect.width / scale, height: rect.height / scale};
    }

    private applyPlacement(): void {
        const placement = placeDock(this.shownRoot, this.area(), this.host.minimums);
        this.placementNow = placement;
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

    private observeSize(): () => void {
        const window = this.document.defaultView;
        if (window === null) return () => undefined;
        const listener = (): void => this.applyPlacement();
        if (typeof window.ResizeObserver === "function") {
            const observer = new window.ResizeObserver(listener);
            observer.observe(this.root);
            return () => observer.disconnect();
        }
        window.addEventListener("resize", listener);
        return () => window.removeEventListener("resize", listener);
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
        const placed = this.placementNow.splits.get(split);
        if (down.button !== LEFT_BUTTON || placed === undefined || !this.host.beginGesture()) return;
        down.preventDefault();
        const pointerId = down.pointerId;
        const horizontal = placed.axis === "row";
        const start = horizontal ? down.clientX : down.clientY;
        const scale = visualScaleOf(this.root);
        const {lengths, minimums} = placed;
        let finished = false;
        let stopEndListening = (): void => undefined;
        capturePointer(element, pointerId);
        this.root.classList.add(RESIZING_CLASS);
        element.classList.add(DRAGGED_CLASS);
        const onMove = (event: PointerEvent): void => {
            if (event.pointerId !== pointerId) return;
            const deltaPx = ((horizontal ? event.clientX : event.clientY) - start) / scale;
            this.host.resizingSplit(this, split, sharesOf(resizedLengths(lengths, index, deltaPx, minimums)));
        };
        const onEnd = (event: PointerEvent): void => {
            if (finished || event.pointerId !== pointerId) return;
            finished = true;
            element.removeEventListener("pointermove", onMove);
            stopEndListening();
            releasePointer(element, pointerId);
            this.root.classList.remove(RESIZING_CLASS);
            element.classList.remove(DRAGGED_CLASS);
            this.host.endGesture();
            this.host.resizedSplit();
        };
        element.addEventListener("pointermove", onMove);
        stopEndListening = onPointerEnd(element, onEnd);
    }
}
