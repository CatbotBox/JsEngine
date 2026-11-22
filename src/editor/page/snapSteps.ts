export type SnapKind = "move2d" | "move3d" | "rotateDegrees" | "scale";

export type SnapSteps = Readonly<Record<SnapKind, number>>;

export interface SnapStepChoice {
    readonly kind: SnapKind;
    readonly step: number;
}

export const SNAP_STEPS_STORAGE_KEY = "jsengine.editor.snapSteps";
export const SNAP_ENABLED_STORAGE_KEY = "jsengine.editor.snapEnabled";
export const DEFAULT_SNAP_ENABLED = false;
export const SNAP_KINDS: readonly SnapKind[] = ["move2d", "move3d", "rotateDegrees", "scale"];
export const DEFAULT_SNAP_STEPS: SnapSteps = {move2d: 1, move3d: 0.25, rotateDegrees: 15, scale: 0.1};
export const SNAP_STEP_PRESETS: Readonly<Record<SnapKind, readonly number[]>> = {
    move2d: [0.5, 1, 2, 4, 8],
    move3d: [0.1, 0.25, 0.5, 1, 2],
    rotateDegrees: [5, 10, 15, 30, 45, 90],
    scale: [0.05, 0.1, 0.25, 0.5, 1],
};
export const SNAP_KIND_LABELS: Readonly<Record<SnapKind, string>> = {move2d: "Move (2D)", move3d: "Move (3D)", rotateDegrees: "Rotate", scale: "Scale"};

const SINGLE_UNIT = 1;
const DEGREE_SIGN = "°";

function isSnapStep(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function snapStepText(choice: SnapStepChoice): string {
    switch (choice.kind) {
        case "move2d":
        case "move3d":
            return `${choice.step} ${choice.step === SINGLE_UNIT ? "unit" : "units"}`;
        case "rotateDegrees":
            return `${choice.step}${DEGREE_SIGN}`;
        case "scale":
            return `${choice.step}`;
    }
}

export function snapStepChoices(): SnapStepChoice[] {
    return SNAP_KINDS.flatMap(kind => SNAP_STEP_PRESETS[kind].map(step => ({kind, step})));
}

export function withSnapStep(steps: SnapSteps, choice: SnapStepChoice): SnapSteps {
    return {...steps, [choice.kind]: choice.step};
}

export function parseSnapSteps(text: string | null): SnapSteps {
    if (text === null) return DEFAULT_SNAP_STEPS;
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return DEFAULT_SNAP_STEPS;
    }
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_SNAP_STEPS;
    const record = parsed as Record<string, unknown>;
    const steps: Record<SnapKind, number> = {...DEFAULT_SNAP_STEPS};
    for (const kind of SNAP_KINDS) {
        const value = record[kind];
        if (isSnapStep(value)) steps[kind] = value;
    }
    return steps;
}

export function parseSnapEnabled(text: string | null): boolean {
    return text === null ? DEFAULT_SNAP_ENABLED : text === String(true);
}

export function snapsThisDrag(snapEnabled: boolean, flipHeld: boolean): boolean {
    return snapEnabled !== flipHeld;
}

export function snapStepsText(steps: SnapSteps): string {
    return JSON.stringify(steps);
}
