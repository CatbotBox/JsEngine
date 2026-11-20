import {RENDER_BACKEND_KINDS} from "../engine/rendering/renderBackend";
import type {RenderBackendKind} from "../engine/rendering/renderBackend";
import {usageError} from "./cliArguments";
import type {OptionSpec} from "./cliArguments";

export type Target = "web" | "window" | "terminal" | "editor";
export type HostTarget = "web" | "window";

export const DEFAULT_TARGET: Target = "web";
export const RUN_TARGETS: readonly Target[] = ["web", "window", "terminal"];
export const BUILD_TARGETS: readonly Target[] = ["web", "window", "terminal", "editor"];
export const HOST_TARGETS: readonly HostTarget[] = ["web", "window"];

export const BACKEND_OPTION: OptionSpec = {kind: "value", values: RENDER_BACKEND_KINDS};
export const PROJECT_OPTION: OptionSpec = {kind: "value"};

interface TargetBackends {
    readonly backends: readonly RenderBackendKind[];
    readonly defaultBackend: RenderBackendKind;
    readonly limit: string;
}

const TARGET_BACKENDS: Readonly<Record<Target, TargetBackends>> = {
    web: {backends: RENDER_BACKEND_KINDS, defaultBackend: "pixels", limit: "the web target renders cells, pixels or gpu"},
    window: {backends: RENDER_BACKEND_KINDS, defaultBackend: "pixels", limit: "the window target renders cells, pixels or gpu"},
    terminal: {backends: ["cells"], defaultBackend: "cells", limit: "the terminal renders cells only"},
    editor: {backends: ["pixels", "gpu"], defaultBackend: "gpu", limit: "the editor renders pixels or gpu"},
};

export function targetOf(value: string | undefined, allowed: readonly Target[]): Target {
    const target = (value ?? DEFAULT_TARGET) as Target;
    if (!allowed.includes(target)) throw usageError(`--target ${target} is not available here; use one of ${allowed.join(", ")}`);
    return target;
}

export function backendFor(target: Target, requested: string | undefined): RenderBackendKind {
    const rule = TARGET_BACKENDS[target];
    if (requested === undefined) return rule.defaultBackend;
    const backend = rule.backends.find(kind => kind === requested);
    if (backend === undefined) throw usageError(`${rule.limit}; drop --backend ${requested} or use --backend ${rule.defaultBackend}`);
    return backend;
}
