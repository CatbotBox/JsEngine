import {PLATFORM_FEATURE_CONSTANTS, PLATFORM_FEATURES} from "../engine/platform/platform";
import type {PlatformFeature} from "../engine/platform/platform";
import {RENDER_BACKEND_KINDS} from "../engine/rendering/renderBackend";
import type {RenderBackendKind} from "../engine/rendering/renderBackend";
import {usageError} from "./cliArguments";
import type {OptionSpec} from "./cliArguments";

export type Target = "web" | "window" | "terminal" | "editor";
export type RunTarget = Exclude<Target, "editor">;
export type HostTarget = "web" | "window";

export const DEFAULT_TARGET: Target = "web";
export const RUN_TARGETS: readonly RunTarget[] = ["web", "window", "terminal"];
export const BUILD_TARGETS: readonly Target[] = ["web", "window", "terminal", "editor"];
export const HOST_TARGETS: readonly HostTarget[] = ["web", "window"];

export const DEFAULT_SIMULATED_TARGET: RunTarget = "web";

export const BACKEND_OPTION: OptionSpec = {kind: "value", values: RENDER_BACKEND_KINDS};
export const PROJECT_OPTION: OptionSpec = {kind: "value"};
export const SIMULATE_OPTION: OptionSpec = {kind: "value", values: RUN_TARGETS};

export interface EditorSimulation {
    readonly target: RunTarget;
    readonly backend: RenderBackendKind;
}

interface TargetBackends {
    readonly backends: readonly RenderBackendKind[];
    readonly defaultBackend: RenderBackendKind;
    readonly limit: string;
}

const TARGET_BACKENDS: Readonly<Record<Target, TargetBackends>> = {
    web: {backends: RENDER_BACKEND_KINDS, defaultBackend: "pixels", limit: "the web target renders cells, pixels or gpu"},
    window: {backends: RENDER_BACKEND_KINDS, defaultBackend: "pixels", limit: "the window target renders cells, pixels or gpu"},
    terminal: {backends: ["cells"], defaultBackend: "cells", limit: "the terminal renders cells only"},
    editor: {backends: RENDER_BACKEND_KINDS, defaultBackend: "gpu", limit: "the editor renders cells, pixels or gpu"},
};

const BROWSER_FEATURES: readonly PlatformFeature[] = ["dom", "workers", "sharedMemory", "gpu", "audio"];

export const TARGET_FEATURES: Readonly<Record<RunTarget, readonly PlatformFeature[]>> = {
    web: BROWSER_FEATURES,
    window: BROWSER_FEATURES,
    terminal: ["node", "workers", "sharedMemory"],
};

export function featureConstantValues(target: RunTarget): ReadonlyMap<string, boolean> {
    const provided = TARGET_FEATURES[target];
    return new Map(PLATFORM_FEATURES.map(feature => [PLATFORM_FEATURE_CONSTANTS[feature], provided.includes(feature)]));
}

export function featureDefines(target: RunTarget): Record<string, string> {
    return Object.fromEntries([...featureConstantValues(target)].map(([name, value]) => [name, JSON.stringify(value)]));
}

export function targetOf(value: string | undefined, allowed: readonly Target[]): Target {
    const target = (value ?? DEFAULT_TARGET) as Target;
    if (!allowed.includes(target)) throw usageError(`--target ${target} is not available here; use one of ${allowed.join(", ")}`);
    return target;
}

export function simulatedTargetOf(value: string | undefined): RunTarget {
    const requested = value ?? DEFAULT_SIMULATED_TARGET;
    const target = RUN_TARGETS.find(each => each === requested);
    if (target === undefined) throw usageError(`--simulate ${requested} is not a target; use one of ${RUN_TARGETS.join(", ")}`);
    return target;
}

export function editorSimulationOf(simulate: string | undefined, backend: string | undefined): EditorSimulation {
    const target = simulatedTargetOf(simulate);
    return {target, backend: backendFor(target, backend)};
}

export function backendFor(target: Target, requested: string | undefined): RenderBackendKind {
    const rule = TARGET_BACKENDS[target];
    if (requested === undefined) return rule.defaultBackend;
    const backend = rule.backends.find(kind => kind === requested);
    if (backend === undefined) throw usageError(`${rule.limit}; drop --backend ${requested} or use --backend ${rule.defaultBackend}`);
    return backend;
}
