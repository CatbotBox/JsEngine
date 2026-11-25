import {DEFAULT_ZOOM_FACTOR, nearestZoomFactor, storedZoomFactor, WINDOW_ZOOM_PATH, ZOOM_FACTORS, zoomFactorOfText, zoomSettingsText} from "../project/windowZoom";
import {readStorage, writeStorage} from "./dom";

export interface UiScaleResponse {
    readonly ok: boolean;

    text(): Promise<string>;
}

export type UiScaleFetch = (path: string, init?: {readonly method: string, readonly body: string}) => Promise<UiScaleResponse>;

export interface UiScale {
    readonly scalesWindow: boolean;
    readonly factor: number;

    set(factor: number): Promise<void>;
}

export interface UiScaleChoice {
    readonly factor: number;
    readonly label: string;
}

export const UI_SCALE_STORAGE_KEY = "jsengine.editor.uiScale";

const PERCENT = 100;
const PUT_METHOD = "PUT";
const PAGE_ZOOM_PROPERTY = "zoom";
const PAGE_ZOOM_VARIABLE = "--page-zoom";

export function uiScaleChoices(): UiScaleChoice[] {
    return ZOOM_FACTORS.map(factor => ({factor, label: `${Math.round(factor * PERCENT)}%`}));
}

async function zoomFactorOfResponse(response: UiScaleResponse): Promise<number | undefined> {
    return response.ok ? zoomFactorOfText(await response.text()) : undefined;
}

export async function windowUiScale(fetch: UiScaleFetch): Promise<UiScale | undefined> {
    let factor: number | undefined;
    try {
        factor = await zoomFactorOfResponse(await fetch(WINDOW_ZOOM_PATH));
    } catch {
        return undefined;
    }
    if (factor === undefined) return undefined;
    return {
        scalesWindow: true,
        factor: nearestZoomFactor(factor),
        set: async wanted => {
            const applied = await zoomFactorOfResponse(await fetch(WINDOW_ZOOM_PATH, {method: PUT_METHOD, body: zoomSettingsText(wanted)}));
            if (applied === undefined) throw new Error(`The desktop window refused the UI scale ${wanted}`);
        },
    };
}

export function storedPageUiScale(window: Window | null): number {
    const stored = readStorage(window, UI_SCALE_STORAGE_KEY);
    return stored === null ? DEFAULT_ZOOM_FACTOR : storedZoomFactor(stored);
}

export function appliedPageUiScale(root: HTMLElement): number {
    const factor = Number(root.style.getPropertyValue(PAGE_ZOOM_VARIABLE));
    return Number.isFinite(factor) && factor > 0 ? factor : DEFAULT_ZOOM_FACTOR;
}

export function applyPageUiScale(root: HTMLElement, factor: number): void {
    for (const property of [PAGE_ZOOM_PROPERTY, PAGE_ZOOM_VARIABLE]) {
        if (factor === DEFAULT_ZOOM_FACTOR) root.style.removeProperty(property);
        else root.style.setProperty(property, String(factor));
    }
}

export function pageUiScale(root: HTMLElement, window: Window | null): UiScale {
    return {
        scalesWindow: false,
        factor: storedPageUiScale(window),
        set: async factor => {
            applyPageUiScale(root, factor);
            writeStorage(window, UI_SCALE_STORAGE_KEY, zoomSettingsText(factor));
        },
    };
}
