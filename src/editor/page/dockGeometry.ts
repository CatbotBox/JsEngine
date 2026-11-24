import {EDGE_AXES, isLeadingEdge, ROOT_EDGE_SHARE, STACK_EDGE_SHARE} from "./dockLayout";
import type {DockAxis, DockEdge, DockNode, DockPanelId, DockTarget} from "./dockLayout";

export interface DockRect {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

export interface DockSize {
    readonly widthPx: number;
    readonly heightPx: number;
}

export type DockMinimums = Readonly<Record<DockPanelId, DockSize>>;

export interface DockSplitPlacement {
    readonly axis: DockAxis;
    readonly lengths: readonly number[];
    readonly minimums: readonly number[];
}

export interface DockSplitterPlacement {
    readonly split: string;
    readonly index: number;
    readonly axis: DockAxis;
    readonly rect: DockRect;
}

export interface DockPlacement {
    readonly stacks: ReadonlyMap<string, DockRect>;
    readonly splits: ReadonlyMap<string, DockSplitPlacement>;
    readonly splitters: readonly DockSplitterPlacement[];
}

export interface DockStackArea {
    readonly stack: string;
    readonly rect: DockRect;
    readonly strip: DockRect;
    readonly tabs: readonly DockRect[];
}

export interface DockDropArea {
    readonly root: DockRect;
    readonly stacks: readonly DockStackArea[];
}

export interface DockDrop {
    readonly target: DockTarget;
    readonly preview: DockRect;
}

export const SPLITTER_THICKNESS_PX = 5;
export const ROOT_EDGE_BAND_PX = 16;
export const EDGE_ZONE_SHARE = 0.3;
export const EMPTY_PLACEMENT: DockPlacement = {stacks: new Map(), splits: new Map(), splitters: []};

const NO_SIZE: DockSize = {widthPx: 0, heightPx: 0};
const HALF = 2;
const WHOLE = 1;
const NOT_FOUND = -1;
const EDGES: readonly DockEdge[] = ["left", "right", "top", "bottom"];

function lengthAlong(size: DockSize, axis: DockAxis): number {
    return axis === "row" ? size.widthPx : size.heightPx;
}

export function minimumSizeOf(node: DockNode, minimums: DockMinimums, splitterPx: number = SPLITTER_THICKNESS_PX): DockSize {
    if (node.kind === "stack") {
        return node.panels.reduce((size, panel) => ({
            widthPx: Math.max(size.widthPx, minimums[panel].widthPx),
            heightPx: Math.max(size.heightPx, minimums[panel].heightPx),
        }), NO_SIZE);
    }
    const sizes = node.children.map(child => minimumSizeOf(child, minimums, splitterPx));
    const gaps = splitterPx * (node.children.length - 1);
    const along = sizes.reduce((sum, size) => sum + lengthAlong(size, node.axis), gaps);
    const across = Math.max(...sizes.map(size => lengthAlong(size, node.axis === "row" ? "column" : "row")));
    return node.axis === "row" ? {widthPx: along, heightPx: across} : {widthPx: across, heightPx: along};
}

function sum(values: readonly number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

export function distributedLengths(shares: readonly number[], minimums: readonly number[], availablePx: number): number[] {
    const space = Math.max(0, availablePx);
    const minimumTotal = sum(minimums);
    if (minimumTotal >= space) return minimumTotal > 0 ? minimums.map(minimum => minimum * space / minimumTotal) : shares.map(() => space / shares.length);
    const fixed = shares.map(() => false);
    for (;;) {
        const freeShare = sum(shares.filter((_, index) => !fixed[index]));
        const freeSpace = space - sum(minimums.filter((_, index) => fixed[index]));
        const freeCount = fixed.filter(isFixed => !isFixed).length;
        const lengths = shares.map((share, index) => fixed[index] ? minimums[index] : freeShare > 0 ? share / freeShare * freeSpace : freeSpace / freeCount);
        const violated = lengths.map((length, index) => !fixed[index] && length < minimums[index]);
        if (!violated.includes(true)) return lengths;
        violated.forEach((isViolated, index) => {
            if (isViolated) fixed[index] = true;
        });
    }
}

export function resizedLengths(lengths: readonly number[], boundary: number, deltaPx: number, minimums: readonly number[]): number[] {
    const before = lengths[boundary];
    const after = lengths[boundary + 1];
    if (before === undefined || after === undefined) return [...lengths];
    const pair = before + after;
    const lowest = minimums[boundary] ?? 0;
    const highest = pair - (minimums[boundary + 1] ?? 0);
    if (lowest > highest) return [...lengths];
    const resized = Math.max(lowest, Math.min(highest, before + deltaPx));
    const next = [...lengths];
    next[boundary] = resized;
    next[boundary + 1] = pair - resized;
    return next;
}

export function sharesOf(lengths: readonly number[]): number[] {
    const total = sum(lengths);
    return total > 0 ? lengths.map(length => length / total) : lengths.map(() => WHOLE / lengths.length);
}

function rectAlong(area: DockRect, axis: DockAxis, start: number, end: number): DockRect {
    return axis === "row"
        ? {left: start, top: area.top, width: end - start, height: area.height}
        : {left: area.left, top: start, width: area.width, height: end - start};
}

export function placeDock(root: DockNode | undefined, area: DockRect, minimums: DockMinimums, splitterPx: number = SPLITTER_THICKNESS_PX): DockPlacement {
    const stacks = new Map<string, DockRect>();
    const splits = new Map<string, DockSplitPlacement>();
    const splitters: DockSplitterPlacement[] = [];
    const place = (node: DockNode, rect: DockRect): void => {
        if (node.kind === "stack") {
            stacks.set(node.id, rect);
            return;
        }
        const axis = node.axis;
        const childMinimums = node.children.map(child => lengthAlong(minimumSizeOf(child, minimums, splitterPx), axis));
        const along = axis === "row" ? rect.width : rect.height;
        const lengths = distributedLengths(node.sizes, childMinimums, along - splitterPx * (node.children.length - 1));
        splits.set(node.id, {axis, lengths, minimums: childMinimums});
        let position = axis === "row" ? rect.left : rect.top;
        node.children.forEach((child, index) => {
            const start = Math.round(position);
            position += lengths[index];
            const end = Math.round(position);
            place(child, rectAlong(rect, axis, start, end));
            if (index === node.children.length - 1) return;
            const splitterEnd = Math.round(position + splitterPx);
            splitters.push({split: node.id, index, axis, rect: rectAlong(rect, axis, end, splitterEnd)});
            position += splitterPx;
        });
    };
    if (root !== undefined) place(root, area);
    return {stacks, splits, splitters};
}

function contains(rect: DockRect, x: number, y: number): boolean {
    return x >= rect.left && x < rect.left + rect.width && y >= rect.top && y < rect.top + rect.height;
}

function edgeRect(rect: DockRect, edge: DockEdge, share: number): DockRect {
    const axis = EDGE_AXES[edge];
    const length = (axis === "row" ? rect.width : rect.height) * share;
    if (axis === "row") return {left: isLeadingEdge(edge) ? rect.left : rect.left + rect.width - length, top: rect.top, width: length, height: rect.height};
    return {left: rect.left, top: isLeadingEdge(edge) ? rect.top : rect.top + rect.height - length, width: rect.width, height: length};
}

function edgeDistances(rect: DockRect, x: number, y: number): Readonly<Record<DockEdge, number>> {
    return {left: x - rect.left, right: rect.left + rect.width - x, top: y - rect.top, bottom: rect.top + rect.height - y};
}

function nearestEdge(distances: Readonly<Record<DockEdge, number>>): DockEdge {
    return EDGES.reduce((nearest, edge) => distances[edge] < distances[nearest] ? edge : nearest);
}

function tabIndexAt(x: number, tabs: readonly DockRect[]): number {
    const index = tabs.findIndex(tab => x < tab.left + tab.width / HALF);
    return index === NOT_FOUND ? tabs.length : index;
}

function contentOf(stack: DockStackArea): DockRect {
    const top = Math.min(stack.rect.top + stack.rect.height, stack.strip.top + stack.strip.height);
    return {left: stack.rect.left, top, width: stack.rect.width, height: stack.rect.top + stack.rect.height - top};
}

export function dockDropAt(x: number, y: number, area: DockDropArea, excludedStack?: string): DockDrop | undefined {
    const strip = area.stacks.find(stack => contains(stack.strip, x, y));
    if (strip !== undefined) {
        if (strip.stack === excludedStack) return undefined;
        return {target: {stack: strip.stack, index: tabIndexAt(x, strip.tabs)}, preview: strip.rect};
    }
    if (!contains(area.root, x, y)) return undefined;
    const rootDistances = edgeDistances(area.root, x, y);
    const rootEdge = nearestEdge(rootDistances);
    if (rootDistances[rootEdge] < ROOT_EDGE_BAND_PX) return {target: {rootEdge}, preview: edgeRect(area.root, rootEdge, ROOT_EDGE_SHARE)};
    const hit = area.stacks.find(stack => contains(stack.rect, x, y));
    if (hit === undefined || hit.stack === excludedStack) return undefined;
    const centre: DockDrop = {target: {stack: hit.stack, index: hit.tabs.length}, preview: hit.rect};
    const content = contentOf(hit);
    if (content.width <= 0 || content.height <= 0) return centre;
    const distances = edgeDistances(content, x, y);
    const edge = nearestEdge(distances);
    const extent = EDGE_AXES[edge] === "row" ? content.width : content.height;
    if (distances[edge] / extent >= EDGE_ZONE_SHARE) return centre;
    return {target: {stack: hit.stack, edge}, preview: edgeRect(hit.rect, edge, STACK_EDGE_SHARE)};
}
