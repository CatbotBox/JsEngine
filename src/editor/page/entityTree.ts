import type {Entity} from "../../engine/core";
import type {EditorEntitySummary} from "../editorProtocol";
import {entityLabel} from "./fieldValueText";
import {isEmptySearch, matchesHierarchySearch} from "./hierarchySearch";
import type {HierarchySearch} from "./hierarchySearch";

export interface EntityTreeNode {
    readonly summary: EditorEntitySummary;
    readonly children: EntityTreeNode[];
}

export interface EntityTreeRow {
    readonly summary: EditorEntitySummary;
    readonly depth: number;
    readonly hasChildren: boolean;
    readonly expanded: boolean;
}

export interface EntityTreeRows {
    readonly rows: readonly EntityTreeRow[];
    readonly hiddenCount: number;
}

export const ENTITY_TREE_ROW_LIMIT = 500;

const ROOT_DEPTH = 0;
const NO_PARENT_INDEX = -1;
const NOTHING_COLLAPSED: ReadonlySet<Entity> = new Set();

interface TreeVisit {
    readonly node: EntityTreeNode;
    readonly depth: number;
    readonly parentIndex: number;
    readonly underCollapsed: boolean;
}

export function entitySummaryLabel(summary: EditorEntitySummary): string {
    return entityLabel(summary.entity, summary.name);
}

function markReachable(roots: readonly EntityTreeNode[], reached: Set<EntityTreeNode>): void {
    const pending = [...roots];
    while (pending.length > 0) {
        const node = pending.pop()!;
        if (reached.has(node)) continue;
        reached.add(node);
        pending.push(...node.children);
    }
}

function bySiblingIndex(a: EntityTreeNode, b: EntityTreeNode): number {
    return a.summary.siblingIndex - b.summary.siblingIndex;
}

export function buildEntityTree(entities: readonly EditorEntitySummary[]): EntityTreeNode[] {
    const nodes = new Map<Entity, EntityTreeNode>();
    for (const summary of entities) nodes.set(summary.entity, {summary, children: []});
    const parentNodeOf = (summary: EditorEntitySummary): EntityTreeNode | undefined =>
        summary.parent === null || summary.parent === summary.entity ? undefined : nodes.get(summary.parent);
    const roots: EntityTreeNode[] = [];
    for (const summary of entities) {
        const node = nodes.get(summary.entity)!;
        const parent = parentNodeOf(summary);
        if (parent === undefined) roots.push(node);
        else parent.children.push(node);
    }
    roots.sort(bySiblingIndex);
    for (const node of nodes.values()) node.children.sort(bySiblingIndex);
    const reached = new Set<EntityTreeNode>();
    markReachable(roots, reached);
    for (const summary of entities) {
        const node = nodes.get(summary.entity)!;
        if (reached.has(node)) continue;
        const siblings = parentNodeOf(summary)!.children;
        siblings.splice(siblings.indexOf(node), 1);
        roots.push(node);
        markReachable([node], reached);
    }
    return roots;
}

function preorder(roots: readonly EntityTreeNode[], collapsed: ReadonlySet<Entity>): TreeVisit[] {
    const visits: TreeVisit[] = [];
    const pending: TreeVisit[] = [];
    for (let i = roots.length - 1; i >= 0; i--) pending.push({node: roots[i], depth: ROOT_DEPTH, parentIndex: NO_PARENT_INDEX, underCollapsed: false});
    while (pending.length > 0) {
        const visit = pending.pop()!;
        const index = visits.length;
        visits.push(visit);
        const children = visit.node.children;
        const hidesChildren = visit.underCollapsed || collapsed.has(visit.node.summary.entity);
        for (let i = children.length - 1; i >= 0; i--) {
            pending.push({node: children[i], depth: visit.depth + 1, parentIndex: index, underCollapsed: hidesChildren});
        }
    }
    return visits;
}

export function entityTreeRows(
    roots: readonly EntityTreeNode[],
    search: HierarchySearch,
    rowLimit: number,
    collapsed: ReadonlySet<Entity> = NOTHING_COLLAPSED,
): EntityTreeRows {
    const visits = preorder(roots, collapsed);
    const searching = !isEmptySearch(search);
    const shown = visits.map(visit => searching
        ? matchesHierarchySearch(search, entitySummaryLabel(visit.node.summary), visit.node.summary.componentTypeNames)
        : !visit.underCollapsed);
    if (searching) {
        for (let i = visits.length - 1; i >= 0; i--) {
            const parentIndex = visits[i].parentIndex;
            if (shown[i] && parentIndex !== NO_PARENT_INDEX) shown[parentIndex] = true;
        }
    }
    const rows: EntityTreeRow[] = [];
    let hiddenCount = 0;
    for (let i = 0; i < visits.length; i++) {
        if (!shown[i]) continue;
        const {node, depth} = visits[i];
        const hasChildren = node.children.length > 0;
        const expanded = hasChildren && (searching || !collapsed.has(node.summary.entity));
        if (rows.length < rowLimit) rows.push({summary: node.summary, depth, hasChildren, expanded});
        else hiddenCount++;
    }
    return {rows, hiddenCount};
}

export function preorderEntities(roots: readonly EntityTreeNode[]): Entity[] {
    return preorder(roots, NOTHING_COLLAPSED).map(visit => visit.node.summary.entity);
}
