import {describe, expect, test} from "../../engine/testing/harness";
import {
    activatePanel,
    closedDockPanels,
    closePanel,
    DOCK_LAYOUT_VERSION,
    dockLayoutOf,
    dockLayoutText,
    dockSplit,
    dockStack,
    dockStacks,
    findDockSplit,
    isDockPanelOpen,
    movePanel,
    normalizeDockLayout,
    openDockPanels,
    openPanel,
    parseDockLayout,
    resizeSplit,
    ROOT_EDGE_SHARE,
    stackOfPanel,
} from "./dockLayout";
import type {DockLayout, DockNode, DockSplit} from "./dockLayout";

const SAMPLE_SHAPE = "row(column(row([*hierarchy] [*scene] [*game]) [*project,console,history]) [*inspector])";

function sample(): DockLayout {
    return dockLayoutOf(dockSplit("split-1", "row", [
        dockSplit("split-2", "column", [
            dockSplit("split-3", "row", [dockStack("stack-4", ["hierarchy"]), dockStack("stack-5", ["scene"]), dockStack("stack-6", ["game"])], [0.2, 0.4, 0.4]),
            dockStack("stack-7", ["project", "console", "history"]),
        ], [0.75, 0.25]),
        dockStack("stack-8", ["inspector"]),
    ], [0.8, 0.2]));
}

function shape(node: DockNode | undefined): string {
    if (node === undefined) return "-";
    if (node.kind === "stack") return `[${node.panels.map(panel => panel === node.active ? `*${panel}` : panel).join(",")}]`;
    return `${node.axis}(${node.children.map(shape).join(" ")})`;
}

function rounded(sizes: readonly number[]): number[] {
    return sizes.map(size => Math.round(size * 1000) / 1000);
}

function splitSizes(layout: DockLayout, id: string): number[] {
    const split = findDockSplit(layout, id);
    if (split === undefined) throw new Error(`no split ${id}`);
    return rounded(split.sizes);
}

function rootSplit(layout: DockLayout): DockSplit {
    if (layout.root?.kind !== "split") throw new Error("the root is not a split");
    return layout.root;
}

function ids(layout: DockLayout): string[] {
    const all: string[] = [];
    const visit = (node: DockNode): void => {
        all.push(node.id);
        if (node.kind === "split") node.children.forEach(visit);
    };
    if (layout.root !== undefined) visit(layout.root);
    return all;
}

describe("dock layout queries", () => {
    test("panels are found by stack, listed in tree order, and the rest count as closed", () => {
        const layout = sample();
        expect(shape(layout.root)).toBe(SAMPLE_SHAPE);
        expect(stackOfPanel(layout, "console")?.id).toBe("stack-7");
        expect(stackOfPanel(layout, "settings")).toBeUndefined();
        expect(openDockPanels(layout)).toEqual(["hierarchy", "scene", "game", "project", "console", "history", "inspector"]);
        expect(closedDockPanels(layout)).toEqual(["settings", "assets"]);
        expect([isDockPanelOpen(layout, "game"), isDockPanelOpen(layout, "assets")]).toEqual([true, false]);
        expect(dockStacks(layout.root).map(stack => stack.id)).toEqual(["stack-4", "stack-5", "stack-6", "stack-7", "stack-8"]);
    });
});

describe("activating and closing panels", () => {
    test("activating switches the stack's tab; activating the active or a closed panel changes nothing", () => {
        const layout = sample();
        expect(stackOfPanel(activatePanel(layout, "history"), "history")?.active).toBe("history");
        expect(activatePanel(layout, "project")).toBe(layout);
        expect(activatePanel(layout, "assets")).toBe(layout);
    });

    test("closing a background tab keeps the active one and remembers where the panel was", () => {
        const closed = closePanel(sample(), "history");
        expect(shape(closed.root)).toBe("row(column(row([*hierarchy] [*scene] [*game]) [*project,console]) [*inspector])");
        expect(closed.closed).toEqual([{panel: "history", stack: "stack-7", index: 2}]);
        expect(closedDockPanels(closed)).toEqual(["history", "settings", "assets"]);
    });

    test("closing the active tab activates the tab after it, or the one before when it was last", () => {
        expect(stackOfPanel(closePanel(sample(), "project"), "console")?.active).toBe("console");
        const lastActive = activatePanel(sample(), "history");
        expect(stackOfPanel(closePanel(lastActive, "history"), "console")?.active).toBe("console");
    });

    test("closing a stack's only panel removes the stack and collapses its split", () => {
        const closed = closePanel(sample(), "inspector");
        expect(shape(closed.root)).toBe("column(row([*hierarchy] [*scene] [*game]) [*project,console,history])");
        expect(closed.closed).toEqual([{panel: "inspector", stack: "stack-8", index: 0}]);
        const noHierarchy = closePanel(sample(), "hierarchy");
        expect(splitSizes(noHierarchy, "split-3")).toEqual([0.5, 0.5]);
    });

    test("closing a closed panel changes nothing; closing everything leaves no root", () => {
        const layout = sample();
        expect(closePanel(layout, "assets")).toBe(layout);
        const empty = openDockPanels(layout).reduce((current, panel) => closePanel(current, panel), layout);
        expect(empty.root).toBeUndefined();
        expect(closedDockPanels(empty).length).toBe(9);
    });

    test("reclosing a panel replaces its remembered place", () => {
        const layout = closePanel(movePanel(closePanel(sample(), "console"), "console", {stack: "stack-8", index: 0}), "console");
        expect(layout.closed).toEqual([{panel: "console", stack: "stack-8", index: 0}]);
    });
});

