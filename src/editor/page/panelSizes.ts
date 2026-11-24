export interface PanelSizes {
    readonly hierarchyWidthPx: number;
    readonly inspectorWidthPx: number;
    readonly bottomHeightPx: number;
}

export interface AvailableArea {
    readonly widthPx: number;
    readonly heightPx: number;
}

export type PanelSizeKey = keyof PanelSizes;

export type LayoutPanel = "hierarchy" | "inspector" | "bottom";

export type PanelVisibility = Readonly<Record<LayoutPanel, boolean>>;

export const PANEL_SIZES_STORAGE_KEY = "jsengine.editor.panelSizes";
export const DEFAULT_PANEL_SIZES: PanelSizes = {hierarchyWidthPx: 260, inspectorWidthPx: 340, bottomHeightPx: 220};
export const MIN_SIDE_PANEL_WIDTH_PX = 140;
export const MIN_BOTTOM_PANEL_HEIGHT_PX = 90;
export const MIN_CENTER_WIDTH_PX = 200;
export const MIN_CENTER_HEIGHT_PX = 120;
export const SPLITTER_THICKNESS_PX = 5;
export const LAYOUT_PANELS: readonly LayoutPanel[] = ["hierarchy", "inspector", "bottom"];
export const ALL_PANELS_SHOWN: PanelVisibility = {hierarchy: true, inspector: true, bottom: true};
export const PANEL_SIZE_KEYS: Readonly<Record<LayoutPanel, PanelSizeKey>> = {hierarchy: "hierarchyWidthPx", inspector: "inspectorWidthPx", bottom: "bottomHeightPx"};

export const DEFAULT_SCENE_VIEW_SHARE = 0.5;
export const MIN_VIEW_WIDTH_PX = 120;

const SIZE_KEYS: readonly PanelSizeKey[] = ["hierarchyWidthPx", "inspectorWidthPx", "bottomHeightPx"];
const HIDDEN_PANELS_KEY = "hidden";
const SCENE_VIEW_SHARE_KEY = "sceneViewShare";
const HIDDEN_PX = 0;
const NO_SHARE = 0;
const WHOLE_SHARE = 1;
const SPLIT_VIEWS = 2;

export function clampPanelSize(sizePx: number, minPx: number, maxPx: number): number {
    if (!Number.isFinite(sizePx)) return minPx;
    return Math.round(Math.max(minPx, Math.min(sizePx, Math.max(minPx, maxPx))));
}

function shownWidth(shown: boolean, widthPx: number): number {
    return shown ? widthPx + SPLITTER_THICKNESS_PX : HIDDEN_PX;
}

export function clampPanelSizes(sizes: PanelSizes, area: AvailableArea, visibility: PanelVisibility = ALL_PANELS_SHOWN): PanelSizes {
    const hierarchyWidthPx = visibility.hierarchy
        ? clampPanelSize(sizes.hierarchyWidthPx, MIN_SIDE_PANEL_WIDTH_PX,
            area.widthPx - SPLITTER_THICKNESS_PX - MIN_CENTER_WIDTH_PX - shownWidth(visibility.inspector, Math.max(MIN_SIDE_PANEL_WIDTH_PX, sizes.inspectorWidthPx)))
        : sizes.hierarchyWidthPx;
    const inspectorWidthPx = visibility.inspector
        ? clampPanelSize(sizes.inspectorWidthPx, MIN_SIDE_PANEL_WIDTH_PX,
            area.widthPx - SPLITTER_THICKNESS_PX - MIN_CENTER_WIDTH_PX - shownWidth(visibility.hierarchy, hierarchyWidthPx))
        : sizes.inspectorWidthPx;
    const bottomHeightPx = visibility.bottom
        ? clampPanelSize(sizes.bottomHeightPx, MIN_BOTTOM_PANEL_HEIGHT_PX, area.heightPx - SPLITTER_THICKNESS_PX - MIN_CENTER_HEIGHT_PX)
        : sizes.bottomHeightPx;
    return {hierarchyWidthPx, inspectorWidthPx, bottomHeightPx};
}

