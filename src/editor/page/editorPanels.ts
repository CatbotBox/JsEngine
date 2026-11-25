import {SPLITTER_THICKNESS_PX} from "./dockGeometry";
import type {DockMinimums, DockSize} from "./dockGeometry";
import {dockLayoutOf, dockSplit, dockStack, MAX_SHARE, MIN_SHARE} from "./dockLayout";
import type {DockLayout} from "./dockLayout";
import type {DockViewHome} from "./dockView";
import {dockPanelKindOf, dockPanelTitle} from "../project/dockPanelIds";
import type {DockPanelId, DockPanelKind} from "../project/dockPanelIds";

export {DOCK_LAYOUT_STORAGE_KEY} from "../project/dockWindows";
export const DOCK_PANEL_TITLES: Readonly<Record<DockPanelKind, string>> = {
    hierarchy: "Hierarchy",
    inspector: "Inspector",
    scene: "Scene",
    game: "Game",
    project: "Project",
    console: "Console",
    history: "History",
    settings: "Settings",
    assets: "Data Assets",
};
export const BOTTOM_PANELS: readonly DockPanelKind[] = ["project", "console", "history", "settings", "assets"];
export const DEFAULT_BOTTOM_PANEL: DockPanelKind = "project";
export const HIERARCHY_WIDTH_PX = 260;
export const INSPECTOR_WIDTH_PX = 340;
export const BOTTOM_HEIGHT_PX = 220;
export const MIN_SIDE_PANEL_WIDTH_PX = 140;
export const MIN_PANEL_HEIGHT_PX = 90;
export const MIN_VIEW_WIDTH_PX = 120;
export const MIN_VIEW_HEIGHT_PX = 120;
export const REFERENCE_DOCK_AREA: DockSize = {widthPx: 1600, heightPx: 860};

const SIDE_PANEL_MINIMUM: DockSize = {widthPx: MIN_SIDE_PANEL_WIDTH_PX, heightPx: MIN_PANEL_HEIGHT_PX};
const VIEW_MINIMUM: DockSize = {widthPx: MIN_VIEW_WIDTH_PX, heightPx: MIN_VIEW_HEIGHT_PX};
const SPLIT_VIEWS = 2;
const WHOLE = 1;
const HIERARCHY_COLUMN_SPLITTERS = 2;

export const DOCK_PANEL_MINIMUMS: DockMinimums = {
    hierarchy: SIDE_PANEL_MINIMUM,
    inspector: SIDE_PANEL_MINIMUM,
    scene: VIEW_MINIMUM,
    game: VIEW_MINIMUM,
    project: SIDE_PANEL_MINIMUM,
    console: SIDE_PANEL_MINIMUM,
    history: SIDE_PANEL_MINIMUM,
    settings: SIDE_PANEL_MINIMUM,
    assets: SIDE_PANEL_MINIMUM,
};

function bottomHomes(panel: DockPanelKind): DockViewHome[] {
    return [
        ...BOTTOM_PANELS.filter(other => other !== panel).map(other => ({withPanel: other})),
        {nextTo: "scene", edge: "bottom", sizePx: BOTTOM_HEIGHT_PX},
        {nextTo: "game", edge: "bottom", sizePx: BOTTOM_HEIGHT_PX},
        {rootEdge: "bottom", sizePx: BOTTOM_HEIGHT_PX},
    ];
}

export const DOCK_PANEL_HOMES: Readonly<Record<DockPanelKind, readonly DockViewHome[]>> = {
    hierarchy: [{nextTo: "scene", edge: "left", sizePx: HIERARCHY_WIDTH_PX}, {nextTo: "game", edge: "left", sizePx: HIERARCHY_WIDTH_PX}, {rootEdge: "left", sizePx: HIERARCHY_WIDTH_PX}],
    inspector: [{rootEdge: "right", sizePx: INSPECTOR_WIDTH_PX}],
    scene: [{nextTo: "game", edge: "left"}, {nextTo: "hierarchy", edge: "right"}, {rootEdge: "top"}],
    game: [{nextTo: "scene", edge: "right"}, {nextTo: "hierarchy", edge: "right"}, {rootEdge: "top"}],
    project: bottomHomes("project"),
    console: bottomHomes("console"),
    history: bottomHomes("history"),
    settings: bottomHomes("settings"),
    assets: bottomHomes("assets"),
};

export function dockPanelTitleOf(panel: DockPanelId): string {
    return dockPanelTitle(panel, DOCK_PANEL_TITLES[dockPanelKindOf(panel)]);
}

export function dockPanelHomesOf(panel: DockPanelId): readonly DockViewHome[] {
    return DOCK_PANEL_HOMES[dockPanelKindOf(panel)];
}

function shareOf(sizePx: number, availablePx: number): number {
    if (!(availablePx > 0)) return MIN_SHARE;
    return Math.max(MIN_SHARE, Math.min(MAX_SHARE, sizePx / availablePx));
}

function usableArea(area: DockSize): DockSize {
    return area.widthPx > 0 && area.heightPx > 0 ? area : REFERENCE_DOCK_AREA;
}

export function defaultDockLayout(area: DockSize = REFERENCE_DOCK_AREA): DockLayout {
    const {widthPx, heightPx} = usableArea(area);
    const inspectorShare = shareOf(INSPECTOR_WIDTH_PX, widthPx - SPLITTER_THICKNESS_PX);
    const leftWidthPx = (widthPx - SPLITTER_THICKNESS_PX) * (WHOLE - inspectorShare);
    const hierarchyShare = shareOf(HIERARCHY_WIDTH_PX, leftWidthPx - HIERARCHY_COLUMN_SPLITTERS * SPLITTER_THICKNESS_PX);
    const viewShare = (WHOLE - hierarchyShare) / SPLIT_VIEWS;
    const bottomShare = shareOf(BOTTOM_HEIGHT_PX, heightPx - SPLITTER_THICKNESS_PX);
    const views = dockSplit("split-3", "row", [
        dockStack("stack-4", ["hierarchy"]),
        dockStack("stack-5", ["scene"]),
        dockStack("stack-6", ["game"]),
    ], [hierarchyShare, viewShare, viewShare]);
    const left = dockSplit("split-2", "column", [views, dockStack("stack-7", BOTTOM_PANELS, DEFAULT_BOTTOM_PANEL)], [WHOLE - bottomShare, bottomShare]);
    return dockLayoutOf(dockSplit("split-1", "row", [left, dockStack("stack-8", ["inspector"])], [WHOLE - inspectorShare, inspectorShare]));
}
