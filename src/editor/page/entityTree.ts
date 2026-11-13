import type {Entity} from "../../engine/core";
import type {EditorEntitySummary} from "../editorProtocol";
import {entityLabel} from "./fieldValueText";

export interface EntityTreeNode {
    readonly summary: EditorEntitySummary;
    readonly children: EntityTreeNode[];
}

export interface EntityTreeRow {
    readonly summary: EditorEntitySummary;
    readonly depth: number;
}

export interface EntityTreeRows {
    readonly rows: readonly EntityTreeRow[];
    readonly hiddenCount: number;
}

export interface EntityTreeActions {
    select(entity: Entity): void;
    addChild(parent: Entity): void;
    destroy(entity: Entity): void;
}

export const ENTITY_TREE_ROW_LIMIT = 500;

const ROOT_DEPTH = 0;
const NO_PARENT_INDEX = -1;
const INDENT_REM_PER_LEVEL = 0.9;
const MAX_INDENTED_DEPTH = 12;
const ACTION_SELECT = "select";
const ACTION_ADD_CHILD = "addChild";
const ACTION_DESTROY = "destroy";

interface TreeVisit {
    readonly node: EntityTreeNode;
    readonly depth: number;
    readonly parentIndex: number;
}

function labelOf(summary: EditorEntitySummary): string {
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

function preorder(roots: readonly EntityTreeNode[]): TreeVisit[] {
    const visits: TreeVisit[] = [];
    const pending: TreeVisit[] = [];
    for (let i = roots.length - 1; i >= 0; i--) pending.push({node: roots[i], depth: ROOT_DEPTH, parentIndex: NO_PARENT_INDEX});
    while (pending.length > 0) {
        const visit = pending.pop()!;
        const index = visits.length;
        visits.push(visit);
        const children = visit.node.children;
        for (let i = children.length - 1; i >= 0; i--) pending.push({node: children[i], depth: visit.depth + 1, parentIndex: index});
    }
    return visits;
}

export function entityTreeRows(roots: readonly EntityTreeNode[], filter: string, rowLimit: number): EntityTreeRows {
    const visits = preorder(roots);
    const needle = filter.trim().toLowerCase();
    const shown = visits.map(visit => needle.length === 0 || labelOf(visit.node.summary).toLowerCase().includes(needle));
    if (needle.length > 0) {
        for (let i = visits.length - 1; i >= 0; i--) {
            const parentIndex = visits[i].parentIndex;
            if (shown[i] && parentIndex !== NO_PARENT_INDEX) shown[parentIndex] = true;
        }
    }
    const rows: EntityTreeRow[] = [];
    let hiddenCount = 0;
    for (let i = 0; i < visits.length; i++) {
        if (!shown[i]) continue;
        if (rows.length < rowLimit) rows.push({summary: visits[i].node.summary, depth: visits[i].depth});
        else hiddenCount++;
    }
    return {rows, hiddenCount};
}

function renderKeyOf(shown: EntityTreeRows, selected: Entity | undefined): string {
    const rows = shown.rows.map(({summary, depth}) => `${summary.entity}:${depth}:${summary.enabled ? 1 : 0}:${labelOf(summary)}`);
    return `${selected ?? ""}|${shown.hiddenCount}|${rows.join("\n")}`;
}

export class EntityTreeView {
    private readonly heading: HTMLElement;
    private readonly filterInput: HTMLInputElement;
    private readonly list: HTMLElement;
    private readonly note: HTMLElement;
    private entities: readonly EditorEntitySummary[] = [];
    private roots: EntityTreeNode[] = [];
    private selected: Entity | undefined;
    private renderedKey: string | undefined;

    public constructor(container: HTMLElement, private readonly actions: EntityTreeActions) {
        const document = container.ownerDocument;
        this.heading = document.createElement("h2");
        this.heading.className = "panel-heading";
        this.filterInput = document.createElement("input");
        this.filterInput.type = "search";
        this.filterInput.className = "tree-filter";
        this.filterInput.placeholder = "Filter by name";
        this.filterInput.setAttribute("aria-label", "Filter entities by name");
        this.filterInput.addEventListener("input", () => this.render());
        this.list = document.createElement("div");
        this.list.className = "tree-list";
        this.list.setAttribute("role", "tree");
        this.list.addEventListener("click", event => this.onListClick(event));
        this.note = document.createElement("p");
        this.note.className = "tree-note";
        this.note.hidden = true;
        container.append(this.heading, this.filterInput, this.list, this.note);
        this.render();
    }

    public showEntities(entities: readonly EditorEntitySummary[]): void {
        this.entities = entities;
        this.roots = buildEntityTree(entities);
        this.render();
    }

    public showSelection(entity: Entity | undefined): void {
        this.selected = entity;
        this.render();
    }

    private render(): void {
        const shown = entityTreeRows(this.roots, this.filterInput.value, ENTITY_TREE_ROW_LIMIT);
        this.heading.textContent = `Entities (${this.entities.length})`;
        const key = renderKeyOf(shown, this.selected);
        if (key === this.renderedKey) return;
        this.renderedKey = key;
        this.list.replaceChildren(...shown.rows.map(row => this.rowElement(row)));
        this.note.hidden = shown.hiddenCount === 0;
        this.note.textContent = `${shown.hiddenCount} more not shown (first ${ENTITY_TREE_ROW_LIMIT} rows); filter to see more`;
    }

    private rowElement({summary, depth}: EntityTreeRow): HTMLElement {
        const document = this.list.ownerDocument;
        const row = document.createElement("div");
        row.className = "tree-row";
        row.classList.toggle("selected", summary.entity === this.selected);
        row.classList.toggle("disabled", !summary.enabled);
        row.setAttribute("role", "treeitem");
        row.setAttribute("aria-level", String(depth + 1));
        row.setAttribute("aria-selected", String(summary.entity === this.selected));
        row.style.paddingLeft = `${Math.min(depth, MAX_INDENTED_DEPTH) * INDENT_REM_PER_LEVEL}rem`;
        const label = labelOf(summary);
        row.append(
            this.rowButton(summary.entity, ACTION_SELECT, label, label, "tree-label"),
            this.rowButton(summary.entity, ACTION_ADD_CHILD, "+", `Add a child to ${label}`, "tree-add"),
            this.rowButton(summary.entity, ACTION_DESTROY, "×", `Delete ${label} and its descendants`, "tree-delete"),
        );
        return row;
    }

    private rowButton(entity: Entity, action: string, text: string, title: string, className: string): HTMLButtonElement {
        const button = this.list.ownerDocument.createElement("button");
        button.type = "button";
        button.className = className;
        button.textContent = text;
        button.title = title;
        button.dataset.entity = String(entity);
        button.dataset.action = action;
        return button;
    }

    private onListClick(event: MouseEvent): void {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest<HTMLButtonElement>("button[data-action]");
        if (button === null) return;
        const entity = Number(button.dataset.entity) as Entity;
        switch (button.dataset.action) {
            case ACTION_SELECT:
                this.actions.select(entity);
                break;
            case ACTION_ADD_CHILD:
                this.actions.addChild(entity);
                break;
            case ACTION_DESTROY:
                this.actions.destroy(entity);
                break;
        }
    }
}
