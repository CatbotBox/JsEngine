import {isRenderBackendKind} from "../../engine/rendering/renderBackend";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";

export type SimulatedTarget = "terminal" | "web" | "window";

export interface GameTarget {
    readonly target: SimulatedTarget;
    readonly backend: RenderBackendKind;
}

export interface EditorSettings {
    readonly gameTarget?: GameTarget;
}

export const EDITOR_SETTINGS_FILE = ".jsengine/editor.json";

export const SIMULATED_TARGETS: readonly SimulatedTarget[] = ["terminal", "web", "window"];

export const GAME_TARGETS: readonly GameTarget[] = [
    {target: "terminal", backend: "cells"},
    {target: "web", backend: "cells"},
    {target: "web", backend: "pixels"},
    {target: "web", backend: "gpu"},
    {target: "window", backend: "pixels"},
    {target: "window", backend: "gpu"},
];

export const DEFAULT_GAME_TARGET: GameTarget = {target: "web", backend: "pixels"};

function isRecord(value: unknown): value is {readonly [key: string]: unknown} {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sameGameTarget(a: GameTarget, b: GameTarget): boolean {
    return a.target === b.target && a.backend === b.backend;
}

export function gameTargetKey(gameTarget: GameTarget): string {
    return `${gameTarget.target}-${gameTarget.backend}`;
}

export function gameTargetText(gameTarget: GameTarget): string {
    return `${gameTarget.target} ${gameTarget.backend}`;
}

export function isGameTarget(value: unknown): value is GameTarget {
    if (!isRecord(value)) return false;
    const backend = value.backend;
    if (typeof backend !== "string" || !isRenderBackendKind(backend)) return false;
    return GAME_TARGETS.some(known => known.target === value.target && known.backend === backend);
}

export function gameTargetProblem(value: unknown): string {
    return `"gameTarget" must be one of ${GAME_TARGETS.map(gameTargetText).join(", ")} as {"target", "backend"}; got ${JSON.stringify(value)}`;
}

export function editorSettingsOf(value: unknown): EditorSettings {
    if (!isRecord(value)) return {};
    const gameTarget = value.gameTarget;
    return isGameTarget(gameTarget) ? {gameTarget: {target: gameTarget.target, backend: gameTarget.backend}} : {};
}

export function parseEditorSettings(text: string | undefined): EditorSettings {
    if (text === undefined) return {};
    try {
        return editorSettingsOf(JSON.parse(text));
    } catch {
        return {};
    }
}
