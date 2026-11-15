import {describe, expect, test} from "../../engine/testing/harness";
import type {Entity} from "../../engine/core";
import {
    dropTargetFor,
    dropZoneAt,
    isDropAllowed,
    parentLookupOf,
    planMoves,
    planRestore,
    siblingListsOf,
    subtreeInListOrder,
    topmostEntities,
    UNPARENT_TARGET,
} from "./hierarchyDrop";
import type {HierarchyLink, PlannedMove, SiblingLists} from "./hierarchyDrop";

const A = 1 as Entity, B = 2 as Entity, C = 3 as Entity, D1 = 4 as Entity, D2 = 5 as Entity, P = 6 as Entity, Q = 7 as Entity, CHILD = 8 as Entity;

function link(entity: Entity, parent: Entity | null, siblingIndex: number): HierarchyLink {
    return {entity, parent, siblingIndex};
}

function applyMoves(lists: SiblingLists, moves: readonly PlannedMove[]): SiblingLists {
    const result: SiblingLists = new Map([...lists].map(([key, list]) => [key, [...list]]));
    for (const move of moves) {
        for (const list of result.values()) {
            const index = list.indexOf(move.entity);
            if (index >= 0) list.splice(index, 1);
        }
        let destination = result.get(move.parent);
        if (destination === undefined) result.set(move.parent, destination = []);
        destination.splice(Math.min(move.siblingIndex, destination.length), 0, move.entity);
    }
    return result;
}

describe("hierarchy drop zones and targets", () => {
    const links = [link(P, null, 0), link(CHILD, P, 0), link(A, null, 1), link(B, null, 2)];
    const lists = siblingListsOf(links);
    const parentOf = parentLookupOf(links);

    test("the top and bottom quarters of a row insert between rows, the middle drops onto it", () => {
        expect(dropZoneAt(1, 20)).toBe("before");
        expect(dropZoneAt(10, 20)).toBe("onto");
        expect(dropZoneAt(19, 20)).toBe("after");
    });

    test("sibling lists follow siblingIndex, not list order", () => {
        expect(siblingListsOf([link(A, null, 1), link(B, null, 0)]).get(null)).toEqual([B, A]);
    });

    test("onto a row reparents to it; before or after a row places among its siblings", () => {
        expect(dropTargetFor({entity: A, parent: null, expandedWithChildren: false}, "onto", lists)).toEqual({parent: A, before: null});
        expect(dropTargetFor({entity: A, parent: null, expandedWithChildren: false}, "before", lists)).toEqual({parent: null, before: A});
        expect(dropTargetFor({entity: A, parent: null, expandedWithChildren: false}, "after", lists)).toEqual({parent: null, before: B});
        expect(dropTargetFor({entity: B, parent: null, expandedWithChildren: false}, "after", lists)).toEqual({parent: null, before: null});
    });

    test("below an expanded parent the drop becomes its first child", () => {
        expect(dropTargetFor({entity: P, parent: null, expandedWithChildren: true}, "after", lists)).toEqual({parent: P, before: CHILD});
    });

    test("a drop onto the dragged entity or one of its descendants is rejected; empty space unparents", () => {
        expect(isDropAllowed({parent: P, before: null}, new Set([P]), parentOf)).toBe(false);
        expect(isDropAllowed({parent: CHILD, before: null}, new Set([P]), parentOf)).toBe(false);
        expect(isDropAllowed({parent: A, before: null}, new Set([P]), parentOf)).toBe(true);
        expect(isDropAllowed(UNPARENT_TARGET, new Set([CHILD]), parentOf)).toBe(true);
        expect(isDropAllowed(UNPARENT_TARGET, new Set(), parentOf)).toBe(false);
    });

    test("only the topmost of the dragged entities move, and a subtree lists in list order", () => {
        expect(topmostEntities([CHILD, P, A], parentOf)).toEqual([P, A]);
        expect(subtreeInListOrder(links, P)).toEqual([P, CHILD]);
    });
});

describe("planning sibling moves", () => {
    test("moving an entity down among its siblings uses its index in the list without it", () => {
        const lists = siblingListsOf([link(A, null, 0), link(B, null, 1), link(C, null, 2)]);
        const plan = planMoves(lists, [A], {parent: null, before: C});
        expect(plan.moves).toEqual([{entity: A, parent: null, siblingIndex: 1}]);
        expect(plan.after.get(null)).toEqual([B, A, C]);
        expect(applyMoves(lists, plan.moves).get(null)).toEqual([B, A, C]);
    });

    test("several dragged entities land together in tree order before the anchor", () => {
        const lists = siblingListsOf([link(D1, null, 0), link(D2, null, 1), link(A, null, 2), link(B, null, 3)]);
        const plan = planMoves(lists, [D1, D2], {parent: null, before: B});
        expect(plan.after.get(null)).toEqual([A, D1, D2, B]);
        expect(applyMoves(lists, plan.moves).get(null)).toEqual([A, D1, D2, B]);
    });

    test("moving into another parent records both lists and appends at the end", () => {
        const lists = siblingListsOf([link(P, null, 0), link(CHILD, P, 0), link(A, null, 1)]);
        const plan = planMoves(lists, [A], {parent: P, before: null});
        expect(plan.moves).toEqual([{entity: A, parent: P, siblingIndex: 1}]);
        expect(plan.before.get(null)).toEqual([P, A]);
        expect(plan.after.get(null)).toEqual([P]);
        expect(plan.after.get(P)).toEqual([CHILD, A]);
    });

    test("a drop that changes nothing plans no requests", () => {
        const lists = siblingListsOf([link(A, null, 0), link(B, null, 1)]);
        expect(planMoves(lists, [A], {parent: null, before: A}).moves).toEqual([]);
        expect(planMoves(lists, [A], {parent: null, before: B}).moves).toEqual([]);
    });

    test("restoring sibling lists undoes a move, including entities that changed parent", () => {
        const lists = siblingListsOf([link(P, null, 0), link(CHILD, P, 0), link(A, null, 1), link(Q, null, 2), link(B, Q, 0), link(C, Q, 1)]);
        const plan = planMoves(lists, [C, A], {parent: P, before: CHILD});
        const moved = applyMoves(lists, plan.moves);
        expect(moved.get(P)).toEqual([C, A, CHILD]);
        const restored = applyMoves(moved, planRestore(plan.after, plan.before));
        expect(restored.get(null)).toEqual([P, A, Q]);
        expect(restored.get(P)).toEqual([CHILD]);
        expect(restored.get(Q)).toEqual([B, C]);
        expect(planRestore(plan.before, plan.before)).toEqual([]);
    });
});
