import {DOCK_PANEL_IDS} from "../project/editorUiHooks";
import type {DockPanelId} from "../project/editorUiHooks";

export type {DockPanelId};

export type DockAxis = "row" | "column";

export type DockEdge = "left" | "right" | "top" | "bottom";

export interface DockSplit {
    readonly kind: "split";
    readonly id: string;
    readonly axis: DockAxis;
    readonly children: readonly DockNode[];
    readonly sizes: readonly number[];
}

export interface DockStack {
    readonly kind: "stack";
    readonly id: string;
    readonly panels: readonly DockPanelId[];
    readonly active: DockPanelId;
}

export type DockNode = DockSplit | DockStack;

export interface DockClosedPanel {
    readonly panel: DockPanelId;
    readonly stack: string;
    readonly index: number;
}

export interface DockLayout {
    readonly version: number;
    readonly root: DockNode | undefined;
    readonly closed: readonly DockClosedPanel[];
}

export interface DockTabTarget {
    readonly stack: string;
    readonly index: number;
}

export interface DockEdgeTarget {
    readonly stack: string;
    readonly edge: DockEdge;
    readonly share?: number;
}

export interface DockRootTarget {
    readonly rootEdge: DockEdge;
    readonly share?: number;
}

export type DockTarget = DockTabTarget | DockEdgeTarget | DockRootTarget;

export interface DockTabHome {
    readonly withPanel: DockPanelId;
}

export interface DockNeighbourHome {
    readonly nextTo: DockPanelId;
    readonly edge: DockEdge;
    readonly share?: number;
}

export interface DockRootHome {
    readonly rootEdge: DockEdge;
    readonly share?: number;
}

export type DockHome = DockTabHome | DockNeighbourHome | DockRootHome;

export const DOCK_LAYOUT_VERSION = 1;
export const STACK_EDGE_SHARE = 0.5;
export const ROOT_EDGE_SHARE = 0.25;
export const MIN_SHARE = 0.05;
export const MAX_SHARE = 0.95;
export const EDGE_AXES: Readonly<Record<DockEdge, DockAxis>> = {left: "row", right: "row", top: "column", bottom: "column"};

const STACK_ID_PREFIX = "stack";
const SPLIT_ID_PREFIX = "split";
const ID_NUMBER = /-(\d+)$/;
const NO_ID_NUMBER = 0;
const LEADING_EDGES: ReadonlySet<DockEdge> = new Set<DockEdge>(["left", "top"]);
const KNOWN_PANELS: ReadonlySet<string> = new Set<string>(DOCK_PANEL_IDS);
const AXES: ReadonlySet<string> = new Set<string>(["row", "column"]);
const WHOLE = 1;
const SHARE_TOLERANCE = 1e-9;
const NOT_FOUND = -1;
const REMOVED = null;

type ParsedNode = DockNode | typeof REMOVED | undefined;

export function isLeadingEdge(edge: DockEdge): boolean {
    return LEADING_EDGES.has(edge);
}

export function dockStack(id: string, panels: readonly DockPanelId[], active: DockPanelId = panels[0]): DockStack {
    return {kind: "stack", id, panels, active};
}

export function dockSplit(id: string, axis: DockAxis, children: readonly DockNode[], sizes: readonly number[]): DockSplit {
    return {kind: "split", id, axis, children, sizes};
}

export function dockLayoutOf(root: DockNode | undefined, closed: readonly DockClosedPanel[] = []): DockLayout {
    return normalizeDockLayout({version: DOCK_LAYOUT_VERSION, root, closed});
}

export function dockStacks(node: DockNode | undefined): DockStack[] {
    if (node === undefined) return [];
    if (node.kind === "stack") return [node];
    return node.children.flatMap(child => dockStacks(child));
}

function dockNodes(node: DockNode | undefined): DockNode[] {
    if (node === undefined) return [];
    if (node.kind === "stack") return [node];
    return [node, ...node.children.flatMap(child => dockNodes(child))];
}

