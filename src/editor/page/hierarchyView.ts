import type {Entity} from "../../engine/core";
import type {EditorEntitySummary} from "../editorProtocol";
import {createButton, createElement, hasCommandModifier} from "./dom";
import type {EditorWorkspace} from "./editorWorkspace";
import {buildEntityTree, ENTITY_TREE_ROW_LIMIT, entitySummaryLabel, entityTreeRows} from "./entityTree";
import type {EntityTreeNode, EntityTreeRow} from "./entityTree";
import {dropTargetFor, dropZoneAt, isDropAllowed, parentLookupOf, siblingListsOf, UNPARENT_TARGET} from "./hierarchyDrop";
import type {DropTarget, DropZone} from "./hierarchyDrop";
import {parseHierarchySearch} from "./hierarchySearch";
import {isAssetKind} from "./projectFiles";
import {MENU_SEPARATOR, showPopupMenu} from "./popupMenu";
import type {MenuItem} from "./popupMenu";

const INDENT_PX_PER_LEVEL = 14;
const BASE_INDENT_PX = 4;
const MAX_INDENTED_DEPTH = 24;
const SEARCH_PLACEHOLDER = "Search (t:Type filters components)";
const DRAG_TEXT_TYPE = "text/plain";
const DROP_CLASSES: Readonly<Record<DropZone, string>> = {before: "drop-before", onto: "drop-onto", after: "drop-after"};
const EMPTY_DROP_CLASS = "drop-root";
const SELECTED_CLASS = "selected";
const NO_ROW_INDEX = -1;

interface RenderedRow {
    readonly row: EntityTreeRow;
    readonly element: HTMLElement;
}

function rowKey(row: EntityTreeRow): string {
    const summary = row.summary;
    return `${summary.entity}:${row.depth}:${row.hasChildren ? (row.expanded ? 2 : 1) : 0}:${summary.enabled ? 1 : 0}:${summary.prefabSourcePath ?? ""}:${entitySummaryLabel(summary)}`;
}

export class HierarchyView {
    private readonly search: HTMLInputElement;
    private readonly list: HTMLElement;
    private readonly note: HTMLElement;
    private readonly heading: HTMLElement;
    private readonly collapsed = new Set<Entity>();
    private roots: EntityTreeNode[] = [];
    private rendered: RenderedRow[] = [];
    private renderedKey: string | undefined;
    private shownSelectionKey: string | undefined;
    private anchor: Entity | undefined;
    private renaming: Entity | undefined;
    private dropIndicator: {readonly element: HTMLElement, readonly className: string} | undefined;

    public constructor(container: HTMLElement, private readonly workspace: EditorWorkspace) {
        const document = container.ownerDocument;
        const header = createElement(document, "div", "panel-header");
        this.heading = createElement(document, "h2", "panel-heading", "Hierarchy");
        header.append(this.heading, createButton(document, {className: "panel-header-button", text: "+", title: "Create an empty entity", onClick: () => void workspace.createEmpty(null)}));
        this.search = createElement(document, "input", "field-input hierarchy-search");
        this.search.type = "search";
        this.search.placeholder = SEARCH_PLACEHOLDER;
        this.search.setAttribute("aria-label", "Search entities");
        this.search.addEventListener("input", () => this.render());
        this.list = createElement(document, "div", "hierarchy-list");
        this.list.tabIndex = 0;
        this.list.setAttribute("role", "tree");
        this.list.setAttribute("aria-multiselectable", "true");
        this.note = createElement(document, "p", "tree-note");
        this.note.hidden = true;
        container.replaceChildren(header, this.search, this.list, this.note);

        this.list.addEventListener("click", event => this.onClick(event));
        this.list.addEventListener("dblclick", event => {
            const entity = this.entityAt(event.target);
            if (entity !== undefined) this.beginRename(entity);
        });
        this.list.addEventListener("contextmenu", event => this.onContextMenu(event));
        this.list.addEventListener("keydown", event => this.onKeyDown(event));
        this.list.addEventListener("dragstart", event => this.onDragStart(event));
        this.list.addEventListener("dragend", () => this.endDrag());
        this.list.addEventListener("dragover", event => this.onDragOver(event));
        this.list.addEventListener("dragleave", event => {
            if (!(event.relatedTarget instanceof Node) || !this.list.contains(event.relatedTarget)) this.clearDropIndicator();
        });
        this.list.addEventListener("drop", event => this.onDrop(event));

        workspace.on("entities", () => {
            this.roots = buildEntityTree(workspace.entities);
            this.render();
        });
        workspace.on("selection", () => this.render());
        this.render();
    }

