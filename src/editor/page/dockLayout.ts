import {MAIN_DOCK_WINDOW} from "../project/editorUiHooks";
import {DOCK_PANEL_KINDS, isDockPanelId, isFirstDockPanelInstance, isInstancedDockPanelKind, nextDockPanelInstance} from "../project/dockPanelIds";
import type {DockPanelId} from "../project/dockPanelIds";
import {isScreenBounds} from "../project/dockWindows";
import type {ScreenBounds} from "../project/dockWindows";

export type {DockPanelId};
export {MAIN_DOCK_WINDOW};

export type DockAxis = "row" | "column";

export type DockEdge = "left" | "right" | "top" | "bottom";

export type DockBounds = ScreenBounds;

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

export interface DockFloatingWindow {
    readonly id: string;
    readonly bounds: DockBounds;
    readonly root: DockNode;
}

export interface DockLayout {
    readonly version: number;
    readonly root: DockNode | undefined;
    readonly closed: readonly DockClosedPanel[];
    readonly floating: readonly DockFloatingWindow[];
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
    readonly window?: string;
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

export const DOCK_LAYOUT_VERSION = 3;
export const STACK_EDGE_SHARE = 0.5;
export const ROOT_EDGE_SHARE = 0.25;
export const MIN_SHARE = 0.05;
export const MAX_SHARE = 0.95;
export const EDGE_AXES: Readonly<Record<DockEdge, DockAxis>> = {left: "row", right: "row", top: "column", bottom: "column"};

const READABLE_VERSIONS: ReadonlySet<unknown> = new Set<unknown>([1, 2, DOCK_LAYOUT_VERSION]);
const STACK_ID_PREFIX = "stack";
const SPLIT_ID_PREFIX = "split";
const FLOATING_ID_PREFIX = "float";
const ID_NUMBER = /-(\d+)$/;
const NO_ID_NUMBER = 0;
const LEADING_EDGES: ReadonlySet<DockEdge> = new Set<DockEdge>(["left", "top"]);
const AXES: ReadonlySet<string> = new Set<string>(["row", "column"]);
const WHOLE = 1;
const SHARE_TOLERANCE = 1e-9;
const NOT_FOUND = -1;
const REMOVED = null;
const DEFAULT_HOME_EDGE: DockEdge = "left";

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

export function dockLayoutOf(root: DockNode | undefined, closed: readonly DockClosedPanel[] = [], floating: readonly DockFloatingWindow[] = []): DockLayout {
    return normalizeDockLayout({version: DOCK_LAYOUT_VERSION, root, closed, floating});
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

export function dockWindowIds(layout: DockLayout): string[] {
    return [MAIN_DOCK_WINDOW, ...layout.floating.map(window => window.id)];
}

export function findFloatingWindow(layout: DockLayout, id: string): DockFloatingWindow | undefined {
    return layout.floating.find(window => window.id === id);
}

export function dockWindowRoot(layout: DockLayout, window: string): DockNode | undefined {
    return window === MAIN_DOCK_WINDOW ? layout.root : findFloatingWindow(layout, window)?.root;
}

function layoutRoots(layout: DockLayout): DockNode[] {
    return [...(layout.root === undefined ? [] : [layout.root]), ...layout.floating.map(window => window.root)];
}

export function allDockStacks(layout: DockLayout): DockStack[] {
    return layoutRoots(layout).flatMap(root => dockStacks(root));
}

function allDockNodes(layout: DockLayout): DockNode[] {
    return layoutRoots(layout).flatMap(root => dockNodes(root));
}

export function dockWindowOfNode(layout: DockLayout, id: string): string | undefined {
    return dockWindowIds(layout).find(window => dockNodes(dockWindowRoot(layout, window)).some(node => node.id === id));
}

export function dockWindowOfPanel(layout: DockLayout, panel: DockPanelId): string | undefined {
    const stack = stackOfPanel(layout, panel);
    return stack === undefined ? undefined : dockWindowOfNode(layout, stack.id);
}

export function dockWindowPanels(layout: DockLayout, window: string): DockPanelId[] {
    return dockStacks(dockWindowRoot(layout, window)).flatMap(stack => stack.panels);
}

export function isFloatingPanel(layout: DockLayout, panel: DockPanelId): boolean {
    const window = dockWindowOfPanel(layout, panel);
    return window !== undefined && window !== MAIN_DOCK_WINDOW;
}

export function hasOwnFloatingWindow(layout: DockLayout, panel: DockPanelId): boolean {
    const window = dockWindowOfPanel(layout, panel);
    const root = window === undefined || window === MAIN_DOCK_WINDOW ? undefined : dockWindowRoot(layout, window);
    return root?.kind === "stack" && root.panels.length === 1;
}

export function findDockStack(layout: DockLayout, id: string): DockStack | undefined {
    return allDockStacks(layout).find(stack => stack.id === id);
}

export function findDockSplit(layout: DockLayout, id: string): DockSplit | undefined {
    return allDockNodes(layout).find((node): node is DockSplit => node.kind === "split" && node.id === id);
}

export function stackOfPanel(layout: DockLayout, panel: DockPanelId): DockStack | undefined {
    return allDockStacks(layout).find(stack => stack.panels.includes(panel));
}

export function openDockPanels(layout: DockLayout): DockPanelId[] {
    return allDockStacks(layout).flatMap(stack => stack.panels);
}

export function isDockPanelOpen(layout: DockLayout, panel: DockPanelId): boolean {
    return stackOfPanel(layout, panel) !== undefined;
}

export function closedDockPanels(layout: DockLayout): DockPanelId[] {
    const open = new Set(openDockPanels(layout));
    return DOCK_PANEL_KINDS.filter(panel => !open.has(panel));
}

export function addableDockPanels(layout: DockLayout): DockPanelId[] {
    const open = new Set(openDockPanels(layout));
    return DOCK_PANEL_KINDS.flatMap((kind): DockPanelId[] => {
        if (!open.has(kind)) return [kind];
        return isInstancedDockPanelKind(kind) ? [nextDockPanelInstance(kind, open)] : [];
    });
}

export function releasedDockPanels(layout: DockLayout, panels: Iterable<DockPanelId>): DockPanelId[] {
    const open = new Set(openDockPanels(layout));
    return [...panels].filter(panel => !isFirstDockPanelInstance(panel) && !open.has(panel));
}

function idNumberOf(id: string): number {
    const match = ID_NUMBER.exec(id);
    return match === null ? NO_ID_NUMBER : Number(match[1]);
}

class DockIds {
    private readonly used: Set<string>;
    private next: number;

    public constructor(layout: DockLayout) {
        this.used = new Set([
            ...allDockNodes(layout).map(node => node.id),
            ...layout.floating.map(window => window.id),
            ...layout.closed.map(entry => entry.stack),
        ]);
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

function withWindowRoot(layout: DockLayout, window: string, root: DockNode | undefined): DockLayout {
    if (window === MAIN_DOCK_WINDOW) return {...layout, root};
    return {...layout, floating: layout.floating.flatMap(entry => entry.id !== window ? [entry] : root === undefined ? [] : [{...entry, root}])};
}

function replaceInLayout(layout: DockLayout, id: string, replace: (node: DockNode) => DockNode | undefined): DockLayout {
    const window = dockWindowOfNode(layout, id);
    const root = window === undefined ? undefined : dockWindowRoot(layout, window);
    if (window === undefined || root === undefined) return layout;
    return withWindowRoot(layout, window, replaceNode(root, id, replace));
}

function withoutPanel(layout: DockLayout, panel: DockPanelId): DockLayout {
    const stack = stackOfPanel(layout, panel);
    if (stack === undefined) return layout;
    const index = stack.panels.indexOf(panel);
    const panels = stack.panels.filter(open => open !== panel);
    const active = stack.active !== panel ? stack.active : panels[Math.min(index, panels.length - 1)];
    return normalizeDockLayout(replaceInLayout(layout, stack.id, () => panels.length === 0 ? undefined : {...stack, panels, active}));
}

export function activatePanel(layout: DockLayout, panel: DockPanelId): DockLayout {
    const stack = stackOfPanel(layout, panel);
    if (stack === undefined || stack.active === panel) return layout;
    return replaceInLayout(layout, stack.id, () => ({...stack, active: panel}));
}

export function closePanel(layout: DockLayout, panel: DockPanelId): DockLayout {
    const stack = stackOfPanel(layout, panel);
    if (stack === undefined) return layout;
    if (!isFirstDockPanelInstance(panel)) return withoutPanel(layout, panel);
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
    const window = dockWindowOfNode(layout, target);
    const root = window === undefined ? undefined : dockWindowRoot(layout, window);
    if (window === undefined || root === undefined || findDockStack(layout, target) === undefined) return layout;
    const ids = new DockIds(layout);
    const created = dockStack(ids.fresh(STACK_ID_PREFIX), [panel]);
    return withWindowRoot(layout, window, insertBeside(root, target, created, edge, clampShare(share), ids));
}

function insertAtRootEdge(layout: DockLayout, panel: DockPanelId, edge: DockEdge, share: number, window: string): DockLayout {
    const ids = new DockIds(layout);
    const created = dockStack(ids.fresh(STACK_ID_PREFIX), [panel]);
    const root = dockWindowRoot(layout, window);
    if (root === undefined) return window === MAIN_DOCK_WINDOW ? withWindowRoot(layout, window, created) : layout;
    const clamped = clampShare(share);
    if (root.kind === "split" && root.axis === EDGE_AXES[edge]) {
        const leading = isLeadingEdge(edge);
        const scaled = root.sizes.map(size => size * (WHOLE - clamped));
        return withWindowRoot(layout, window, {
            ...root,
            children: leading ? [created, ...root.children] : [...root.children, created],
            sizes: leading ? [clamped, ...scaled] : [...scaled, clamped],
        });
    }
    return withWindowRoot(layout, window, besideSplit(ids.fresh(SPLIT_ID_PREFIX), root, created, edge, clamped));
}

function insertAsTab(layout: DockLayout, panel: DockPanelId, target: string, index: number): DockLayout {
    const stack = findDockStack(layout, target);
    if (stack === undefined) return layout;
    const panels = [...stack.panels];
    panels.splice(Math.max(0, Math.min(index, panels.length)), 0, panel);
    return replaceInLayout(layout, stack.id, () => ({...stack, panels, active: panel}));
}

function reorderTab(layout: DockLayout, stack: DockStack, panel: DockPanelId, index: number): DockLayout {
    const from = stack.panels.indexOf(panel);
    const to = Math.max(0, Math.min(index, stack.panels.length));
    const placed = to > from ? to - 1 : to;
    if (placed === from) return activatePanel(layout, panel);
    const panels = stack.panels.filter(open => open !== panel);
    panels.splice(placed, 0, panel);
    return replaceInLayout(layout, stack.id, () => ({...stack, panels, active: panel}));
}

function moveToRootEdge(layout: DockLayout, panel: DockPanelId, target: DockRootTarget): DockLayout {
    const window = target.window ?? MAIN_DOCK_WINDOW;
    if (window !== MAIN_DOCK_WINDOW && findFloatingWindow(layout, window) === undefined) return layout;
    const source = stackOfPanel(layout, panel);
    if (source !== undefined && dockWindowRoot(layout, window) === source && source.panels.length === 1) return layout;
    return normalizeDockLayout(insertAtRootEdge(withoutPanel(layout, panel), panel, target.rootEdge, target.share ?? ROOT_EDGE_SHARE, window));
}

export function movePanel(layout: DockLayout, panel: DockPanelId, target: DockTarget): DockLayout {
    if ("rootEdge" in target) return moveToRootEdge(layout, panel, target);
    const source = stackOfPanel(layout, panel);
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
    const anchorPanel = "withPanel" in home ? home.withPanel : home.nextTo;
    const anchor = dockStacks(layout.root).find(stack => stack.panels.includes(anchorPanel));
    if (anchor === undefined) return undefined;
    if ("withPanel" in home) return {stack: anchor.id, index: anchor.panels.length};
    return home.share === undefined ? {stack: anchor.id, edge: home.edge} : {stack: anchor.id, edge: home.edge, share: home.share};
}

function placeAtHome(layout: DockLayout, panel: DockPanelId, homes: readonly DockHome[]): DockLayout {
    for (const home of homes) {
        const target = homeTarget(layout, home);
        if (target !== undefined) return movePanel(layout, panel, target);
    }
    const first = dockStacks(layout.root)[0];
    return movePanel(layout, panel, first === undefined ? {rootEdge: DEFAULT_HOME_EDGE} : {stack: first.id, index: first.panels.length});
}

export function openPanel(layout: DockLayout, panel: DockPanelId, homes: readonly DockHome[] = []): DockLayout {
    if (isDockPanelOpen(layout, panel)) return activatePanel(layout, panel);
    const remembered = layout.closed.find(entry => entry.panel === panel);
    const previous = remembered === undefined ? undefined : findDockStack(layout, remembered.stack);
    if (remembered !== undefined && previous !== undefined) return movePanel(layout, panel, {stack: previous.id, index: Math.min(remembered.index, previous.panels.length)});
    return placeAtHome(layout, panel, homes);
}

export function dockPanelHome(layout: DockLayout, panel: DockPanelId, homes: readonly DockHome[] = []): DockLayout {
    if (dockWindowOfPanel(layout, panel) === MAIN_DOCK_WINDOW) return activatePanel(layout, panel);
    return placeAtHome(withoutPanel(layout, panel), panel, homes);
}

function sameBounds(a: DockBounds, b: DockBounds): boolean {
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function moveFloatingWindow(layout: DockLayout, id: string, bounds: DockBounds): DockLayout {
    const window = findFloatingWindow(layout, id);
    if (window === undefined || !isScreenBounds(bounds) || sameBounds(window.bounds, bounds)) return layout;
    return {...layout, floating: layout.floating.map(entry => entry.id === id ? {...entry, bounds: {x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height}} : entry)};
}

export function floatPanel(layout: DockLayout, panel: DockPanelId, bounds: DockBounds): DockLayout {
    if (!isScreenBounds(bounds)) return layout;
    const window = dockWindowOfPanel(layout, panel);
    if (window !== undefined && hasOwnFloatingWindow(layout, panel)) return moveFloatingWindow(layout, window, bounds);
    const ids = new DockIds(layout);
    const created: DockFloatingWindow = {
        id: ids.fresh(FLOATING_ID_PREFIX),
        bounds: {x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height},
        root: dockStack(ids.fresh(STACK_ID_PREFIX), [panel]),
    };
    const removed = withoutPanel(layout, panel);
    return normalizeDockLayout({...removed, floating: [...removed.floating, created]});
}

export function closeFloatingWindow(layout: DockLayout, id: string): DockLayout {
    const window = findFloatingWindow(layout, id);
    if (window === undefined) return layout;
    const remembered = dockStacks(window.root).flatMap(stack => stack.panels.flatMap((panel, index): DockClosedPanel[] => isFirstDockPanelInstance(panel) ? [{panel, stack: stack.id, index}] : []));
    return normalizeDockLayout({
        ...layout,
        floating: layout.floating.filter(entry => entry.id !== id),
        closed: [...layout.closed, ...remembered],
    });
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
    if (split === undefined || sizes.length !== split.children.length || !sizes.every(isPositiveSize)) return layout;
    return replaceInLayout(layout, splitId, () => ({...split, sizes: proportions(sizes)}));
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

function normalizeFloating(windows: readonly DockFloatingWindow[], seen: Set<DockPanelId>): DockFloatingWindow[] {
    const ids = new Set<string>();
    return windows.flatMap(window => {
        if (ids.has(window.id)) return [];
        const root = normalizeNode(window.root, seen);
        if (root === undefined) return [];
        ids.add(window.id);
        return [{...window, root}];
    });
}

export function normalizeDockLayout(layout: DockLayout): DockLayout {
    const seen = new Set<DockPanelId>();
    const root = layout.root === undefined ? undefined : normalizeNode(layout.root, seen);
    const floating = normalizeFloating(layout.floating, seen);
    const latest = new Map<DockPanelId, DockClosedPanel>();
    for (const entry of layout.closed) {
        latest.delete(entry.panel);
        if (!seen.has(entry.panel) && isFirstDockPanelInstance(entry.panel)) latest.set(entry.panel, entry);
    }
    return {version: DOCK_LAYOUT_VERSION, root, closed: [...latest.values()], floating};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function claimId(value: unknown, ids: Set<string>): string | undefined {
    if (typeof value !== "string" || value.length === 0 || ids.has(value)) return undefined;
    ids.add(value);
    return value;
}

function parseStack(record: Record<string, unknown>, id: string): ParsedNode {
    if (!Array.isArray(record.panels)) return undefined;
    const panels = record.panels.filter(isDockPanelId);
    if (panels.length === 0) return REMOVED;
    return dockStack(id, panels, isDockPanelId(record.active) && panels.includes(record.active) ? record.active : panels[0]);
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
    if (!isDockPanelId(panel) || typeof stack !== "string" || typeof index !== "number" || !Number.isInteger(index) || index < 0) return [];
    return [{panel, stack, index}];
}

function parseFloating(value: unknown, ids: Set<string>): DockFloatingWindow[] {
    if (!isRecord(value) || !isScreenBounds(value.bounds) || value.id === MAIN_DOCK_WINDOW) return [];
    const id = claimId(value.id, ids);
    if (id === undefined) return [];
    const root = parseNode(value.root, ids);
    if (root === undefined || root === REMOVED) return [];
    const {x, y, width, height} = value.bounds;
    return [{id, bounds: {x, y, width, height}, root}];
}

export function parseDockLayout(text: string | null): DockLayout | undefined {
    if (text === null) return undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return undefined;
    }
    if (!isRecord(parsed) || !READABLE_VERSIONS.has(parsed.version)) return undefined;
    const ids = new Set<string>();
    const root = parsed.root === undefined || parsed.root === null ? REMOVED : parseNode(parsed.root, ids);
    if (root === undefined) return undefined;
    const closed = Array.isArray(parsed.closed) ? parsed.closed.flatMap(parseClosed) : [];
    const floating = Array.isArray(parsed.floating) ? parsed.floating.flatMap(entry => parseFloating(entry, ids)) : [];
    return normalizeDockLayout({version: DOCK_LAYOUT_VERSION, root: root ?? undefined, closed, floating});
}

export function dockLayoutText(layout: DockLayout): string {
    return JSON.stringify(layout);
}