export function resizedPanel(sizes: PanelSizes, key: PanelSizeKey, startPx: number, dragDeltaPx: number, area: AvailableArea, visibility: PanelVisibility = ALL_PANELS_SHOWN): PanelSizes {
    const growsAgainstPointer = key !== "hierarchyWidthPx";
    const wanted = startPx + (growsAgainstPointer ? -dragDeltaPx : dragDeltaPx);
    return clampPanelSizes({...sizes, [key]: wanted}, area, visibility);
}

export function shownPanelSizes(sizes: PanelSizes, visibility: PanelVisibility): PanelSizes {
    const shown: Record<PanelSizeKey, number> = {...sizes};
    for (const panel of LAYOUT_PANELS) if (!visibility[panel]) shown[PANEL_SIZE_KEYS[panel]] = HIDDEN_PX;
    return shown;
}

export function splitterThicknessPx(visibility: PanelVisibility, panel: LayoutPanel): number {
    return visibility[panel] ? SPLITTER_THICKNESS_PX : HIDDEN_PX;
}

export function withPanelToggled(visibility: PanelVisibility, panel: LayoutPanel): PanelVisibility {
    return {...visibility, [panel]: !visibility[panel]};
}

function isPanelSize(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function storedRecord(text: string | null): Record<string, unknown> | undefined {
    if (text === null) return undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return undefined;
    }
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
}

export function parsePanelSizes(text: string | null): PanelSizes {
    const record = storedRecord(text);
    if (record === undefined) return DEFAULT_PANEL_SIZES;
    const sizes: Record<PanelSizeKey, number> = {...DEFAULT_PANEL_SIZES};
    for (const key of SIZE_KEYS) {
        const value = record[key];
        if (isPanelSize(value)) sizes[key] = value;
    }
    return sizes;
}

export function parsePanelVisibility(text: string | null): PanelVisibility {
    const hidden = storedRecord(text)?.[HIDDEN_PANELS_KEY];
    if (!Array.isArray(hidden)) return ALL_PANELS_SHOWN;
    const visibility: Record<LayoutPanel, boolean> = {...ALL_PANELS_SHOWN};
    for (const panel of LAYOUT_PANELS) if (hidden.includes(panel)) visibility[panel] = false;
    return visibility;
}

export function panelSizesText(sizes: PanelSizes, visibility: PanelVisibility = ALL_PANELS_SHOWN, sceneViewShare: number = DEFAULT_SCENE_VIEW_SHARE): string {
    return JSON.stringify({...sizes, [HIDDEN_PANELS_KEY]: LAYOUT_PANELS.filter(panel => !visibility[panel]), [SCENE_VIEW_SHARE_KEY]: sceneViewShare});
}

function isShare(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > NO_SHARE && value < WHOLE_SHARE;
}

export function parseSceneViewShare(text: string | null): number {
    const share = storedRecord(text)?.[SCENE_VIEW_SHARE_KEY];
    return isShare(share) ? share : DEFAULT_SCENE_VIEW_SHARE;
}

export function clampSceneViewShare(share: number, viewsWidthPx: number): number {
    if (!Number.isFinite(share)) return DEFAULT_SCENE_VIEW_SHARE;
    const sharedPx = viewsWidthPx - SPLITTER_THICKNESS_PX;
    if (sharedPx < SPLIT_VIEWS * MIN_VIEW_WIDTH_PX) return isShare(share) ? share : DEFAULT_SCENE_VIEW_SHARE;
    const minShare = MIN_VIEW_WIDTH_PX / sharedPx;
    return Math.max(minShare, Math.min(share, WHOLE_SHARE - minShare));
}

export function resizedSceneViewShare(startShare: number, dragDeltaPx: number, viewsWidthPx: number): number {
    const sharedPx = viewsWidthPx - SPLITTER_THICKNESS_PX;
    if (sharedPx <= HIDDEN_PX) return clampSceneViewShare(startShare, viewsWidthPx);
    return clampSceneViewShare(startShare + dragDeltaPx / sharedPx, viewsWidthPx);
}
