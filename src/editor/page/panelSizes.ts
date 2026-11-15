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

export const PANEL_SIZES_STORAGE_KEY = "jsengine.editor.panelSizes";
export const DEFAULT_PANEL_SIZES: PanelSizes = {hierarchyWidthPx: 260, inspectorWidthPx: 340, bottomHeightPx: 220};
export const MIN_SIDE_PANEL_WIDTH_PX = 140;
export const MIN_BOTTOM_PANEL_HEIGHT_PX = 90;
export const MIN_CENTER_WIDTH_PX = 200;
export const MIN_CENTER_HEIGHT_PX = 120;
export const SPLITTER_THICKNESS_PX = 5;

const PANEL_SIZE_KEYS: readonly PanelSizeKey[] = ["hierarchyWidthPx", "inspectorWidthPx", "bottomHeightPx"];

export function clampPanelSize(sizePx: number, minPx: number, maxPx: number): number {
    if (!Number.isFinite(sizePx)) return minPx;
    return Math.round(Math.max(minPx, Math.min(sizePx, Math.max(minPx, maxPx))));
}

export function clampPanelSizes(sizes: PanelSizes, area: AvailableArea): PanelSizes {
    const splittersWidth = SPLITTER_THICKNESS_PX * 2;
    const hierarchyWidthPx = clampPanelSize(sizes.hierarchyWidthPx, MIN_SIDE_PANEL_WIDTH_PX,
        area.widthPx - splittersWidth - MIN_CENTER_WIDTH_PX - Math.max(MIN_SIDE_PANEL_WIDTH_PX, sizes.inspectorWidthPx));
    const inspectorWidthPx = clampPanelSize(sizes.inspectorWidthPx, MIN_SIDE_PANEL_WIDTH_PX,
        area.widthPx - splittersWidth - MIN_CENTER_WIDTH_PX - hierarchyWidthPx);
    const bottomHeightPx = clampPanelSize(sizes.bottomHeightPx, MIN_BOTTOM_PANEL_HEIGHT_PX,
        area.heightPx - SPLITTER_THICKNESS_PX - MIN_CENTER_HEIGHT_PX);
    return {hierarchyWidthPx, inspectorWidthPx, bottomHeightPx};
}

export function resizedPanel(sizes: PanelSizes, key: PanelSizeKey, startPx: number, dragDeltaPx: number, area: AvailableArea): PanelSizes {
    const growsAgainstPointer = key !== "hierarchyWidthPx";
    const wanted = startPx + (growsAgainstPointer ? -dragDeltaPx : dragDeltaPx);
    return clampPanelSizes({...sizes, [key]: wanted}, area);
}

function isPanelSize(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function parsePanelSizes(text: string | null): PanelSizes {
    if (text === null) return DEFAULT_PANEL_SIZES;
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return DEFAULT_PANEL_SIZES;
    }
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_PANEL_SIZES;
    const record = parsed as Record<string, unknown>;
    const sizes: Record<PanelSizeKey, number> = {...DEFAULT_PANEL_SIZES};
    for (const key of PANEL_SIZE_KEYS) {
        const value = record[key];
        if (isPanelSize(value)) sizes[key] = value;
    }
    return sizes;
}

export function panelSizesText(sizes: PanelSizes): string {
    return JSON.stringify(sizes);
}