describe("moving panels into a tab strip", () => {
    test("a panel joins another stack at the drop index and becomes its active tab", () => {
        const moved = movePanel(sample(), "console", {stack: "stack-4", index: 1});
        expect(shape(moved.root)).toBe("row(column(row([hierarchy,*console] [*scene] [*game]) [*project,history]) [*inspector])");
        expect(shape(movePanel(sample(), "console", {stack: "stack-4", index: 0}).root)).toBe("row(column(row([*console,hierarchy] [*scene] [*game]) [*project,history]) [*inspector])");
    });

    test("an index past the end appends; a negative index prepends", () => {
        expect(stackOfPanel(movePanel(sample(), "game", {stack: "stack-7", index: 99}), "game")?.panels).toEqual(["project", "console", "history", "game"]);
        expect(stackOfPanel(movePanel(sample(), "game", {stack: "stack-7", index: -3}), "game")?.panels).toEqual(["game", "project", "console", "history"]);
    });

    test("reordering within a stack counts the index before the dragged tab is lifted out", () => {
        expect(stackOfPanel(movePanel(sample(), "project", {stack: "stack-7", index: 3}), "project")?.panels).toEqual(["console", "history", "project"]);
        expect(stackOfPanel(movePanel(sample(), "history", {stack: "stack-7", index: 0}), "history")?.panels).toEqual(["history", "project", "console"]);
        const inPlace = movePanel(sample(), "console", {stack: "stack-7", index: 2});
        expect(stackOfPanel(inPlace, "console")?.panels).toEqual(["project", "console", "history"]);
        expect(stackOfPanel(inPlace, "console")?.active).toBe("console");
    });

    test("moving a stack's only panel away removes that stack", () => {
        const moved = movePanel(sample(), "hierarchy", {stack: "stack-5", index: 1});
        expect(shape(moved.root)).toBe("row(column(row([scene,*hierarchy] [*game]) [*project,console,history]) [*inspector])");
        expect(splitSizes(moved, "split-3")).toEqual([0.5, 0.5]);
    });

    test("an unknown target stack changes nothing", () => {
        const layout = sample();
        expect(movePanel(layout, "console", {stack: "stack-99", index: 0})).toBe(layout);
        expect(movePanel(layout, "console", {stack: "stack-99", edge: "left"})).toBe(layout);
    });
});

