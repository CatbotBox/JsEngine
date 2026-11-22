import {describe, expect, test} from "../../engine/testing/harness";
import {
    ALL_PANELS_SHOWN,
    clampPanelSize,
    clampPanelSizes,
    DEFAULT_PANEL_SIZES,
    MIN_BOTTOM_PANEL_HEIGHT_PX,
    MIN_CENTER_HEIGHT_PX,
    MIN_CENTER_WIDTH_PX,
    MIN_SIDE_PANEL_WIDTH_PX,
    panelSizesText,
    parsePanelSizes,
    parsePanelVisibility,
    resizedPanel,
    shownPanelSizes,
    SPLITTER_THICKNESS_PX,
    splitterThicknessPx,
    withPanelToggled,
} from "./panelSizes";

const ROOMY = {widthPx: 1600, heightPx: 900};

describe("panel size clamping", () => {
    test("a size stays between its minimum and the room left", () => {
        expect(clampPanelSize(50, 100, 400)).toBe(100);
        expect(clampPanelSize(500, 100, 400)).toBe(400);
        expect(clampPanelSize(250.4, 100, 400)).toBe(250);
        expect(clampPanelSize(Number.NaN, 100, 400)).toBe(100);
        expect(clampPanelSize(500, 100, 20)).toBe(100);
    });

    test("side panels leave the centre its minimum width and the bottom panel its minimum height", () => {
        const squeezed = clampPanelSizes({hierarchyWidthPx: 900, inspectorWidthPx: 900, bottomHeightPx: 900}, {widthPx: 1000, heightPx: 500});
        expect(squeezed.hierarchyWidthPx + squeezed.inspectorWidthPx + MIN_CENTER_WIDTH_PX + 2 * SPLITTER_THICKNESS_PX).toBe(1000);
        expect(squeezed.hierarchyWidthPx).toBe(MIN_SIDE_PANEL_WIDTH_PX);
        expect(squeezed.bottomHeightPx).toBe(500 - SPLITTER_THICKNESS_PX - MIN_CENTER_HEIGHT_PX);
        const tiny = clampPanelSizes(DEFAULT_PANEL_SIZES, {widthPx: 100, heightPx: 100});
        expect(tiny.bottomHeightPx).toBe(MIN_BOTTOM_PANEL_HEIGHT_PX);
    });

    test("dragging a splitter grows the left panel with the pointer and the right and bottom panels against it", () => {
        expect(resizedPanel(DEFAULT_PANEL_SIZES, "hierarchyWidthPx", 260, 40, ROOMY).hierarchyWidthPx).toBe(300);
        expect(resizedPanel(DEFAULT_PANEL_SIZES, "inspectorWidthPx", 340, 40, ROOMY).inspectorWidthPx).toBe(300);
        expect(resizedPanel(DEFAULT_PANEL_SIZES, "bottomHeightPx", 220, -30, ROOMY).bottomHeightPx).toBe(250);
    });
});

describe("stored panel sizes", () => {
    test("missing, broken or partial storage falls back per field", () => {
        expect(parsePanelSizes(null)).toEqual(DEFAULT_PANEL_SIZES);
        expect(parsePanelSizes("{not json")).toEqual(DEFAULT_PANEL_SIZES);
        expect(parsePanelSizes("[1, 2]")).toEqual(DEFAULT_PANEL_SIZES);
        expect(parsePanelSizes(`{"hierarchyWidthPx": 300, "inspectorWidthPx": -5, "bottomHeightPx": "tall"}`))
            .toEqual({...DEFAULT_PANEL_SIZES, hierarchyWidthPx: 300});
    });

    test("sizes round-trip through their text", () => {
        const sizes = {hierarchyWidthPx: 280, inspectorWidthPx: 360, bottomHeightPx: 240};
        expect(parsePanelSizes(panelSizesText(sizes))).toEqual(sizes);
    });
});

describe("panel visibility", () => {
    test("a hidden side panel gives its width and splitter to the shown one and keeps its own size for later", () => {
        const hierarchyHidden = {...ALL_PANELS_SHOWN, hierarchy: false};
        const wide = clampPanelSizes({hierarchyWidthPx: 300, inspectorWidthPx: 900, bottomHeightPx: 220}, {widthPx: 1000, heightPx: 500}, hierarchyHidden);
        expect(wide).toEqual({hierarchyWidthPx: 300, inspectorWidthPx: 1000 - SPLITTER_THICKNESS_PX - MIN_CENTER_WIDTH_PX, bottomHeightPx: 220});
        expect(shownPanelSizes(wide, hierarchyHidden)).toEqual({...wide, hierarchyWidthPx: 0});
        expect(splitterThicknessPx(hierarchyHidden, "hierarchy")).toBe(0);
        expect(splitterThicknessPx(hierarchyHidden, "inspector")).toBe(SPLITTER_THICKNESS_PX);
        const bottomHidden = {...ALL_PANELS_SHOWN, bottom: false};
        expect(clampPanelSizes({...DEFAULT_PANEL_SIZES, bottomHeightPx: 5000}, ROOMY, bottomHidden).bottomHeightPx).toBe(5000);
    });

    test("toggling flips one panel and the hidden panels round-trip with the sizes", () => {
        const hidden = withPanelToggled(withPanelToggled(ALL_PANELS_SHOWN, "inspector"), "bottom");
        expect(hidden).toEqual({hierarchy: true, inspector: false, bottom: false});
        expect(withPanelToggled(hidden, "bottom").bottom).toBe(true);
        const text = panelSizesText(DEFAULT_PANEL_SIZES, hidden);
        expect(parsePanelVisibility(text)).toEqual(hidden);
        expect(parsePanelSizes(text)).toEqual(DEFAULT_PANEL_SIZES);
    });

    test("old or broken storage shows every panel", () => {
        expect(parsePanelVisibility(null)).toEqual(ALL_PANELS_SHOWN);
        expect(parsePanelVisibility(`{"hierarchyWidthPx": 300}`)).toEqual(ALL_PANELS_SHOWN);
        expect(parsePanelVisibility(`{"hidden": "inspector"}`)).toEqual(ALL_PANELS_SHOWN);
        expect(parsePanelVisibility(`{"hidden": ["inspector", "toolbar"]}`)).toEqual({...ALL_PANELS_SHOWN, inspector: false});
        expect(parsePanelVisibility("[1]")).toEqual(ALL_PANELS_SHOWN);
    });
});
