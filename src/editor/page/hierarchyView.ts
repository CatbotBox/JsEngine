import type {Entity} from "../../engine/core";
import type {EditorEntitySummary} from "../editorProtocol";
import {createElement, hasCommandModifier} from "./dom";
import type {EditorWorkspace} from "./editorWorkspace";
import {buildEntityTree, ENTITY_TREE_ROW_LIMIT, entitySummaryLabel} from "./entityTree";
import type {EntityTreeNode, EntityTreeRow} from "./entityTree";
import {dropTargetFor, dropZoneAt, isDropAllowed, parentLookupOf, siblingListsOf, UNPARENT_TARGET} from "./hierarchyDrop";
import type {DropTarget, DropZone} from "./hierarchyDrop";
import {parseHierarchySearch} from "./hierarchySearch";
import {clickedSelection, selectionModifiersOf} from "./listSelection";
import {isAssetKind} from "./projectFiles";
import {showCommandMenu} from "./commandMenus";
import {commandButton} from "./commandButtons";
import type {EditorCommands} from "./editorCommands";
import {hierarchyMenu, sceneMenu} from "./editorMenus";
import {hierarchyRows, sceneGroups} from "./sceneHierarchy";
import type {HierarchyRow, SceneGroup} from "./sceneHierarchy";
import {TAB_DIRTY_MARKER} from "./sceneTabs";

const CREATE_BUTTON_TEXT = "+";
const INDENT_PX_PER_LEVEL = 14;
const BASE_INDENT_PX = 4;
const MAX_INDENTED_DEPTH = 24;
const SCENE_ROW_DEPTH = 1;
const SEARCH_PLACEHOLDER = "Search (t:Type filters components)";
const DRAG_TEXT_TYPE = "text/plain";
const DROP_CLASSES: Readonly<Record<DropZone, string>> = {before: "drop-before", onto: "drop-onto", after: "drop-after"};
const EMPTY_DROP_CLASS = "drop-root";
const SCENE_DROP_CLASS = "drop-onto";
const SELECTED_CLASS = "selected";
const ENTITY_ROW_SELECTOR = ".entity-row";
const SCENE_ROW_SELECTOR = ".scene-row";
const UNLOADED_SUFFIX = " (not loaded)";
const ACTIVE_SCENE_TITLE = "the active scene: new entities go here";
const START_SCENE_TITLE = "the start scene";
const START_BADGE_TEXT = "start";
const NO_ROW_INDEX = -1;

interface RenderedRow {
    readonly row: HierarchyRow;
    readonly element: HTMLElement;
}

interface FoundTarget {
    readonly target: DropTarget;
    readonly sceneId: number | undefined;
    readonly indicator: HTMLElement;
    readonly className: string;
}

function rowKey(row: HierarchyRow): string {
    if (row.kind === "scene") {
        const group = row.group;
        return `scene:${group.key}:${row.expanded ? 1 : 0}:${group.roots.length > 0 ? 1 : 0}:${group.label}:${group.path ?? ""}:${group.active ? 1 : 0}:${group.dirty ? 1 : 0}:${group.loaded ? 1 : 0}:${group.start ? 1 : 0}`;
    }
    const entityRow = row.row;
    const summary = entityRow.summary;
    return `${summary.entity}:${entityRow.depth}:${entityRow.hasChildren ? (entityRow.expanded ? 2 : 1) : 0}:${summary.enabled ? 1 : 0}:${summary.prefabSourcePath ?? ""}:${entitySummaryLabel(summary)}`;
}

function entityRowOf(row: HierarchyRow): EntityTreeRow | undefined {
    return row.kind === "entity" ? row.row : undefined;
}

function indentPx(depth: number): string {
    return `${BASE_INDENT_PX + Math.min(depth, MAX_INDENTED_DEPTH) * INDENT_PX_PER_LEVEL}px`;
}

