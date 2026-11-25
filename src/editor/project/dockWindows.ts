export interface ScreenBounds {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export const DOCK_LAYOUT_STORAGE_KEY = "jsengine.editor.dockLayout";
export const DOCK_WINDOW_URL = "about:blank";
export const DOCK_WINDOW_BACKGROUND = "#05070b";

const DOCK_WINDOW_NAME_PREFIX = "jsengine-dock-";
const FEATURE_SEPARATOR = ",";
const FEATURE_ASSIGNMENT = "=";
const FEATURE_NAMES: Readonly<Record<keyof ScreenBounds, string>> = {x: "left", y: "top", width: "width", height: "height"};
const BOUNDS_KEYS: readonly (keyof ScreenBounds)[] = ["x", "y", "width", "height"];

export function dockWindowName(id: string): string {
    return `${DOCK_WINDOW_NAME_PREFIX}${id}`;
}

export function isDockWindowName(name: string): boolean {
    return name.startsWith(DOCK_WINDOW_NAME_PREFIX) && name.length > DOCK_WINDOW_NAME_PREFIX.length;
}

export function isScreenBounds(value: unknown): value is ScreenBounds {
    if (typeof value !== "object" || value === null) return false;
    const {x, y, width, height} = value as Record<string, unknown>;
    const finite = [x, y, width, height].every(part => typeof part === "number" && Number.isFinite(part));
    return finite && (width as number) > 0 && (height as number) > 0;
}

export function dockWindowFeatures(bounds: ScreenBounds): string {
    return BOUNDS_KEYS.map(key => `${FEATURE_NAMES[key]}${FEATURE_ASSIGNMENT}${Math.round(bounds[key])}`).join(FEATURE_SEPARATOR);
}

export function boundsOfDockWindowFeatures(features: string): ScreenBounds | undefined {
    const values = new Map<string, number>();
    for (const part of features.split(FEATURE_SEPARATOR)) {
        const [name, value] = part.split(FEATURE_ASSIGNMENT).map(text => text.trim());
        if (name === undefined || value === undefined || value.length === 0) continue;
        values.set(name.toLowerCase(), Number(value));
    }
    const bounds = Object.fromEntries(BOUNDS_KEYS.map(key => [key, values.get(FEATURE_NAMES[key])]));
    return isScreenBounds(bounds) ? bounds : undefined;
}

export function clampedScreenBounds(bounds: ScreenBounds, area: ScreenBounds): ScreenBounds {
    const width = Math.min(bounds.width, area.width);
    const height = Math.min(bounds.height, area.height);
    return {
        x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
        y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
        width,
        height,
    };
}
