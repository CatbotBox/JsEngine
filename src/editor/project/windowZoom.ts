export const ZOOM_FACTORS: readonly number[] = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
export const DEFAULT_ZOOM_FACTOR = 1;
export const WINDOW_ZOOM_PATH = "/__window/zoom";
const ZOOM_FACTOR_TOLERANCE = 0.001;

export type ZoomCommand = "in" | "out" | "reset";

export interface ZoomKeyInput {
    readonly type: string;
    readonly key: string;
    readonly control: boolean;
    readonly meta: boolean;
    readonly alt: boolean;
}

const ZOOM_COMMAND_BY_KEY: Readonly<Record<string, ZoomCommand>> = {
    "=": "in",
    "+": "in",
    "-": "out",
    "_": "out",
    "0": "reset",
};

export function zoomCommandOf(input: ZoomKeyInput): ZoomCommand | undefined {
    const isCommandChord = input.type === "keyDown" && (input.control || input.meta) && !input.alt;
    return isCommandChord ? ZOOM_COMMAND_BY_KEY[input.key] : undefined;
}

export function nextZoomFactor(current: number, command: ZoomCommand): number {
    if (command === "reset") return DEFAULT_ZOOM_FACTOR;
    if (command === "in") return ZOOM_FACTORS.find(factor => factor > current + ZOOM_FACTOR_TOLERANCE) ?? ZOOM_FACTORS[ZOOM_FACTORS.length - 1];
    return [...ZOOM_FACTORS].reverse().find(factor => factor < current - ZOOM_FACTOR_TOLERANCE) ?? ZOOM_FACTORS[0];
}

export function zoomFactorOfText(settingsText: string): number | undefined {
    try {
        const parsed: unknown = JSON.parse(settingsText);
        const zoomFactor = typeof parsed === "object" && parsed !== null ? (parsed as {zoomFactor?: unknown}).zoomFactor : undefined;
        const isInRange = typeof zoomFactor === "number" && zoomFactor >= ZOOM_FACTORS[0] && zoomFactor <= ZOOM_FACTORS[ZOOM_FACTORS.length - 1];
        return isInRange ? zoomFactor : undefined;
    } catch {
        return undefined;
    }
}

export function storedZoomFactor(settingsText: string | undefined): number {
    return settingsText === undefined ? DEFAULT_ZOOM_FACTOR : zoomFactorOfText(settingsText) ?? DEFAULT_ZOOM_FACTOR;
}

export function nearestZoomFactor(zoomFactor: number): number {
    return ZOOM_FACTORS.reduce((nearest, factor) => Math.abs(factor - zoomFactor) < Math.abs(nearest - zoomFactor) ? factor : nearest, DEFAULT_ZOOM_FACTOR);
}

export function zoomSettingsText(zoomFactor: number): string {
    return JSON.stringify({zoomFactor});
}
