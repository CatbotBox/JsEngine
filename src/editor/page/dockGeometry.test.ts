import {describe, expect, test} from "../../engine/testing/harness";
import {
    clientPointAt,
    contentOrigin,
    distributedLengths,
    dockAreaContains,
    dockDropAt,
    EDGE_ZONE_SHARE,
    estimatedChrome,
    floatingWindowBounds,
    measuredChrome,
    MIN_FLOATING_HEIGHT_PX,
    MIN_FLOATING_WIDTH_PX,
    minimumSizeOf,
    outerRectOf,
    placeDock,
    resizedLengths,
    ROOT_EDGE_BAND_PX,
    screenPointAt,
    sharesOf,
    SPLITTER_THICKNESS_PX,
    windowAtScreenPoint,
} from "./dockGeometry";
import type {DockDropArea, DockMinimums, DockRect, DockSize, DockWindowMetrics} from "./dockGeometry";
import {dockLayoutOf, dockSplit, dockStack, ROOT_EDGE_SHARE, STACK_EDGE_SHARE} from "./dockLayout";
import type {DockNode} from "./dockLayout";

const SIDE: DockSize = {widthPx: 140, heightPx: 90};
const VIEW: DockSize = {widthPx: 120, heightPx: 120};
const MINIMUMS: DockMinimums = {
    hierarchy: SIDE, inspector: SIDE, scene: VIEW, game: VIEW, project: SIDE, console: SIDE, history: SIDE, settings: SIDE, assets: SIDE,
};
const AREA: DockRect = {left: 0, top: 0, width: 1000, height: 600};

function sampleRoot(): DockNode {
    return dockLayoutOf(dockSplit("split-1", "row", [
        dockSplit("split-2", "column", [
            dockSplit("split-3", "row", [dockStack("stack-4", ["hierarchy"]), dockStack("stack-5", ["scene"]), dockStack("stack-6", ["game"])], [0.2, 0.4, 0.4]),
            dockStack("stack-7", ["project", "console"]),
        ], [0.75, 0.25]),
        dockStack("stack-8", ["inspector"]),
    ], [0.8, 0.2])).root!;
}

function right(rect: DockRect): number {
    return rect.left + rect.width;
}

function bottom(rect: DockRect): number {
    return rect.top + rect.height;
}

describe("minimum sizes", () => {
    test("a stack needs its largest panel's minimum; a split adds up along its axis with splitters and takes the largest across", () => {
        expect(minimumSizeOf(dockStack("stack-1", ["hierarchy", "scene"]), MINIMUMS)).toEqual({widthPx: 140, heightPx: 120});
        const row = dockSplit("split-1", "row", [dockStack("stack-2", ["hierarchy"]), dockStack("stack-3", ["scene"])], [0.5, 0.5]);
        expect(minimumSizeOf(row, MINIMUMS)).toEqual({widthPx: 140 + 120 + SPLITTER_THICKNESS_PX, heightPx: 120});
        const column = dockSplit("split-4", "column", [row, dockStack("stack-5", ["console"])], [0.5, 0.5]);
        expect(minimumSizeOf(column, MINIMUMS)).toEqual({widthPx: 265, heightPx: 120 + 90 + SPLITTER_THICKNESS_PX});
    });
});

describe("distributing lengths", () => {
    test("lengths follow the shares when every child fits", () => {
        expect(distributedLengths([0.25, 0.75], [10, 10], 400)).toEqual([100, 300]);
    });

    test("a child below its minimum is held at it and the others share what is left by their shares", () => {
        expect(distributedLengths([0.1, 0.45, 0.45], [100, 10, 10], 500)).toEqual([100, 200, 200]);
    });

    test("when even the minimums do not fit they shrink together, and no space gives zero lengths", () => {
        expect(distributedLengths([0.5, 0.5], [300, 100], 200)).toEqual([150, 50]);
        expect(distributedLengths([0.5, 0.5], [0, 0], 0)).toEqual([0, 0]);
        expect(distributedLengths([0.5, 0.5], [10, 10], -50)).toEqual([0, 0]);
    });
});

