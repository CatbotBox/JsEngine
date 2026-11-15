import type {Entity} from "../../engine/core";

export type SiblingKey = Entity | null;

export type SiblingLists = Map<SiblingKey, Entity[]>;

export type ReadonlySiblingLists = ReadonlyMap<SiblingKey, readonly Entity[]>;

export type ParentLookup = (entity: Entity) => Entity | null | undefined;

export interface HierarchyLink {
    readonly entity: Entity;
    readonly parent: Entity | null;
    readonly siblingIndex: number;
}

export type DropZone = "before" | "onto" | "after";

export interface DropTarget {
    readonly parent: Entity | null;
    readonly before: Entity | null;
}

export interface DropRow {
    readonly entity: Entity;
    readonly parent: Entity | null;
    readonly expandedWithChildren: boolean;
}

export interface PlannedMove {
    readonly entity: Entity;
    readonly parent: Entity | null;
    readonly siblingIndex: number;
}

export interface MovePlan {
    readonly moves: readonly PlannedMove[];
    readonly before: SiblingLists;
    readonly after: SiblingLists;
}

export const DROP_EDGE_FRACTION = 0.25;
export const UNPARENT_TARGET: DropTarget = {parent: null, before: null};

const NOT_FOUND = -1;

export function siblingListsOf(links: readonly HierarchyLink[]): SiblingLists {
    const grouped = new Map<SiblingKey, {readonly link: HierarchyLink, readonly order: number}[]>();
    links.forEach((link, order) => {
        const key = link.parent === link.entity ? null : link.parent;
        let group = grouped.get(key);
        if (group === undefined) grouped.set(key, group = []);
        group.push({link, order});
    });
    const lists: SiblingLists = new Map();
    for (const [key, group] of grouped) {
        group.sort((a, b) => (a.link.siblingIndex - b.link.siblingIndex) || (a.order - b.order));
        lists.set(key, group.map(item => item.link.entity));
    }
    return lists;
}

export function parentLookupOf(links: readonly HierarchyLink[]): ParentLookup {
    const parents = new Map<Entity, Entity | null>();
    for (const link of links) parents.set(link.entity, link.parent === link.entity ? null : link.parent);
    return entity => parents.get(entity);
}

export function isWithinSubtrees(entity: Entity, roots: ReadonlySet<Entity>, parentOf: ParentLookup): boolean {
    const visited = new Set<Entity>();
    for (let current: Entity | null | undefined = entity; current !== null && current !== undefined && !visited.has(current); current = parentOf(current)) {
        if (roots.has(current)) return true;
        visited.add(current);
    }
    return false;
}

export function subtreeInListOrder(links: readonly HierarchyLink[], root: Entity): Entity[] {
    const parentOf = parentLookupOf(links);
    const roots = new Set([root]);
    return links.map(link => link.entity).filter(entity => isWithinSubtrees(entity, roots, parentOf));
}

export function siblingIndexIn(lists: ReadonlySiblingLists, parent: Entity | null, entity: Entity): number {
    return Math.max(0, (lists.get(parent) ?? []).indexOf(entity));
}

export function topmostEntities(entities: readonly Entity[], parentOf: ParentLookup): Entity[] {
    const listed = new Set(entities);
    const topmost: Entity[] = [];
    for (const entity of entities) {
        if (topmost.includes(entity)) continue;
        const parent = parentOf(entity);
        if (parent === null || parent === undefined || !isWithinSubtrees(parent, listed, parentOf)) topmost.push(entity);
    }
    return topmost;
}

export function dropZoneAt(offsetPx: number, heightPx: number): DropZone {
    if (!(heightPx > 0)) return "onto";
    const fraction = offsetPx / heightPx;
    if (fraction < DROP_EDGE_FRACTION) return "before";
    if (fraction > 1 - DROP_EDGE_FRACTION) return "after";
    return "onto";
}

function nextSibling(lists: ReadonlySiblingLists, parent: Entity | null, entity: Entity): Entity | null {
    const siblings = lists.get(parent) ?? [];
    const index = siblings.indexOf(entity);
    return index === NOT_FOUND || index + 1 >= siblings.length ? null : siblings[index + 1];
}