export function findDockStack(layout: DockLayout, id: string): DockStack | undefined {
    return dockStacks(layout.root).find(stack => stack.id === id);
}

export function findDockSplit(layout: DockLayout, id: string): DockSplit | undefined {
    return dockNodes(layout.root).find((node): node is DockSplit => node.kind === "split" && node.id === id);
}

export function stackOfPanel(layout: DockLayout, panel: DockPanelId): DockStack | undefined {
    return dockStacks(layout.root).find(stack => stack.panels.includes(panel));
}

export function openDockPanels(layout: DockLayout): DockPanelId[] {
    return dockStacks(layout.root).flatMap(stack => stack.panels);
}

export function isDockPanelOpen(layout: DockLayout, panel: DockPanelId): boolean {
    return stackOfPanel(layout, panel) !== undefined;
}

export function closedDockPanels(layout: DockLayout): DockPanelId[] {
    const open = new Set(openDockPanels(layout));
    return DOCK_PANEL_IDS.filter(panel => !open.has(panel));
}

function idNumberOf(id: string): number {
    const match = ID_NUMBER.exec(id);
    return match === null ? NO_ID_NUMBER : Number(match[1]);
}

class DockIds {
    private readonly used: Set<string>;
    private next: number;

    public constructor(layout: DockLayout) {
        this.used = new Set([...dockNodes(layout.root).map(node => node.id), ...layout.closed.map(entry => entry.stack)]);
        this.next = Math.max(NO_ID_NUMBER, ...[...this.used].map(idNumberOf)) + 1;
    }

    public fresh(prefix: string): string {
        let id = `${prefix}-${this.next++}`;
        while (this.used.has(id)) id = `${prefix}-${this.next++}`;
        this.used.add(id);
        return id;
    }
}

function clampShare(share: number): number {
    if (!Number.isFinite(share)) return STACK_EDGE_SHARE;
    return Math.max(MIN_SHARE, Math.min(MAX_SHARE, share));
}

function replaceNode(node: DockNode, id: string, replace: (node: DockNode) => DockNode | undefined): DockNode | undefined {
    if (node.id === id) return replace(node);
    if (node.kind === "stack") return node;
    const children: DockNode[] = [];
    const sizes: number[] = [];
    node.children.forEach((child, index) => {
        const replaced = replaceNode(child, id, replace);
        if (replaced === undefined) return;
        children.push(replaced);
        sizes.push(node.sizes[index]);
    });
    return children.length === 0 ? undefined : {...node, children, sizes};
}

function withRoot(layout: DockLayout, root: DockNode | undefined): DockLayout {
    return {...layout, root};
}

function withoutPanel(layout: DockLayout, panel: DockPanelId): DockLayout {
    const stack = stackOfPanel(layout, panel);
    if (stack === undefined || layout.root === undefined) return layout;
    const index = stack.panels.indexOf(panel);
    const panels = stack.panels.filter(open => open !== panel);
    const active = stack.active !== panel ? stack.active : panels[Math.min(index, panels.length - 1)];
    return normalizeDockLayout(withRoot(layout, replaceNode(layout.root, stack.id, () => panels.length === 0 ? undefined : {...stack, panels, active})));
}

export function activatePanel(layout: DockLayout, panel: DockPanelId): DockLayout {
    const stack = stackOfPanel(layout, panel);
    if (stack === undefined || stack.active === panel || layout.root === undefined) return layout;
    return withRoot(layout, replaceNode(layout.root, stack.id, () => ({...stack, active: panel})));
}

export function closePanel(layout: DockLayout, panel: DockPanelId): DockLayout {
    const stack = stackOfPanel(layout, panel);
    if (stack === undefined) return layout;
    const remembered: DockClosedPanel = {panel, stack: stack.id, index: stack.panels.indexOf(panel)};
    const removed = withoutPanel(layout, panel);
    return normalizeDockLayout({...removed, closed: [...removed.closed.filter(entry => entry.panel !== panel), remembered]});
}