describe("placing a dock tree", () => {
    test("stacks tile the area with a splitter between every pair of siblings", () => {
        const placement = placeDock(sampleRoot(), AREA, MINIMUMS);
        const rect = (id: string): DockRect => placement.stacks.get(id)!;
        expect(rect("stack-8")).toEqual({left: 801, top: 0, width: 199, height: 600});
        expect(right(rect("stack-6"))).toBe(796);
        expect(bottom(rect("stack-7"))).toBe(600);
        expect(rect("stack-7").top).toBe(bottom(rect("stack-4")) + SPLITTER_THICKNESS_PX);
        expect(rect("stack-5").left).toBe(right(rect("stack-4")) + SPLITTER_THICKNESS_PX);
        expect(placement.splitters.map(splitter => [splitter.split, splitter.index, splitter.axis])).toEqual([
            ["split-3", 0, "row"], ["split-3", 1, "row"], ["split-2", 0, "column"], ["split-1", 0, "row"],
        ]);
        expect(placement.splitters.find(splitter => splitter.split === "split-1")?.rect).toEqual({left: 796, top: 0, width: SPLITTER_THICKNESS_PX, height: 600});
        expect(placement.splits.get("split-1")?.minimums).toEqual([140 + 120 + 120 + 2 * SPLITTER_THICKNESS_PX, 140]);
    });

    test("a tight area keeps every stack at its minimum where it can", () => {
        const placement = placeDock(sampleRoot(), {left: 0, top: 0, width: 600, height: 400}, MINIMUMS);
        expect(placement.stacks.get("stack-4")!.width).toBeGreaterThan(139);
        expect(placement.stacks.get("stack-8")!.width).toBeGreaterThan(139);
        expect(placement.stacks.get("stack-7")!.height).toBeGreaterThan(89);
    });

    test("a lone stack fills the area and nothing places nothing", () => {
        const placement = placeDock(dockStack("stack-1", ["game"]), AREA, MINIMUMS);
        expect([...placement.stacks.entries()]).toEqual([["stack-1", AREA]]);
        expect(placement.splitters).toEqual([]);
        expect(placeDock(undefined, AREA, MINIMUMS).stacks.size).toBe(0);
    });
});

describe("dragging a splitter", () => {
    test("the boundary follows the pointer and only its two neighbours change", () => {
        expect(resizedLengths([100, 200, 300], 1, 50, [10, 10, 10])).toEqual([100, 250, 250]);
        expect(resizedLengths([100, 200, 300], 0, -30, [10, 10, 10])).toEqual([70, 230, 300]);
    });

    test("neither neighbour goes below its minimum, and a pair too small to resize stays", () => {
        expect(resizedLengths([100, 200], 0, -500, [80, 50])).toEqual([80, 220]);
        expect(resizedLengths([100, 200], 0, 500, [80, 50])).toEqual([250, 50]);
        expect(resizedLengths([100, 100], 0, 10, [150, 150])).toEqual([100, 100]);
        expect(resizedLengths([100, 100], 3, 10, [10, 10])).toEqual([100, 100]);
    });

    test("lengths become shares of their total", () => {
        expect(sharesOf([100, 300])).toEqual([0.25, 0.75]);
        expect(sharesOf([0, 0])).toEqual([0.5, 0.5]);
    });
});

describe("drop targets", () => {
    const area: DockDropArea = {
        root: {left: 0, top: 0, width: 1000, height: 600},
        stacks: [
            {stack: "left", rect: {left: 0, top: 0, width: 400, height: 600}, strip: {left: 0, top: 0, width: 400, height: 25}, tabs: [{left: 5, top: 0, width: 80, height: 25}, {left: 90, top: 0, width: 80, height: 25}]},
            {stack: "right", rect: {left: 405, top: 0, width: 595, height: 600}, strip: {left: 405, top: 0, width: 595, height: 25}, tabs: [{left: 410, top: 0, width: 60, height: 25}]},
        ],
    };

    test("over a tab strip the drop goes between the tabs whose middles it passed", () => {
        expect(dockDropAt(20, 10, area)?.target).toEqual({stack: "left", index: 0});
        expect(dockDropAt(60, 10, area)?.target).toEqual({stack: "left", index: 1});
        expect(dockDropAt(150, 10, area)?.target).toEqual({stack: "left", index: 2});
        expect(dockDropAt(300, 10, area)?.target).toEqual({stack: "left", index: 2});
        expect(dockDropAt(300, 10, area)?.preview).toEqual(area.stacks[0].rect);
    });

    test("a tab strip wins over the root edge band", () => {
        expect(dockDropAt(20, 2, area)?.target).toEqual({stack: "left", index: 0});
    });

    test("near the root's outer edge the drop docks at the root with a preview band", () => {
        const drop = dockDropAt(995, 300, area);
        expect(drop?.target).toEqual({rootEdge: "right"});
        expect(drop?.preview).toEqual({left: 1000 - 1000 * ROOT_EDGE_SHARE, top: 0, width: 1000 * ROOT_EDGE_SHARE, height: 600});
        expect(dockDropAt(500, 600 - ROOT_EDGE_BAND_PX / 2, area)?.target).toEqual({rootEdge: "bottom"});
    });

    test("near a stack's content edge the drop splits that stack, previewing the half it would take", () => {
        const drop = dockDropAt(410 + 595 * EDGE_ZONE_SHARE / 2, 300, area);
        expect(drop?.target).toEqual({stack: "right", edge: "left"});
        expect(drop?.preview).toEqual({left: 405, top: 0, width: 595 * STACK_EDGE_SHARE, height: 600});
        expect(dockDropAt(200, 560, area)?.target).toEqual({stack: "left", edge: "bottom"});
        expect(dockDropAt(200, 60, area)?.target).toEqual({stack: "left", edge: "top"});
    });

    test("in a stack's middle the drop adds a tab at the end", () => {
        expect(dockDropAt(700, 300, area)).toEqual({target: {stack: "right", index: 1}, preview: area.stacks[1].rect});
    });

    test("the dragged panel's own lone stack, the gaps and the outside are no targets", () => {
        expect(dockDropAt(700, 300, area, "right")).toBeUndefined();
        expect(dockDropAt(450, 10, area, "right")).toBeUndefined();
        expect(dockDropAt(402, 300, area)).toBeUndefined();
        expect(dockDropAt(-5, 300, area)).toBeUndefined();
        expect(dockDropAt(995, 300, area, "right")?.target).toEqual({rootEdge: "right"});
    });

    test("a stack whose strip fills it takes every drop as a new tab", () => {
        const squashed: DockDropArea = {root: area.root, stacks: [{stack: "only", rect: {left: 100, top: 100, width: 200, height: 20}, strip: {left: 100, top: 100, width: 200, height: 25}, tabs: []}]};
        expect(dockDropAt(150, 110, squashed)?.target).toEqual({stack: "only", index: 0});
    });

    test("the dock area holds every point of its root, target or not", () => {
        expect(dockAreaContains(area, 402, 300)).toBe(true);
        expect(dockAreaContains(area, 0, 0)).toBe(true);
        expect(dockAreaContains(area, 1000, 300)).toBe(false);
        expect(dockAreaContains(area, -1, 300)).toBe(false);
    });
});