describe("moving panels to a stack's edge", () => {
    test("an edge along the parent split's axis inserts a sibling that takes half the target's share", () => {
        const moved = movePanel(sample(), "console", {stack: "stack-5", edge: "right"});
        expect(shape(moved.root)).toBe("row(column(row([*hierarchy] [*scene] [*console] [*game]) [*project,history]) [*inspector])");
        expect(splitSizes(moved, "split-3")).toEqual([0.2, 0.2, 0.2, 0.4]);
        const before = movePanel(sample(), "console", {stack: "stack-5", edge: "left", share: 0.25});
        expect(shape(before.root)).toBe("row(column(row([*hierarchy] [*console] [*scene] [*game]) [*project,history]) [*inspector])");
        expect(splitSizes(before, "split-3")).toEqual([0.2, 0.1, 0.3, 0.4]);
    });

    test("an edge across the parent split's axis wraps the target in a new split", () => {
        const moved = movePanel(sample(), "console", {stack: "stack-5", edge: "bottom"});
        expect(shape(moved.root)).toBe("row(column(row([*hierarchy] column([*scene] [*console]) [*game]) [*project,history]) [*inspector])");
        const wrapper = (findDockSplit(moved, "split-3")?.children[1]) as DockSplit;
        expect([wrapper.axis, rounded(wrapper.sizes)]).toEqual(["column", [0.5, 0.5]]);
        const above = movePanel(sample(), "game", {stack: "stack-8", edge: "top"});
        expect(shape(above.root)).toBe("row(column(row([*hierarchy] [*scene]) [*project,console,history]) column([*game] [*inspector]))");
    });

    test("new stacks and splits get ids no other node or remembered place uses", () => {
        const remembering = closePanel(sample(), "hierarchy");
        const moved = movePanel(remembering, "console", {stack: "stack-5", edge: "bottom"});
        const all = ids(moved);
        expect(new Set(all).size).toBe(all.length);
        expect(all.includes("stack-4")).toBe(false);
        expect(stackOfPanel(moved, "console")?.id).toBe("stack-9");
    });

    test("a tab dropped on its own stack's edge splits off when the stack has other tabs", () => {
        const moved = movePanel(sample(), "console", {stack: "stack-7", edge: "right"});
        expect(shape(moved.root)).toBe("row(column(row([*hierarchy] [*scene] [*game]) row([*project,history] [*console])) [*inspector])");
    });

    test("a stack's only panel dropped on its own stack changes nothing", () => {
        const layout = sample();
        expect(movePanel(layout, "inspector", {stack: "stack-8", edge: "left"})).toBe(layout);
        expect(movePanel(layout, "inspector", {stack: "stack-8", index: 0})).toBe(layout);
    });

    test("an edge drop keeps nested splits of one axis merged", () => {
        const moved = movePanel(sample(), "history", {stack: "stack-8", edge: "left"});
        expect(shape(moved.root)).toBe("row(column(row([*hierarchy] [*scene] [*game]) [*project,console]) [*history] [*inspector])");
        expect(splitSizes(moved, "split-1")).toEqual([0.8, 0.1, 0.1]);
    });
});

describe("moving panels to the dock root's edge", () => {
    test("a root edge along the root split's axis adds an outer child with the root edge share", () => {
        const moved = movePanel(sample(), "console", {rootEdge: "left"});
        expect(shape(moved.root)).toBe("row([*console] column(row([*hierarchy] [*scene] [*game]) [*project,history]) [*inspector])");
        expect(splitSizes(moved, "split-1")).toEqual([ROOT_EDGE_SHARE, 0.6, 0.15]);
    });

    test("a root edge across the root's axis wraps the whole root", () => {
        const moved = movePanel(sample(), "console", {rootEdge: "bottom", share: 0.3});
        expect(shape(moved.root)).toBe("column(row(column(row([*hierarchy] [*scene] [*game]) [*project,history]) [*inspector]) [*console])");
        expect(rounded(rootSplit(moved).sizes)).toEqual([0.7, 0.3]);
    });

    test("the only panel of a lone root stack stays put, and an empty dock gets a root stack", () => {
        const lone = dockLayoutOf(dockStack("stack-1", ["game"]));
        expect(movePanel(lone, "game", {rootEdge: "right"})).toBe(lone);
        const empty = dockLayoutOf(undefined);
        expect(shape(movePanel(empty, "game", {rootEdge: "right"}).root)).toBe("[*game]");
    });

    test("shares outside the allowed range are clamped", () => {
        expect(splitSizes(movePanel(sample(), "console", {rootEdge: "left", share: 7}), "split-1")[0]).toBe(0.95);
        expect(splitSizes(movePanel(sample(), "console", {rootEdge: "left", share: Number.NaN}), "split-1")[0]).toBe(0.5);
    });
});