function besideSplit(id: string, target: DockNode, created: DockNode, edge: DockEdge, share: number): DockSplit {
    const leading = isLeadingEdge(edge);
    return dockSplit(id, EDGE_AXES[edge], leading ? [created, target] : [target, created], leading ? [share, WHOLE - share] : [WHOLE - share, share]);
}

function insertBeside(node: DockNode, target: string, created: DockStack, edge: DockEdge, share: number, ids: DockIds): DockNode {
    if (node.kind === "stack") return node.id === target ? besideSplit(ids.fresh(SPLIT_ID_PREFIX), node, created, edge, share) : node;
    const index = node.children.findIndex(child => child.id === target);
    if (index !== NOT_FOUND && node.axis === EDGE_AXES[edge]) {
        const leading = isLeadingEdge(edge);
        const size = node.sizes[index];
        const children = [...node.children];
        const sizes = [...node.sizes];
        children.splice(leading ? index : index + 1, 0, created);
        sizes.splice(index, 1, ...(leading ? [size * share, size * (WHOLE - share)] : [size * (WHOLE - share), size * share]));
        return {...node, children, sizes};
    }
    return {...node, children: node.children.map(child => insertBeside(child, target, created, edge, share, ids))};
}

function insertAtStackEdge(layout: DockLayout, panel: DockPanelId, target: string, edge: DockEdge, share: number): DockLayout {
    if (layout.root === undefined || findDockStack(layout, target) === undefined) return layout;
    const ids = new DockIds(layout);
    const created = dockStack(ids.fresh(STACK_ID_PREFIX), [panel]);
    return withRoot(layout, insertBeside(layout.root, target, created, edge, clampShare(share), ids));
}

function insertAtRootEdge(layout: DockLayout, panel: DockPanelId, edge: DockEdge, share: number): DockLayout {
    const ids = new DockIds(layout);
    const created = dockStack(ids.fresh(STACK_ID_PREFIX), [panel]);
    const root = layout.root;
    if (root === undefined) return withRoot(layout, created);
    const clamped = clampShare(share);
    if (root.kind === "split" && root.axis === EDGE_AXES[edge]) {
        const leading = isLeadingEdge(edge);
        const scaled = root.sizes.map(size => size * (WHOLE - clamped));
        return withRoot(layout, {
            ...root,
            children: leading ? [created, ...root.children] : [...root.children, created],
            sizes: leading ? [clamped, ...scaled] : [...scaled, clamped],
        });
    }
    return withRoot(layout, besideSplit(ids.fresh(SPLIT_ID_PREFIX), root, created, edge, clamped));
}

function insertAsTab(layout: DockLayout, panel: DockPanelId, target: string, index: number): DockLayout {
    const stack = findDockStack(layout, target);
    if (stack === undefined || layout.root === undefined) return layout;
    const panels = [...stack.panels];
    panels.splice(Math.max(0, Math.min(index, panels.length)), 0, panel);
    return withRoot(layout, replaceNode(layout.root, stack.id, () => ({...stack, panels, active: panel})));
}

function reorderTab(layout: DockLayout, stack: DockStack, panel: DockPanelId, index: number): DockLayout {
    const from = stack.panels.indexOf(panel);
    const to = Math.max(0, Math.min(index, stack.panels.length));
    const placed = to > from ? to - 1 : to;
    if (placed === from) return activatePanel(layout, panel);
    const panels = stack.panels.filter(open => open !== panel);
    panels.splice(placed, 0, panel);
    if (layout.root === undefined) return layout;
    return withRoot(layout, replaceNode(layout.root, stack.id, () => ({...stack, panels, active: panel})));
}