    public beginRename(entity: Entity): void {
        const rendered = this.rendered.find(entry => entry.row.summary.entity === entity);
        if (rendered === undefined) return;
        const label = rendered.element.querySelector<HTMLElement>(".tree-label");
        if (label === null) return;
        this.renaming = entity;
        const document = this.list.ownerDocument;
        const input = createElement(document, "input", "field-input tree-rename");
        input.type = "text";
        input.spellcheck = false;
        input.value = rendered.row.summary.name ?? "";
        input.setAttribute("aria-label", "New name");
        let finished = false;
        const finish = (commit: boolean): void => {
            if (finished) return;
            finished = true;
            this.renaming = undefined;
            this.renderedKey = undefined;
            if (commit) {
                const name = input.value.trim();
                void this.workspace.rename(entity, name.length === 0 ? null : name);
            }
            this.render();
            this.list.focus();
        };
        input.addEventListener("keydown", event => {
            event.stopPropagation();
            if (event.key === "Enter") finish(true);
            else if (event.key === "Escape") finish(false);
        });
        input.addEventListener("blur", () => finish(true));
        input.addEventListener("click", event => event.stopPropagation());
        label.replaceWith(input);
        input.focus();
        input.select();
    }

    private visibleEntities(): Entity[] {
        return this.rendered.map(entry => entry.row.summary.entity);
    }

    private render(): void {
        if (this.renaming !== undefined) return;
        const shown = entityTreeRows(this.roots, parseHierarchySearch(this.search.value), ENTITY_TREE_ROW_LIMIT, this.collapsed);
        this.heading.textContent = `Hierarchy (${this.workspace.entities.length})`;
        const selected = new Set(this.workspace.selection);
        const key = `${shown.hiddenCount}|${shown.rows.map(rowKey).join("\n")}`;
        if (key !== this.renderedKey) {
            this.renderedKey = key;
            this.rendered = shown.rows.map(row => ({row, element: this.rowElement(row, selected.has(row.summary.entity))}));
            this.list.replaceChildren(...this.rendered.map(entry => entry.element));
            this.note.hidden = shown.hiddenCount === 0;
            this.note.textContent = `${shown.hiddenCount} more not shown (first ${ENTITY_TREE_ROW_LIMIT} rows); search to see more`;
        }
        this.showSelection(selected);
    }

    private showSelection(selected: ReadonlySet<Entity>): void {
        const selectionKey = this.workspace.selection.join(",");
        for (const {row, element} of this.rendered) {
            const isSelected = selected.has(row.summary.entity);
            element.classList.toggle(SELECTED_CLASS, isSelected);
            element.setAttribute("aria-selected", String(isSelected));
        }
        if (selectionKey === this.shownSelectionKey) return;
        this.shownSelectionKey = selectionKey;
        const primary = this.workspace.primary;
        this.rendered.find(entry => entry.row.summary.entity === primary)?.element.scrollIntoView({block: "nearest"});
    }

