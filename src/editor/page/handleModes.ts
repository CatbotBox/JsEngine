export type HandlePosition = "pivot" | "center";

export type HandleRotation = "local" | "global";

export interface HandleModes {
    readonly position: HandlePosition;
    readonly rotation: HandleRotation;
}

export const HANDLE_MODES_STORAGE_KEY = "jsengine.editor.handleModes";
export const DEFAULT_HANDLE_MODES: HandleModes = {position: "center", rotation: "global"};
export const HANDLE_POSITION_LABELS: Readonly<Record<HandlePosition, string>> = {pivot: "Pivot", center: "Center"};
export const HANDLE_ROTATION_LABELS: Readonly<Record<HandleRotation, string>> = {local: "Local", global: "Global"};

const HANDLE_POSITIONS: readonly HandlePosition[] = ["pivot", "center"];
const HANDLE_ROTATIONS: readonly HandleRotation[] = ["local", "global"];

export function withHandlePositionToggled(modes: HandleModes): HandleModes {
    return {...modes, position: modes.position === "pivot" ? "center" : "pivot"};
}

export function withHandleRotationToggled(modes: HandleModes): HandleModes {
    return {...modes, rotation: modes.rotation === "local" ? "global" : "local"};
}

export function parseHandleModes(text: string | null): HandleModes {
    if (text === null) return DEFAULT_HANDLE_MODES;
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return DEFAULT_HANDLE_MODES;
    }
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_HANDLE_MODES;
    const record = parsed as Record<string, unknown>;
    return {
        position: HANDLE_POSITIONS.find(position => position === record.position) ?? DEFAULT_HANDLE_MODES.position,
        rotation: HANDLE_ROTATIONS.find(rotation => rotation === record.rotation) ?? DEFAULT_HANDLE_MODES.rotation,
    };
}

export function handleModesText(modes: HandleModes): string {
    return JSON.stringify(modes);
}