export function movePanel(layout: DockLayout, panel: DockPanelId, target: DockTarget): DockLayout {
    const source = stackOfPanel(layout, panel);
    if ("rootEdge" in target) {
        if (source !== undefined && layout.root === source && source.panels.length === 1) return layout;
        return normalizeDockLayout(insertAtRootEdge(withoutPanel(layout, panel), panel, target.rootEdge, target.share ?? ROOT_EDGE_SHARE));
    }
    const destination = findDockStack(layout, target.stack);
    if (destination === undefined) return layout;
    if ("edge" in target) {
        if (source === destination && source.panels.length === 1) return layout;
        return normalizeDockLayout(insertAtStackEdge(withoutPanel(layout, panel), panel, target.stack, target.edge, target.share ?? STACK_EDGE_SHARE));
    }
    if (source === destination) return reorderTab(layout, destination, panel, target.index);
    return normalizeDockLayout(insertAsTab(withoutPanel(layout, panel), panel, target.stack, target.index));
}

function homeTarget(layout: DockLayout, home: DockHome): DockTarget | undefined {
    if ("rootEdge" in home) return home.share === undefined ? {rootEdge: home.rootEdge} : {rootEdge: home.rootEdge, share: home.share};
    const anchor = stackOfPanel(layout, "withPanel" in home ? home.withPanel : home.nextTo);
    if (anchor === undefined) return undefined;
    if ("withPanel" in home) return {stack: anchor.id, index: anchor.panels.length};
    return home.share === undefined ? {stack: anchor.id, edge: home.edge} : {stack: anchor.id, edge: home.edge, share: home.share};
}

export function openPanel(layout: DockLayout, panel: DockPanelId, homes: readonly DockHome[] = []): DockLayout {
    if (isDockPanelOpen(layout, panel)) return activatePanel(layout, panel);
    const remembered = layout.closed.find(entry => entry.panel === panel);
    const previous = remembered === undefined ? undefined : findDockStack(layout, remembered.stack);
    if (remembered !== undefined && previous !== undefined) return movePanel(layout, panel, {stack: previous.id, index: Math.min(remembered.index, previous.panels.length)});
    for (const home of homes) {
        const target = homeTarget(layout, home);
        if (target !== undefined) return movePanel(layout, panel, target);
    }
    const first = dockStacks(layout.root)[0];
    return movePanel(layout, panel, first === undefined ? {rootEdge: "left"} : {stack: first.id, index: first.panels.length});
}

function isPositiveSize(size: unknown): size is number {
    return typeof size === "number" && Number.isFinite(size) && size > 0;
}

function proportions(sizes: readonly number[]): number[] {
    const valid = sizes.filter(isPositiveSize);
    const fallback = valid.length === 0 ? WHOLE : valid.reduce((sum, size) => sum + size, 0) / valid.length;
    const sanitized = sizes.map(size => isPositiveSize(size) ? size : fallback);
    const total = sanitized.reduce((sum, size) => sum + size, 0);
    if (Math.abs(total - WHOLE) <= SHARE_TOLERANCE) return sanitized;
    return sanitized.map(size => size / total);
}

export function resizeSplit(layout: DockLayout, splitId: string, sizes: readonly number[]): DockLayout {
    const split = findDockSplit(layout, splitId);
    if (split === undefined || layout.root === undefined || sizes.length !== split.children.length || !sizes.every(isPositiveSize)) return layout;
    return withRoot(layout, replaceNode(layout.root, splitId, () => ({...split, sizes: proportions(sizes)})));
}

function normalizeNode(node: DockNode, seen: Set<DockPanelId>): DockNode | undefined {
    if (node.kind === "stack") {
        const panels = node.panels.filter(panel => {
            if (seen.has(panel)) return false;
            seen.add(panel);
            return true;
        });
        if (panels.length === 0) return undefined;
        return {...node, panels, active: panels.includes(node.active) ? node.active : panels[0]};
    }
    const sizes = proportions(node.sizes.length === node.children.length ? node.sizes : node.children.map(() => WHOLE));
    const children: DockNode[] = [];
    const childSizes: number[] = [];
    node.children.forEach((child, index) => {
        const normalized = normalizeNode(child, seen);
        if (normalized === undefined) return;
        if (normalized.kind === "split" && normalized.axis === node.axis) {
            normalized.children.forEach((grandchild, grandchildIndex) => {
                children.push(grandchild);
                childSizes.push(sizes[index] * normalized.sizes[grandchildIndex]);
            });
            return;
        }
        children.push(normalized);
        childSizes.push(sizes[index]);
    });
    if (children.length === 0) return undefined;
    if (children.length === 1) return children[0];
    return {...node, children, sizes: proportions(childSizes)};
}