    private rowElement(row: EntityTreeRow, selected: boolean): HTMLElement {
        const document = this.list.ownerDocument;
        const summary = row.summary;
        const element = createElement(document, "div", "tree-row");
        element.classList.toggle(SELECTED_CLASS, selected);
        element.classList.toggle("disabled", !summary.enabled);
        element.classList.toggle("prefab-instance", summary.prefabSourcePath !== null);
        element.setAttribute("role", "treeitem");
        element.setAttribute("aria-level", String(row.depth + 1));
        element.setAttribute("aria-selected", String(selected));
        if (row.hasChildren) element.setAttribute("aria-expanded", String(row.expanded));
        element.draggable = true;
        element.dataset.entity = String(summary.entity);
        element.style.paddingLeft = `${BASE_INDENT_PX + Math.min(row.depth, MAX_INDENTED_DEPTH) * INDENT_PX_PER_LEVEL}px`;
        const arrow = createElement(document, "span", row.hasChildren ? (row.expanded ? "tree-arrow expanded" : "tree-arrow") : "tree-arrow leaf");
        arrow.dataset.toggle = String(summary.entity);
        const label = createElement(document, "span", "tree-label", entitySummaryLabel(summary));
        label.title = summary.prefabSourcePath === null ? label.textContent ?? "" : `${label.textContent} (prefab ${summary.prefabSourcePath})`;
        element.append(arrow, label);
        return element;
    }

    private rowOf(target: EventTarget | null): HTMLElement | undefined {
        if (!(target instanceof Element)) return undefined;
        return target.closest<HTMLElement>(".tree-row") ?? undefined;
    }

    private entityAt(target: EventTarget | null): Entity | undefined {
        const row = this.rowOf(target);
        return row === undefined ? undefined : Number(row.dataset.entity) as Entity;
    }

    private onClick(event: MouseEvent): void {
        const target = event.target;
        if (target instanceof Element && target.closest("[data-toggle]") !== null) {
            const entity = Number((target.closest("[data-toggle]") as HTMLElement).dataset.toggle) as Entity;
            if (this.collapsed.has(entity)) this.collapsed.delete(entity);
            else this.collapsed.add(entity);
            this.render();
            return;
        }
        const entity = this.entityAt(target);
        if (entity === undefined) {
            if (!hasCommandModifier(event) && !event.shiftKey) this.workspace.select([]);
            return;
        }
        this.selectWithModifiers(entity, event);
    }

    private selectWithModifiers(entity: Entity, event: {readonly ctrlKey: boolean, readonly metaKey: boolean, readonly shiftKey: boolean}): void {
        if (event.shiftKey && this.anchor !== undefined) {
            const visible = this.visibleEntities();
            const from = visible.indexOf(this.anchor);
            const to = visible.indexOf(entity);
            if (from !== NO_ROW_INDEX && to !== NO_ROW_INDEX) {
                const range = visible.slice(Math.min(from, to), Math.max(from, to) + 1);
                const base = hasCommandModifier(event) ? this.workspace.selection.filter(selected => !range.includes(selected)) : [];
                this.workspace.select([...base, ...(from <= to ? range : range.reverse())]);
                return;
            }
        }
        this.anchor = entity;
        if (hasCommandModifier(event)) this.workspace.toggleSelected(entity);
        else this.workspace.select([entity]);
    }