export class HierarchyView {
    private readonly search: HTMLInputElement;
    private readonly list: HTMLElement;
    private readonly note: HTMLElement;
    private readonly heading: HTMLElement;
    private readonly collapsed = new Set<Entity>();
    private readonly collapsedScenes = new Set<string>();
    private roots: EntityTreeNode[] = [];
    private groups: SceneGroup[] = [];
    private rendered: RenderedRow[] = [];
    private renderedKey: string | undefined;
    private shownSelectionKey: string | undefined;
    private anchor: Entity | undefined;
    private renaming: Entity | undefined;
    private dropIndicator: {readonly element: HTMLElement, readonly className: string} | undefined;

    public constructor(container: HTMLElement, private readonly workspace: EditorWorkspace, private readonly commands: EditorCommands) {
        const document = container.ownerDocument;
        const header = createElement(document, "div", "panel-header");
        this.heading = createElement(document, "h2", "panel-heading", "Hierarchy");
        header.append(this.heading, commandButton(document, commands.registry, commands.entity.createEmpty, {className: "panel-header-button", text: CREATE_BUTTON_TEXT}));
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
        workspace.on("document", () => this.render());
        this.render();
    }

    public beginRename(entity: Entity): void {
        const rendered = this.rendered.find(entry => entityRowOf(entry.row)?.summary.entity === entity);
        const row = rendered === undefined ? undefined : entityRowOf(rendered.row);
        if (rendered === undefined || row === undefined) return;
        const label = rendered.element.querySelector<HTMLElement>(".tree-label");
        if (label === null) return;
        this.renaming = entity;
        const document = this.list.ownerDocument;
        const input = createElement(document, "input", "field-input tree-rename");
        input.type = "text";
        input.spellcheck = false;
        input.value = row.summary.name ?? "";
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
        return this.rendered.flatMap(entry => {
            const row = entityRowOf(entry.row);
            return row === undefined ? [] : [row.summary.entity];
        });
    }

    private render(): void {
        if (this.renaming !== undefined) return;
        const scenes = this.workspace.scenes;
        this.groups = sceneGroups(scenes.activeTab.scenes, scenes.worldScenes, this.roots, scenes.startScene);
        const shown = hierarchyRows(this.groups, parseHierarchySearch(this.search.value), ENTITY_TREE_ROW_LIMIT, this.collapsed, this.collapsedScenes);
        this.heading.textContent = `Hierarchy (${this.workspace.entities.length})`;
        const selected = new Set(this.workspace.selection);
        const key = `${shown.hiddenCount}|${shown.rows.map(rowKey).join("\n")}`;
        if (key !== this.renderedKey) {
            this.renderedKey = key;
            this.rendered = shown.rows.map(row => ({row, element: this.rowElement(row, selected)}));
            this.list.replaceChildren(...this.rendered.map(entry => entry.element));
            this.note.hidden = shown.hiddenCount === 0;
            this.note.textContent = `${shown.hiddenCount} more not shown (first ${ENTITY_TREE_ROW_LIMIT} rows); search to see more`;
        }
        this.showSelection(selected);
    }

    private showSelection(selected: ReadonlySet<Entity>): void {
        const selectionKey = this.workspace.selection.join(",");
        for (const {row, element} of this.rendered) {
            const entityRow = entityRowOf(row);
            if (entityRow === undefined) continue;
            const isSelected = selected.has(entityRow.summary.entity);
            element.classList.toggle(SELECTED_CLASS, isSelected);
            element.setAttribute("aria-selected", String(isSelected));
        }
        if (selectionKey === this.shownSelectionKey) return;
        this.shownSelectionKey = selectionKey;
        const primary = this.workspace.primary;
        this.rendered.find(entry => entityRowOf(entry.row)?.summary.entity === primary)?.element.scrollIntoView({block: "nearest"});
    }

    private rowElement(row: HierarchyRow, selected: ReadonlySet<Entity>): HTMLElement {
        if (row.kind === "scene") return this.sceneRowElement(row.group, row.expanded);
        return this.entityRowElement(row.row, selected.has(row.row.summary.entity));
    }

