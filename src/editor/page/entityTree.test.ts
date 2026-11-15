import {describe, expect, test} from "../../engine/testing/harness";
import type {Entity} from "../../engine/core";
import type {EditorEntitySummary} from "../editorProtocol";
import {buildEntityTree, entityTreeRows, preorderEntities} from "./entityTree";
import type {EntityTreeNode, EntityTreeRows} from "./entityTree";
import {EMPTY_SEARCH, parseHierarchySearch} from "./hierarchySearch";

const UNLIMITED_ROWS = Number.POSITIVE_INFINITY;
const MISSING_PARENT = 999 as Entity;

function summary(entity: number, name: string | null, parent: number | null, siblingIndex = 0, componentTypeNames: readonly string[] = []): EditorEntitySummary {
    return {entity: entity as Entity, name, enabled: true, parent: parent as Entity | null, siblingIndex, prefabSourcePath: null, componentTypeNames};
}

interface NamedTree {
    readonly name: string | null;
    readonly children: readonly NamedTree[];
}

function named(nodes: readonly EntityTreeNode[]): NamedTree[] {
    return nodes.map(node => ({name: node.summary.name, children: named(node.children)}));
}

function shownRows(rows: EntityTreeRows): string[] {
    return rows.rows.map(row => `${row.depth}:${row.summary.name ?? row.summary.entity}`);
}

describe("buildEntityTree", () => {
    test("nests a flat list by parent, keeping creation order among siblings with equal indices", () => {
        const roots = buildEntityTree([
            summary(1, "world", null),
            summary(2, "camera", 1),
            summary(3, "lens", 2),
            summary(4, "light", 1),
            summary(5, "hud", null),
        ]);
        expect(named(roots)).toEqual([
            {name: "world", children: [{name: "camera", children: [{name: "lens", children: []}]}, {name: "light", children: []}]},
            {name: "hud", children: []},
        ]);
    });

    test("siblings and roots follow their sibling index", () => {
        const roots = buildEntityTree([summary(1, "late root", null, 1), summary(2, "first root", null, 0), summary(3, "b", 2, 1), summary(4, "a", 2, 0)]);
        expect(named(roots)).toEqual([
            {name: "first root", children: [{name: "a", children: []}, {name: "b", children: []}]},
            {name: "late root", children: []},
        ]);
        expect(preorderEntities(roots)).toEqual([2, 4, 3, 1]);
    });

    test("a child listed before its parent still nests under it", () => {
        expect(named(buildEntityTree([summary(2, "child", 1), summary(1, "parent", null)]))).toEqual([
            {name: "parent", children: [{name: "child", children: []}]},
        ]);
    });

    test("orphans whose parent is not listed, and self-parented entities, become roots", () => {
        const roots = buildEntityTree([summary(1, "orphan", MISSING_PARENT), summary(2, "self", 2), summary(3, "root", null)]);
        expect(named(roots).map(node => node.name)).toEqual(["orphan", "self", "root"]);
    });

    test("a parent cycle is cut so every entity is shown exactly once", () => {
        const roots = buildEntityTree([summary(1, "a", 2), summary(2, "b", 1), summary(3, "c", 1)]);
        expect(named(roots)).toEqual([{name: "a", children: [{name: "b", children: []}, {name: "c", children: []}]}]);
        expect(shownRows(entityTreeRows(roots, EMPTY_SEARCH, UNLIMITED_ROWS))).toEqual(["0:a", "1:b", "1:c"]);
    });
});

describe("entityTreeRows", () => {
    const roots = buildEntityTree([
        summary(1, "world", null),
        summary(2, "camera", 1, 0, ["Camera"]),
        summary(3, "Lens", 2),
        summary(4, "light", 1, 1, ["PointLight"]),
        summary(5, null, null, 1),
    ]);

    test("lists the tree depth first with each row's depth and whether it has children", () => {
        const rows = entityTreeRows(roots, EMPTY_SEARCH, UNLIMITED_ROWS);
        expect(shownRows(rows)).toEqual(["0:world", "1:camera", "2:Lens", "1:light", "0:5"]);
        expect(rows.rows.map(row => row.hasChildren)).toEqual([true, true, false, false, false]);
        expect(rows.hiddenCount).toBe(0);
    });

    test("a search matches names case-insensitively and keeps the ancestors of a match", () => {
        expect(shownRows(entityTreeRows(roots, parseHierarchySearch(" LENS "), UNLIMITED_ROWS))).toEqual(["0:world", "1:camera", "2:Lens"]);
        expect(shownRows(entityTreeRows(roots, parseHierarchySearch("light"), UNLIMITED_ROWS))).toEqual(["0:world", "1:light"]);
    });

    test("a t: search matches component types and combines with a name", () => {
        expect(shownRows(entityTreeRows(roots, parseHierarchySearch("t:Camera"), UNLIMITED_ROWS))).toEqual(["0:world", "1:camera"]);
        expect(shownRows(entityTreeRows(roots, parseHierarchySearch("t:Camera light"), UNLIMITED_ROWS))).toEqual([]);
    });

    test("an unnamed entity matches its shown label", () => {
        expect(shownRows(entityTreeRows(roots, parseHierarchySearch("entity 5"), UNLIMITED_ROWS))).toEqual(["0:5"]);
    });

    test("a collapsed entity hides its descendants unless a search is active", () => {
        const collapsed = new Set([1 as Entity]);
        const rows = entityTreeRows(roots, EMPTY_SEARCH, UNLIMITED_ROWS, collapsed);
        expect(shownRows(rows)).toEqual(["0:world", "0:5"]);
        expect(rows.rows[0].expanded).toBe(false);
        expect(shownRows(entityTreeRows(roots, parseHierarchySearch("lens"), UNLIMITED_ROWS, collapsed))).toEqual(["0:world", "1:camera", "2:Lens"]);
    });

    test("rows past the limit are counted, not shown", () => {
        const many = buildEntityTree(Array.from({length: 10}, (_, index) => summary(index + 1, `e${index + 1}`, null, index)));
        const rows = entityTreeRows(many, EMPTY_SEARCH, 4);
        expect(shownRows(rows)).toEqual(["0:e1", "0:e2", "0:e3", "0:e4"]);
        expect(rows.hiddenCount).toBe(6);
        const filtered = entityTreeRows(many, parseHierarchySearch("e1"), 4);
        expect(shownRows(filtered)).toEqual(["0:e1", "0:e10"]);
        expect(filtered.hiddenCount).toBe(0);
    });

    test("a deep chain is listed without recursion", () => {
        const depth = 20_000;
        const chain = buildEntityTree(Array.from({length: depth}, (_, index) => summary(index + 1, null, index === 0 ? null : index)));
        const rows = entityTreeRows(chain, EMPTY_SEARCH, UNLIMITED_ROWS);
        expect(rows.rows.length).toBe(depth);
        expect(rows.rows[depth - 1].depth).toBe(depth - 1);
    });
});