export function dropTargetFor(row: DropRow, zone: DropZone, lists: ReadonlySiblingLists): DropTarget {
    switch (zone) {
        case "onto":
            return {parent: row.entity, before: null};
        case "before":
            return {parent: row.parent, before: row.entity};
        case "after":
            if (row.expandedWithChildren) return {parent: row.entity, before: (lists.get(row.entity) ?? [])[0] ?? null};
            return {parent: row.parent, before: nextSibling(lists, row.parent, row.entity)};
    }
}

export function isDropAllowed(target: DropTarget, dragged: ReadonlySet<Entity>, parentOf: ParentLookup): boolean {
    if (dragged.size === 0) return false;
    return target.parent === null || !isWithinSubtrees(target.parent, dragged, parentOf);
}

export function cloneSiblingLists(lists: ReadonlySiblingLists): SiblingLists {
    const copy: SiblingLists = new Map();
    for (const [key, list] of lists) copy.set(key, [...list]);
    return copy;
}

function pickLists(lists: ReadonlySiblingLists, keys: ReadonlySet<SiblingKey>): SiblingLists {
    const picked: SiblingLists = new Map();
    for (const key of keys) picked.set(key, [...(lists.get(key) ?? [])]);
    return picked;
}

function keyHolding(lists: SiblingLists, entity: Entity): SiblingKey | undefined {
    for (const [key, list] of lists) if (list.includes(entity)) return key;
    return undefined;
}

function listFor(lists: SiblingLists, key: SiblingKey): Entity[] {
    let list = lists.get(key);
    if (list === undefined) lists.set(key, list = []);
    return list;
}

function firstNotDragged(lists: ReadonlySiblingLists, target: DropTarget, dragged: ReadonlySet<Entity>): Entity | null {
    let anchor = target.before;
    const siblings = lists.get(target.parent) ?? [];
    while (anchor !== null && dragged.has(anchor)) {
        const index = siblings.indexOf(anchor);
        anchor = index === NOT_FOUND || index + 1 >= siblings.length ? null : siblings[index + 1];
    }
    return anchor;
}

export function planMoves(lists: ReadonlySiblingLists, dragged: readonly Entity[], target: DropTarget): MovePlan {
    const simulated = cloneSiblingLists(lists);
    const draggedSet = new Set(dragged);
    const affected = new Set<SiblingKey>([target.parent]);
    for (const entity of dragged) {
        const key = keyHolding(simulated, entity);
        if (key !== undefined) affected.add(key);
    }
    const before = pickLists(simulated, affected);
    const moves: PlannedMove[] = [];
    let anchor = firstNotDragged(lists, target, draggedSet);
    for (let k = dragged.length - 1; k >= 0; k--) {
        const entity = dragged[k];
        const fromKey = keyHolding(simulated, entity);
        const fromIndex = fromKey === undefined ? NOT_FOUND : simulated.get(fromKey)!.indexOf(entity);
        if (fromKey !== undefined) simulated.get(fromKey)!.splice(fromIndex, 1);
        const destination = listFor(simulated, target.parent);
        const anchorIndex = anchor === null ? NOT_FOUND : destination.indexOf(anchor);
        const index = anchorIndex === NOT_FOUND ? destination.length : anchorIndex;
        destination.splice(index, 0, entity);
        if (fromKey !== target.parent || fromIndex !== index) moves.push({entity, parent: target.parent, siblingIndex: index});
        anchor = entity;
    }
    return {moves, before, after: pickLists(simulated, affected)};
}

export function planRestore(current: ReadonlySiblingLists, target: ReadonlySiblingLists): PlannedMove[] {
    const simulated = cloneSiblingLists(current);
    const moves: PlannedMove[] = [];
    for (const [key, wanted] of target) {
        wanted.forEach((entity, index) => {
            const list = listFor(simulated, key);
            if (list[index] === entity) return;
            const holder = keyHolding(simulated, entity);
            if (holder !== undefined) {
                const held = simulated.get(holder)!;
                held.splice(held.indexOf(entity), 1);
            }
            const at = Math.min(index, list.length);
            list.splice(at, 0, entity);
            moves.push({entity, parent: key, siblingIndex: at});
        });
    }
    return moves;
}