export function normalizeDockLayout(layout: DockLayout): DockLayout {
    const root = layout.root === undefined ? undefined : normalizeNode(layout.root, new Set<DockPanelId>());
    const open = new Set(dockStacks(root).flatMap(stack => stack.panels));
    const latest = new Map<DockPanelId, DockClosedPanel>();
    for (const entry of layout.closed) {
        latest.delete(entry.panel);
        if (!open.has(entry.panel)) latest.set(entry.panel, entry);
    }
    return {version: DOCK_LAYOUT_VERSION, root, closed: [...latest.values()]};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPanelId(value: unknown): value is DockPanelId {
    return typeof value === "string" && KNOWN_PANELS.has(value);
}

function claimId(value: unknown, ids: Set<string>): string | undefined {
    if (typeof value !== "string" || value.length === 0 || ids.has(value)) return undefined;
    ids.add(value);
    return value;
}

function parseStack(record: Record<string, unknown>, id: string): ParsedNode {
    if (!Array.isArray(record.panels)) return undefined;
    const panels = record.panels.filter(isPanelId);
    if (panels.length === 0) return REMOVED;
    return dockStack(id, panels, isPanelId(record.active) && panels.includes(record.active) ? record.active : panels[0]);
}

function parseSplit(record: Record<string, unknown>, id: string, ids: Set<string>): ParsedNode {
    const {axis, children, sizes} = record;
    if (typeof axis !== "string" || !AXES.has(axis) || !Array.isArray(children) || !Array.isArray(sizes)) return undefined;
    if (children.length === 0 || sizes.length !== children.length || !sizes.every(isPositiveSize)) return undefined;
    const kept: DockNode[] = [];
    const keptSizes: number[] = [];
    for (let index = 0; index < children.length; index++) {
        const child = parseNode(children[index], ids);
        if (child === undefined) return undefined;
        if (child === REMOVED) continue;
        kept.push(child);
        keptSizes.push(sizes[index] as number);
    }
    return kept.length === 0 ? REMOVED : dockSplit(id, axis as DockAxis, kept, keptSizes);
}

function parseNode(value: unknown, ids: Set<string>): ParsedNode {
    if (!isRecord(value)) return undefined;
    const id = claimId(value.id, ids);
    if (id === undefined) return undefined;
    if (value.kind === "stack") return parseStack(value, id);
    if (value.kind === "split") return parseSplit(value, id, ids);
    return undefined;
}

function parseClosed(value: unknown): DockClosedPanel[] {
    if (!isRecord(value)) return [];
    const {panel, stack, index} = value;
    if (!isPanelId(panel) || typeof stack !== "string" || typeof index !== "number" || !Number.isInteger(index) || index < 0) return [];
    return [{panel, stack, index}];
}

export function parseDockLayout(text: string | null): DockLayout | undefined {
    if (text === null) return undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return undefined;
    }
    if (!isRecord(parsed) || parsed.version !== DOCK_LAYOUT_VERSION) return undefined;
    const root = parsed.root === undefined || parsed.root === null ? REMOVED : parseNode(parsed.root, new Set<string>());
    if (root === undefined) return undefined;
    const closed = Array.isArray(parsed.closed) ? parsed.closed.flatMap(parseClosed) : [];
    return normalizeDockLayout({version: DOCK_LAYOUT_VERSION, root: root ?? undefined, closed});
}

export function dockLayoutText(layout: DockLayout): string {
    return JSON.stringify(layout);
}