    private onKeyDown(event: KeyboardEvent): void {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const visible = this.visibleEntities();
        const primary = this.workspace.primary;
        const index = primary === undefined ? NO_ROW_INDEX : visible.indexOf(primary);
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            if (primary === undefined) return;
            if (event.key === "ArrowLeft") this.collapsed.add(primary);
            else this.collapsed.delete(primary);
            this.render();
            return;
        }
        const next = visible[event.key === "ArrowDown" ? Math.min(visible.length - 1, index + 1) : Math.max(0, index - 1)];
        if (next !== undefined) this.selectWithModifiers(next, {ctrlKey: false, metaKey: false, shiftKey: event.shiftKey});
    }

    private onContextMenu(event: MouseEvent): void {
        event.preventDefault();
        const workspace = this.workspace;
        const entity = this.entityAt(event.target);
        if (entity !== undefined && !workspace.selection.includes(entity)) {
            this.anchor = entity;
            workspace.select([entity]);
        }
        const selection = entity === undefined ? [] : workspace.selection;
        const hasSelection = selection.length > 0;
        const items: MenuItem[] = [
            {label: "Create Empty", run: () => void workspace.createEmpty(null)},
            {label: "Create Empty Child", disabled: entity === undefined, run: () => entity !== undefined && void workspace.createEmpty(entity)},
            MENU_SEPARATOR,
            {label: "Copy", shortcut: "Ctrl+C", disabled: !hasSelection, run: () => void workspace.copy(selection)},
            {label: "Paste", shortcut: "Ctrl+V", disabled: workspace.entityClipboard === undefined, run: () => void workspace.paste()},
            {label: "Duplicate", shortcut: "Ctrl+D", disabled: !hasSelection, run: () => void workspace.duplicate(selection)},
            {label: "Rename", shortcut: "F2", disabled: entity === undefined, run: () => entity !== undefined && this.beginRename(entity)},
            {label: "Delete", shortcut: "Del", disabled: !hasSelection, run: () => void workspace.destroy(selection)},
        ];
        showPopupMenu(this.list.ownerDocument, event.clientX, event.clientY, items);
    }

    private onDragStart(event: DragEvent): void {
        const entity = this.entityAt(event.target);
        if (entity === undefined || event.dataTransfer === null) return;
        const selection = this.workspace.selection;
        const entities = selection.includes(entity) ? selection : [entity];
        this.workspace.drag = {kind: "entities", entities};
        event.dataTransfer.effectAllowed = "copyMove";
        const summary = this.workspace.summaryOf(entity);
        event.dataTransfer.setData(DRAG_TEXT_TYPE, summary === undefined ? String(entity) : entitySummaryLabel(summary));
    }

    private endDrag(): void {
        this.workspace.drag = undefined;
        this.clearDropIndicator();
    }

    private targetFor(event: DragEvent): {readonly target: DropTarget, readonly indicator: HTMLElement, readonly className: string} | undefined {
        const rowElement = this.rowOf(event.target);
        if (rowElement === undefined) return {target: UNPARENT_TARGET, indicator: this.list, className: EMPTY_DROP_CLASS};
        const entity = Number(rowElement.dataset.entity) as Entity;
        const rendered = this.rendered.find(entry => entry.row.summary.entity === entity);
        if (rendered === undefined) return undefined;
        const bounds = rowElement.getBoundingClientRect();
        const zone = dropZoneAt(event.clientY - bounds.top, bounds.height);
        const summary: EditorEntitySummary = rendered.row.summary;
        const target = dropTargetFor({entity, parent: summary.parent, expandedWithChildren: rendered.row.expanded}, zone, siblingListsOf(this.workspace.links()));
        return {target, indicator: rowElement, className: DROP_CLASSES[zone]};
    }

    private acceptsDrag(target: DropTarget): boolean {
        const drag = this.workspace.drag;
        if (drag === undefined) return false;
        if (drag.kind === "asset") return isAssetKind(drag.fileKind);
        return isDropAllowed(target, new Set(drag.entities), parentLookupOf(this.workspace.links()));
    }

    private onDragOver(event: DragEvent): void {
        const found = this.targetFor(event);
        if (found === undefined || !this.acceptsDrag(found.target)) {
            this.clearDropIndicator();
            return;
        }
        event.preventDefault();
        if (event.dataTransfer !== null) event.dataTransfer.dropEffect = this.workspace.drag?.kind === "asset" ? "copy" : "move";
        if (this.dropIndicator?.element === found.indicator && this.dropIndicator.className === found.className) return;
        this.clearDropIndicator();
        found.indicator.classList.add(found.className);
        this.dropIndicator = {element: found.indicator, className: found.className};
    }

    private onDrop(event: DragEvent): void {
        const found = this.targetFor(event);
        const drag = this.workspace.drag;
        this.endDrag();
        if (found === undefined || drag === undefined) return;
        event.preventDefault();
        if (drag.kind === "asset") {
            if (isAssetKind(drag.fileKind)) void this.workspace.instantiateAsset(drag.path, {target: found.target});
            return;
        }
        if (isDropAllowed(found.target, new Set(drag.entities), parentLookupOf(this.workspace.links()))) void this.workspace.reparent(drag.entities, found.target);
    }

    private clearDropIndicator(): void {
        if (this.dropIndicator === undefined) return;
        this.dropIndicator.element.classList.remove(this.dropIndicator.className);
        this.dropIndicator = undefined;
    }
}