describe("screen coordinates across windows", () => {
    const ZOOM = 1.25;
    const framed: DockWindowMetrics = {screenX: 300, screenY: 250, outerWidth: 600, outerHeight: 400, innerWidth: 586 / ZOOM, innerHeight: 363 / ZOOM};

    test("a window's chrome is estimated from its outer and inner sizes, with the borders split evenly", () => {
        expect(estimatedChrome(framed, ZOOM)).toEqual({left: 7, top: 30, width: 14, height: 37});
        expect(estimatedChrome({...framed, outerWidth: 100, innerWidth: 200, outerHeight: 50, innerHeight: 80}, 1)).toEqual({left: 0, top: 0, width: 0, height: 0});
    });

    test("a pointer event measures where the content starts exactly", () => {
        const chrome = measuredChrome(framed, {screenX: 357, screenY: 320, clientX: 40, clientY: 32}, ZOOM);
        expect([chrome.left, chrome.top]).toEqual([7, 30]);
        expect(contentOrigin(framed, chrome)).toEqual({x: 307, y: 280});
        expect(measuredChrome({...framed, outerWidth: 590}, {screenX: 352, screenY: 300, clientX: 40, clientY: 16}, ZOOM)).toEqual({left: 2, top: 30, width: 4, height: 37});
    });

    test("a pointer sample that cannot come from inside the window falls back to the estimate", () => {
        expect(measuredChrome(framed, {screenX: 0, screenY: 0, clientX: 40, clientY: 32}, ZOOM)).toEqual(estimatedChrome(framed, ZOOM));
        expect(measuredChrome(framed, {screenX: 900, screenY: 320, clientX: 40, clientY: 32}, ZOOM)).toEqual(estimatedChrome(framed, ZOOM));
    });

    test("screen points convert into a window's client space and back", () => {
        const origin = {x: 307, y: 280};
        expect(clientPointAt({x: 357, y: 320}, origin, ZOOM)).toEqual({x: 40, y: 32});
        expect(screenPointAt({x: 40, y: 32}, origin, ZOOM)).toEqual({x: 357, y: 320});
        expect(clientPointAt({x: 200, y: 100}, origin, ZOOM).x).toBeLessThan(0);
    });

    test("the first window in front-to-back order that holds the point wins", () => {
        const windows = [
            {id: "float-2", rect: outerRectOf(framed)},
            {id: "main", rect: {x: 0, y: 0, width: 1600, height: 900}},
        ];
        expect(windowAtScreenPoint({x: 310, y: 260}, windows)).toBe("float-2");
        expect(windowAtScreenPoint({x: 100, y: 100}, windows)).toBe("main");
        expect(windowAtScreenPoint({x: 900, y: 650}, windows)).toBe("main");
        expect(windowAtScreenPoint({x: 2000, y: 100}, windows)).toBeUndefined();
        expect(windowAtScreenPoint({x: 1600, y: 100}, windows)).toBeUndefined();
    });

    test("a floating window is placed so its content starts at the given point, with the chrome around it", () => {
        const chrome = {left: 7, top: 30, width: 14, height: 37};
        expect(floatingWindowBounds({x: 500, y: 400}, {widthPx: 400, heightPx: 300}, ZOOM, chrome)).toEqual({x: 493, y: 370, width: 514, height: 412});
        expect(floatingWindowBounds({x: 0, y: 0}, {widthPx: 10, heightPx: 10}, 1, chrome)).toEqual({x: -7, y: -30, width: MIN_FLOATING_WIDTH_PX + 14, height: MIN_FLOATING_HEIGHT_PX + 37});
    });
});