describe("opening panels", () => {
    test("an open panel is only activated", () => {
        expect(stackOfPanel(openPanel(sample(), "history"), "history")?.active).toBe("history");
    });

    test("a closed panel goes back to its remembered stack and index when that stack still exists", () => {
        const reopened = openPanel(closePanel(sample(), "console"), "console");
        expect(stackOfPanel(reopened, "console")?.panels).toEqual(["project", "console", "history"]);
        expect(stackOfPanel(reopened, "console")?.active).toBe("console");
        expect(reopened.closed).toEqual([]);
        const shrunk = closePanel(closePanel(sample(), "history"), "console");
        expect(stackOfPanel(openPanel(shrunk, "history"), "history")?.panels).toEqual(["project", "history"]);
    });

    test("without its old stack a panel takes the first home whose anchor is open", () => {
        const closed = closePanel(closePanel(sample(), "inspector"), "scene");
        const reopened = openPanel(closed, "inspector", [{nextTo: "scene", edge: "left"}, {rootEdge: "right", share: 0.2}]);
        expect(shape(reopened.root)).toBe("row(column(row([*hierarchy] [*game]) [*project,console,history]) [*inspector])");
        expect(rounded(rootSplit(reopened).sizes)).toEqual([0.8, 0.2]);
        const tabbed = openPanel(sample(), "settings", [{withPanel: "assets"}, {withPanel: "console"}]);
        expect(stackOfPanel(tabbed, "settings")?.panels).toEqual(["project", "console", "history", "settings"]);
        const beside = openPanel(sample(), "assets", [{nextTo: "game", edge: "bottom", share: 0.3}]);
        expect(shape(beside.root)).toBe("row(column(row([*hierarchy] [*scene] column([*game] [*assets])) [*project,console,history]) [*inspector])");
    });

    test("with no usable home a panel joins the first stack, and an empty dock gets a root stack", () => {
        expect(stackOfPanel(openPanel(sample(), "assets", [{withPanel: "settings"}]), "assets")?.id).toBe("stack-4");
        expect(shape(openPanel(dockLayoutOf(undefined), "assets").root)).toBe("[*assets]");
    });
});

describe("resizing splits", () => {
    test("sizes are stored as proportions", () => {
        expect(splitSizes(resizeSplit(sample(), "split-1", [3, 1]), "split-1")).toEqual([0.75, 0.25]);
    });

    test("a wrong count, a non-positive size or an unknown split changes nothing", () => {
        const layout = sample();
        expect(resizeSplit(layout, "split-1", [1, 1, 1])).toBe(layout);
        expect(resizeSplit(layout, "split-1", [1, 0])).toBe(layout);
        expect(resizeSplit(layout, "split-1", [1, Number.POSITIVE_INFINITY])).toBe(layout);
        expect(resizeSplit(layout, "split-9", [1, 1])).toBe(layout);
        expect(resizeSplit(layout, "stack-8", [1])).toBe(layout);
    });
});

describe("normalizing", () => {
    test("empty stacks go, single-child splits collapse and same-axis nested splits merge their shares", () => {
        const messy = normalizeDockLayout({
            version: DOCK_LAYOUT_VERSION,
            root: dockSplit("split-1", "row", [
                dockSplit("split-2", "row", [dockStack("stack-3", ["hierarchy"]), dockStack("stack-4", ["scene"])], [1, 3]),
                dockSplit("split-5", "column", [dockStack("stack-6", []), dockStack("stack-7", ["game"])], [1, 1]),
                dockStack("stack-8", []),
            ], [0.5, 0.5, 0.2]),
            closed: [],
        });
        expect(shape(messy.root)).toBe("row([*hierarchy] [*scene] [*game])");
        expect(rounded(rootSplit(messy).sizes)).toEqual([0.125, 0.375, 0.5]);
    });

    test("a missing active tab becomes the first, panels open twice keep their first place, and bad sizes are evened out", () => {
        const fixed = normalizeDockLayout({
            version: DOCK_LAYOUT_VERSION,
            root: dockSplit("split-1", "row", [dockStack("stack-2", ["scene", "game"], "console"), dockStack("stack-3", ["game", "console"])], [Number.NaN, 1]),
            closed: [{panel: "console", stack: "stack-3", index: 1}, {panel: "assets", stack: "stack-2", index: 0}],
        });
        expect(shape(fixed.root)).toBe("row([*scene,game] [*console])");
        expect(rounded(rootSplit(fixed).sizes)).toEqual([0.5, 0.5]);
        expect(fixed.closed).toEqual([{panel: "assets", stack: "stack-2", index: 0}]);
    });
});