    private sceneRowElement(group: SceneGroup, expanded: boolean): HTMLElement {
        const document = this.list.ownerDocument;
        const element = createElement(document, "div", "tree-row scene-row");
        element.classList.toggle("active-scene", group.active);
        element.classList.toggle("unloaded", !group.loaded);
        element.setAttribute("role", "treeitem");
        element.setAttribute("aria-level", String(SCENE_ROW_DEPTH));
        if (group.roots.length > 0) element.setAttribute("aria-expanded", String(expanded));
        element.dataset.scene = group.key;
        element.style.paddingLeft = indentPx(0);
        const arrow = createElement(document, "span", group.roots.length === 0 ? "tree-arrow leaf" : expanded ? "tree-arrow expanded" : "tree-arrow");
        arrow.dataset.sceneToggle = group.key;
        const text = `${group.label}${group.dirty ? TAB_DIRTY_MARKER : ""}${group.loaded ? "" : UNLOADED_SUFFIX}`;
        const label = createElement(document, "span", "tree-label", text);
        const notes = [group.active ? ACTIVE_SCENE_TITLE : undefined, group.start ? START_SCENE_TITLE : undefined].filter((note): note is string => note !== undefined);
        label.title = `${group.path ?? group.label}${notes.length === 0 ? "" : ` (${notes.join("; ")})`}`;
        element.append(arrow, label);
        if (group.start) element.append(createElement(document, "span", "scene-badge", START_BADGE_TEXT));
        return element;
    }

    private entityRowElement(row: EntityTreeRow, selected: boolean): HTMLElement {
        const document = this.list.ownerDocument;
        const summary = row.summary;
        const element = createElement(document, "div", "tree-row entity-row");
        element.classList.toggle(SELECTED_CLASS, selected);
        element.classList.toggle("disabled", !summary.enabled);
        element.classList.toggle("prefab-instance", summary.prefabSourcePath !== null);
        element.setAttribute("role", "treeitem");
        element.setAttribute("aria-level", String(row.depth + SCENE_ROW_DEPTH + 1));
        element.setAttribute("aria-selected", String(selected));
        if (row.hasChildren) element.setAttribute("aria-expanded", String(row.expanded));
        element.draggable = true;
        element.dataset.entity = String(summary.entity);
        element.style.paddingLeft = indentPx(row.depth + SCENE_ROW_DEPTH);
        const arrow = createElement(document, "span", row.hasChildren ? (row.expanded ? "tree-arrow expanded" : "tree-arrow") : "tree-arrow leaf");
        arrow.dataset.toggle = String(summary.entity);
        const label = createElement(document, "span", "tree-label", entitySummaryLabel(summary));
        label.title = summary.prefabSourcePath === null ? label.textContent ?? "" : `${label.textContent} (prefab ${summary.prefabSourcePath})`;
        element.append(arrow, label);
        return element;
    }

    private rowOf(target: EventTarget | null): HTMLElement | undefined {
        if (!(target instanceof Element)) return undefined;
        return target.closest<HTMLElement>(ENTITY_ROW_SELECTOR) ?? undefined;
    }

    private sceneGroupAt(target: EventTarget | null): SceneGroup | undefined {
        if (!(target instanceof Element)) return undefined;
        const key = target.closest<HTMLElement>(SCENE_ROW_SELECTOR)?.dataset.scene;
        return key === undefined ? undefined : this.groups.find(group => group.key === key);
    }

    private entityAt(target: EventTarget | null): Entity | undefined {
        const row = this.rowOf(target);
        return row === undefined ? undefined : Number(row.dataset.entity) as Entity;
    }

