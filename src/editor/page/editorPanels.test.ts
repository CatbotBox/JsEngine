import {describe, expect, test} from "../../engine/testing/harness";
import {placeDock} from "./dockGeometry";
import {closedDockPanels, dockStacks, openDockPanels, parseDockLayout, dockLayoutText, stackOfPanel} from "./dockLayout";
import {
    BOTTOM_HEIGHT_PX,
    BOTTOM_PANELS,
    DEFAULT_BOTTOM_PANEL,
    defaultDockLayout,
    DOCK_PANEL_HOMES,
    DOCK_PANEL_MINIMUMS,
    HIERARCHY_WIDTH_PX,
    INSPECTOR_WIDTH_PX,
    REFERENCE_DOCK_AREA,
} from "./editorPanels";
import {DOCK_PANEL_KINDS} from "../project/dockPanelIds";

const TOLERANCE_PX = 1;

describe("the default dock layout", () => {
    test("Hierarchy, Scene | Game and Inspector sit above the bottom panels with Project in front", () => {
        const layout = defaultDockLayout(REFERENCE_DOCK_AREA);
        expect(openDockPanels(layout)).toEqual(["hierarchy", "scene", "game", ...BOTTOM_PANELS, "inspector"]);
        expect(closedDockPanels(layout)).toEqual([]);
        expect(stackOfPanel(layout, "console")?.active).toBe(DEFAULT_BOTTOM_PANEL);
        expect(dockStacks(layout.root).length).toBe(5);
        expect(parseDockLayout(dockLayoutText(layout))).toEqual(layout);
    });

    test("the side panels and the bottom stack get today's pixel sizes in the area they were made for", () => {
        const area = {widthPx: 1400, heightPx: 800};
        const layout = defaultDockLayout(area);
        const placement = placeDock(layout.root, {left: 0, top: 0, width: area.widthPx, height: area.heightPx}, DOCK_PANEL_MINIMUMS);
        const rectOf = (panel: "hierarchy" | "inspector" | "project" | "scene" | "game") => placement.stacks.get(stackOfPanel(layout, panel)!.id)!;
        expect(Math.abs(rectOf("hierarchy").width - HIERARCHY_WIDTH_PX)).toBeLessThan(TOLERANCE_PX + 0.5);
        expect(Math.abs(rectOf("inspector").width - INSPECTOR_WIDTH_PX)).toBeLessThan(TOLERANCE_PX + 0.5);
        expect(Math.abs(rectOf("project").height - BOTTOM_HEIGHT_PX)).toBeLessThan(TOLERANCE_PX + 0.5);
        expect(Math.abs(rectOf("scene").width - rectOf("game").width)).toBeLessThan(TOLERANCE_PX + 0.5);
        expect(rectOf("inspector").height).toBe(area.heightPx);
    });

    test("an area that has not been laid out yet falls back to the reference area", () => {
        expect(defaultDockLayout({widthPx: 0, heightPx: 0})).toEqual(defaultDockLayout(REFERENCE_DOCK_AREA));
    });

    test("every panel has a home to reopen in", () => {
        for (const panel of DOCK_PANEL_KINDS) expect(DOCK_PANEL_HOMES[panel].length).toBeGreaterThan(0);
    });
});
