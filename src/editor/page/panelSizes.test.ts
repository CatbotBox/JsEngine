import {describe, expect, test} from "../../engine/testing/harness";
import {
    clampPanelSize,
    clampPanelSizes,
    DEFAULT_PANEL_SIZES,
    MIN_BOTTOM_PANEL_HEIGHT_PX,
    MIN_CENTER_HEIGHT_PX,
    MIN_CENTER_WIDTH_PX,
    MIN_SIDE_PANEL_WIDTH_PX,
    panelSizesText,
    parsePanelSizes,
    resizedPanel,
    SPLITTER_THICKNESS_PX,
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