    private onClick(event: MouseEvent): void {
        const target = event.target;
        const sceneToggle = target instanceof Element ? target.closest<HTMLElement>("[data-scene-toggle]") : null;
        if (sceneToggle !== null) {
            const key = sceneToggle.dataset.sceneToggle ?? "";
            if (this.collapsedScenes.has(key)) this.collapsedScenes.delete(key);
            else this.collapsedScenes.add(key);
            this.render();
            return;
        }
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
        const next = clickedSelection(this.visibleEntities(), {selected: this.workspace.selection, anchor: this.anchor}, entity, selectionModifiersOf(event));
        this.anchor = next.anchor;
        this.workspace.select(next.selected);
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
        const document = this.list.ownerDocument;
        const entry = this.sceneGroupAt(event.target)?.entry;
        if (entry !== undefined) {
            showCommandMenu(document, event.clientX, event.clientY, sceneMenu(this.commands, entry));
            return;
        }
        const entity = this.entityAt(event.target);
        if (entity !== undefined && !workspace.selection.includes(entity)) {
            this.anchor = entity;
            workspace.select([entity]);
        }
        const selection = entity === undefined ? [] : workspace.selection;
        showCommandMenu(document, event.clientX, event.clientY, hierarchyMenu(this.commands, entity, selection));
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

    private targetFor(event: DragEvent): FoundTarget | undefined {
        const group = this.sceneGroupAt(event.target);
        if (group !== undefined) {
            const indicator = event.target instanceof Element ? event.target.closest<HTMLElement>(SCENE_ROW_SELECTOR) : null;
            if (!group.loaded || group.sceneId === null || indicator === null) return undefined;
            return {target: UNPARENT_TARGET, sceneId: group.sceneId, indicator, className: SCENE_DROP_CLASS};
        }
        const rowElement = this.rowOf(event.target);
        if (rowElement === undefined) return {target: UNPARENT_TARGET, sceneId: undefined, indicator: this.list, className: EMPTY_DROP_CLASS};
        const entity = Number(rowElement.dataset.entity) as Entity;
        const rendered = this.rendered.find(entry => entityRowOf(entry.row)?.summary.entity === entity);
        const row = rendered === undefined ? undefined : entityRowOf(rendered.row);
        if (row === undefined) return undefined;
        const bounds = rowElement.getBoundingClientRect();
        const zone = dropZoneAt(event.clientY - bounds.top, bounds.height);
        const summary: EditorEntitySummary = row.summary;
        const target = dropTargetFor({entity, parent: summary.parent, expandedWithChildren: row.expanded}, zone, siblingListsOf(this.workspace.links()));
        return {target, sceneId: summary.sceneId, indicator: rowElement, className: DROP_CLASSES[zone]};
    }

    private staysInScene(entities: readonly Entity[], sceneId: number | undefined): boolean {
        if (sceneId === undefined) return true;
        return entities.every(entity => this.workspace.summaryOf(entity)?.sceneId === sceneId);
    }

    private acceptsDrag(found: FoundTarget): boolean {
        const drag = this.workspace.drag;
        if (drag === undefined) return false;
        if (drag.kind === "asset") {
            const landsInActiveScene = found.target.parent !== null || found.sceneId === undefined || found.sceneId === this.workspace.scenes.worldScenes.activeSceneId;
            return isAssetKind(drag.fileKind) && landsInActiveScene;
        }
        return this.staysInScene(drag.entities, found.sceneId) && isDropAllowed(found.target, new Set(drag.entities), parentLookupOf(this.workspace.links()));
    }

    private onDragOver(event: DragEvent): void {
        const found = this.targetFor(event);
        if (found === undefined || !this.acceptsDrag(found)) {
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
        const accepted = found !== undefined && this.acceptsDrag(found);
        this.endDrag();
        if (found === undefined || drag === undefined || !accepted) return;
        event.preventDefault();
        if (drag.kind === "asset") void this.workspace.instantiateAsset(drag.path, {target: found.target});
        else void this.workspace.reparent(drag.entities, found.target);
    }

    private clearDropIndicator(): void {
        if (this.dropIndicator === undefined) return;
        this.dropIndicator.element.classList.remove(this.dropIndicator.className);
        this.dropIndicator = undefined;
    }
}
