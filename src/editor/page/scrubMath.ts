export type ScrubKind = "number" | "integer" | "degrees";

export interface StepModifiers {
    readonly faster: boolean;
    readonly slower: boolean;
}

export type StepDirection = 1 | -1;

export const SCRUB_UNITS_PER_PIXEL: Readonly<Record<ScrubKind, number>> = {number: 0.05, integer: 0.2, degrees: 0.5};
export const STEP_UNITS: Readonly<Record<ScrubKind, number>> = {number: 0.1, integer: 1, degrees: 1};
export const FASTER_MULTIPLIER = 10;
export const SLOWER_MULTIPLIER = 0.1;
export const NO_MODIFIERS: StepModifiers = {faster: false, slower: false};

const SMALLEST_INTEGER_STEP = 1;
const MAX_DECIMALS = 12;
const STEP_UP: StepDirection = 1;
const STEP_DOWN: StepDirection = -1;

export function modifierMultiplier(modifiers: StepModifiers): number {
    return (modifiers.faster ? FASTER_MULTIPLIER : 1) * (modifiers.slower ? SLOWER_MULTIPLIER : 1);
}

export function decimalsOfIncrement(increment: number): number {
    if (!(increment > 0) || !Number.isFinite(increment)) return 0;
    return Math.min(MAX_DECIMALS, Math.max(0, Math.ceil(-Math.log10(increment) - 1e-9)));
}

export function roundToIncrement(value: number, increment: number): number {
    return Number(value.toFixed(decimalsOfIncrement(increment))) + 0;
}

function finiteOrZero(value: number): number {
    return Number.isFinite(value) ? value : 0;
}

function isUsableStep(step: number | undefined): step is number {
    return step !== undefined && step > 0 && Number.isFinite(step);
}

export function scrubUnitsPerPixelForStep(step: number | undefined, kind: ScrubKind): number {
    return isUsableStep(step) ? SCRUB_UNITS_PER_PIXEL[kind] / STEP_UNITS[kind] * step : SCRUB_UNITS_PER_PIXEL[kind];
}

export function baseStepFor(step: number | undefined, kind: ScrubKind): number {
    return isUsableStep(step) ? step : STEP_UNITS[kind];
}

export function scrubbedValue(start: number, pixelsMoved: number, modifiers: StepModifiers, kind: ScrubKind, unitsPerPixel: number = SCRUB_UNITS_PER_PIXEL[kind]): number {
    const base = finiteOrZero(start);
    if (pixelsMoved === 0) return base;
    const increment = unitsPerPixel * modifierMultiplier(modifiers);
    const moved = base + pixelsMoved * increment;
    return kind === "integer" ? Math.round(moved) + 0 : roundToIncrement(moved, increment);
}

export function stepIncrement(modifiers: StepModifiers, kind: ScrubKind, baseStep: number = STEP_UNITS[kind]): number {
    const increment = baseStep * modifierMultiplier(modifiers);
    return kind === "integer" ? Math.max(SMALLEST_INTEGER_STEP, Math.round(increment)) : increment;
}

export function steppedValue(current: number, direction: StepDirection, modifiers: StepModifiers, kind: ScrubKind, baseStep: number = STEP_UNITS[kind]): number {
    const increment = stepIncrement(modifiers, kind, baseStep);
    const stepped = finiteOrZero(current) + direction * increment;
    return kind === "integer" ? Math.round(stepped) + 0 : roundToIncrement(stepped, increment);
}

export function wheelStepDirection(deltaY: number): StepDirection | undefined {
    if (deltaY < 0) return STEP_UP;
    if (deltaY > 0) return STEP_DOWN;
    return undefined;
}

export function arrowStepDirection(key: string): StepDirection | undefined {
    if (key === "ArrowUp") return STEP_UP;
    if (key === "ArrowDown") return STEP_DOWN;
    return undefined;
}
