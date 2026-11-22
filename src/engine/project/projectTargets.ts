import {PIXEL_SCALE_LIMITS} from "../rendering/pixelScale";
import {isRenderBackendKind, RENDER_BACKEND_KINDS} from "../rendering/renderBackend";
import type {RenderBackendKind} from "../rendering/renderBackend";

export type ProjectTarget = "web" | "window" | "terminal";

export interface ProjectTargetSettings {
    readonly backend?: RenderBackendKind;
    readonly pixelScale?: number;
}

export type ProjectTargets = Readonly<Partial<Record<ProjectTarget, ProjectTargetSettings>>>;

export interface TargetRenderDefaults {
    readonly backend: RenderBackendKind;
    readonly pixelScale?: number;
}

export const TARGETS_MANIFEST_KEY = "targets";
export const TARGET_BACKEND_KEY = "backend";
export const TARGET_PIXEL_SCALE_KEY = "pixelScale";
export const PROJECT_TARGETS: readonly ProjectTarget[] = ["web", "window", "terminal"];
export {PIXEL_SCALE_LIMITS};

export const TARGET_RENDER_BACKENDS: Readonly<Record<ProjectTarget, readonly RenderBackendKind[]>> = {
    web: RENDER_BACKEND_KINDS,
    window: RENDER_BACKEND_KINDS,
    terminal: ["cells"],
};

export const TARGET_DEFAULT_BACKENDS: Readonly<Record<ProjectTarget, RenderBackendKind>> = {
    web: "pixels",
    window: "pixels",
    terminal: "cells",
};

const CELLS_BACKEND: RenderBackendKind = "cells";
const TARGET_SETTING_KEYS: readonly string[] = [TARGET_BACKEND_KEY, TARGET_PIXEL_SCALE_KEY];
const NO_SETTINGS: ProjectTargetSettings = {};

type JsonFields = {readonly [key: string]: unknown};

function isJsonObject(value: unknown): value is JsonFields {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listed(names: readonly string[]): string {
    return names.join(", ");
}

export function isProjectTarget(value: unknown): value is ProjectTarget {
    return PROJECT_TARGETS.some(target => target === value);
}

export function targetDrawsPixels(target: ProjectTarget): boolean {
    return TARGET_RENDER_BACKENDS[target].some(backend => backend !== CELLS_BACKEND);
}

export function isPixelScale(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= PIXEL_SCALE_LIMITS.min && value <= PIXEL_SCALE_LIMITS.max;
}

export function declaredTargets(targets: ProjectTargets | undefined): ProjectTarget[] {
    return PROJECT_TARGETS.filter(target => targets === undefined || targets[target] !== undefined);
}

export function targetSettingsOf(targets: ProjectTargets | undefined, target: ProjectTarget): ProjectTargetSettings {
    return targets?.[target] ?? NO_SETTINGS;
}

export function targetRenderDefaults(targets: ProjectTargets | undefined, target: ProjectTarget): TargetRenderDefaults {
    const settings = targetSettingsOf(targets, target);
    const backend = settings.backend ?? TARGET_DEFAULT_BACKENDS[target];
    return settings.pixelScale === undefined ? {backend} : {backend, pixelScale: settings.pixelScale};
}

function backendProblem(target: ProjectTarget, value: unknown): string | undefined {
    const allowed = TARGET_RENDER_BACKENDS[target];
    if (typeof value === "string" && isRenderBackendKind(value) && allowed.includes(value)) return undefined;
    return `"${TARGETS_MANIFEST_KEY}.${target}.${TARGET_BACKEND_KEY}" must be one of ${listed(allowed)} (the backends the ${target} target renders with), got ${JSON.stringify(value)}`;
}

function pixelScaleProblem(target: ProjectTarget, value: unknown): string | undefined {
    const label = `"${TARGETS_MANIFEST_KEY}.${target}.${TARGET_PIXEL_SCALE_KEY}"`;
    if (!targetDrawsPixels(target)) return `${label}: the ${target} target draws cells, so it has no pixel scale; remove it`;
    if (isPixelScale(value)) return undefined;
    return `${label} must be a whole number of device pixels per framebuffer pixel from ${PIXEL_SCALE_LIMITS.min} to ${PIXEL_SCALE_LIMITS.max}, got ${JSON.stringify(value)}`;
}

function targetSettingsProblems(target: ProjectTarget, value: unknown): {readonly settings?: ProjectTargetSettings, readonly problems: string[]} {
    const label = `"${TARGETS_MANIFEST_KEY}.${target}"`;
    if (!isJsonObject(value)) return {problems: [`${label} must be an object {"${TARGET_BACKEND_KEY}"?, "${TARGET_PIXEL_SCALE_KEY}"?} ({} keeps the defaults), got ${JSON.stringify(value)}`]};
    const problems = Object.keys(value)
        .filter(key => !TARGET_SETTING_KEYS.includes(key))
        .map(key => `"${TARGETS_MANIFEST_KEY}.${target}.${key}" is not a target setting; the settings are ${listed(TARGET_SETTING_KEYS)}`);
    const backend = value[TARGET_BACKEND_KEY];
    const pixelScale = value[TARGET_PIXEL_SCALE_KEY];
    const backendIssue = backend === undefined ? undefined : backendProblem(target, backend);
    const pixelScaleIssue = pixelScale === undefined ? undefined : pixelScaleProblem(target, pixelScale);
    if (backendIssue !== undefined) problems.push(backendIssue);
    if (pixelScaleIssue !== undefined) problems.push(pixelScaleIssue);
    if (problems.length > 0) return {problems};
    return {
        settings: {
            ...(backend === undefined ? {} : {backend: backend as RenderBackendKind}),
            ...(pixelScale === undefined ? {} : {pixelScale: pixelScale as number}),
        },
        problems,
    };
}

export function targetsProblems(value: unknown): {readonly targets?: ProjectTargets, readonly problems: string[]} {
    if (value === undefined) return {problems: []};
    const shape = `an object keyed by target (${listed(PROJECT_TARGETS)}), each holding that target's settings`;
    if (!isJsonObject(value)) return {problems: [`"${TARGETS_MANIFEST_KEY}" must be ${shape} when present, got ${JSON.stringify(value)}`]};
    const keys = Object.keys(value);
    if (keys.length === 0) return {problems: [`"${TARGETS_MANIFEST_KEY}" lists no target; name at least one of ${listed(PROJECT_TARGETS)}, or remove it to build for every target`]};
    const problems = keys
        .filter(key => !isProjectTarget(key))
        .map(key => `"${TARGETS_MANIFEST_KEY}.${key}" is not a target; the targets are ${listed(PROJECT_TARGETS)}`);
    const targets: Partial<Record<ProjectTarget, ProjectTargetSettings>> = {};
    for (const target of PROJECT_TARGETS) {
        if (!(target in value)) continue;
        const checked = targetSettingsProblems(target, value[target]);
        problems.push(...checked.problems);
        if (checked.settings !== undefined) targets[target] = checked.settings;
    }
    return problems.length > 0 ? {problems} : {targets, problems};
}