describe("stored layouts", () => {
    test("a layout survives a round trip through its text", () => {
        const layout = closePanel(sample(), "console");
        expect(parseDockLayout(dockLayoutText(layout))).toEqual(layout);
        const empty = dockLayoutOf(undefined, [{panel: "game", stack: "stack-1", index: 0}]);
        expect(parseDockLayout(dockLayoutText(empty))).toEqual(empty);
    });

    test("nothing stored, broken JSON, another version or a non-object is no layout", () => {
        expect(parseDockLayout(null)).toBeUndefined();
        expect(parseDockLayout("{not json")).toBeUndefined();
        expect(parseDockLayout("[1, 2]")).toBeUndefined();
        expect(parseDockLayout("\"layout\"")).toBeUndefined();
        expect(parseDockLayout(JSON.stringify({...sample(), version: DOCK_LAYOUT_VERSION + 1}))).toBeUndefined();
        expect(parseDockLayout(JSON.stringify({root: sample().root, closed: []}))).toBeUndefined();
    });

    test("a malformed node makes the whole layout invalid", () => {
        const stored = (root: unknown): string => JSON.stringify({version: DOCK_LAYOUT_VERSION, root, closed: []});
        const stack = {kind: "stack", id: "stack-1", panels: ["scene"], active: "scene"};
        expect(parseDockLayout(stored({...stack, kind: "pane"}))).toBeUndefined();
        expect(parseDockLayout(stored({...stack, id: ""}))).toBeUndefined();
        expect(parseDockLayout(stored({...stack, id: 3}))).toBeUndefined();
        expect(parseDockLayout(stored({...stack, panels: "scene"}))).toBeUndefined();
        const split = (fields: Record<string, unknown>): unknown => ({kind: "split", id: "split-0", axis: "row", children: [stack, {...stack, id: "stack-2", panels: ["game"]}], sizes: [1, 1], ...fields});
        expect(parseDockLayout(stored(split({})))).toBeDefined();
        expect(parseDockLayout(stored(split({axis: "diagonal"})))).toBeUndefined();
        expect(parseDockLayout(stored(split({sizes: [1]})))).toBeUndefined();
        expect(parseDockLayout(stored(split({sizes: [1, -1]})))).toBeUndefined();
        expect(parseDockLayout(stored(split({sizes: [1, "1"]})))).toBeUndefined();
        expect(parseDockLayout(stored(split({children: []})))).toBeUndefined();
        expect(parseDockLayout(stored(split({children: [stack, stack]})))).toBeUndefined();
        expect(parseDockLayout(stored(split({children: [stack, 5]})))).toBeUndefined();
    });

    test("unknown panels are dropped, a stack left empty disappears, and missing panels count as closed", () => {
        const text = JSON.stringify({
            version: DOCK_LAYOUT_VERSION,
            root: {kind: "split", id: "split-1", axis: "row", sizes: [1, 2, 1], children: [
                {kind: "stack", id: "stack-2", panels: ["timeline", "scene", 7], active: "timeline"},
                {kind: "stack", id: "stack-3", panels: ["profiler"], active: "profiler"},
                {kind: "stack", id: "stack-4", panels: ["game", "scene"], active: "scene"},
            ]},
            closed: [],
        });
        const parsed = parseDockLayout(text);
        expect(shape(parsed?.root)).toBe("row([*scene] [*game])");
        expect(rounded(parsed === undefined ? [] : rootSplit(parsed).sizes)).toEqual([0.5, 0.5]);
        expect(parsed === undefined ? [] : closedDockPanels(parsed)).toEqual(["hierarchy", "inspector", "project", "console", "history", "settings", "assets"]);
    });

    test("no root means every panel is closed", () => {
        expect(parseDockLayout(JSON.stringify({version: DOCK_LAYOUT_VERSION, closed: []}))?.root).toBeUndefined();
        expect(parseDockLayout(JSON.stringify({version: DOCK_LAYOUT_VERSION, root: null}))?.closed).toEqual([]);
        expect(parseDockLayout(JSON.stringify({version: DOCK_LAYOUT_VERSION, root: {kind: "stack", id: "stack-1", panels: ["timeline"], active: "timeline"}}))?.root).toBeUndefined();
    });

    test("remembered places that are malformed, unknown or for open panels are dropped", () => {
        const text = JSON.stringify({
            version: DOCK_LAYOUT_VERSION,
            root: {kind: "stack", id: "stack-1", panels: ["scene"], active: "scene"},
            closed: [
                {panel: "console", stack: "stack-1", index: 0},
                {panel: "scene", stack: "stack-1", index: 0},
                {panel: "timeline", stack: "stack-1", index: 0},
                {panel: "history", stack: 4, index: 0},
                {panel: "assets", stack: "stack-1", index: -1},
                {panel: "settings", stack: "stack-1", index: 1.5},
                "inspector",
            ],
        });
        expect(parseDockLayout(text)?.closed).toEqual([{panel: "console", stack: "stack-1", index: 0}]);
    });
});
