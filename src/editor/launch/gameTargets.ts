import {isRenderBackendKind} from "../../engine/rendering/renderBackend";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import {chooseRenderBackend} from "../../hosts/web/renderBackendBootstrap";
import {GAME_TARGETS, sameGameTarget, SIMULATED_TARGETS} from "../project/editorSettings";
import type {GameTarget, SimulatedTarget} from "../project/editorSettings";
import type {MenuItem} from "../page/popupMenu";

export const RENDER_BACKEND_LABELS: Readonly<Record<RenderBackendKind, string>> = {
    cells: "Cells",
    pixels: "Pixels",
    gpu: "WebGPU",
};

export const SIMULATED_TARGET_LABELS: Readonly<Record<SimulatedTarget, string>> = {
    terminal: "Terminal",
    web: "Web",
    window: "Window",
};

export const PREFERRED_GAME_TARGET: GameTarget = {target: "web", backend: "gpu"};
export const BACKEND_OVERRIDE_TARGET: SimulatedTarget = "web";

const BACKEND_QUERY_PARAMETER = "backend";
const GPU_BACKEND: RenderBackendKind = "gpu";
const GPU_FALLBACK_BACKEND: RenderBackendKind = "pixels";
const GPU_SCRIPT_AVAILABLE = true;
const SINGLE_BACKEND = 1;

export interface WebGpuAvailability {
    readonly usable: boolean;
    readonly unusableReason: string;
}

export interface GameTargetChoice {
    readonly gameTarget: GameTarget;
    readonly fallbackReason?: string;
}

export interface GameTargetMenuOptions {
    readonly current: GameTarget;
    readonly webGpu: WebGpuAvailability;
    readonly switchUnavailableReason?: string;
    readonly choose: (gameTarget: GameTarget) => void;
}

export function webGpuAvailability(usable: boolean): WebGpuAvailability {
    const fallback = chooseRenderBackend(GPU_BACKEND, {gpuScript: GPU_SCRIPT_AVAILABLE, webGpuUsable: false});
    return {usable, unusableReason: fallback.fallbackReason ?? ""};
}

export function backendsOf(target: SimulatedTarget): RenderBackendKind[] {
    return GAME_TARGETS.filter(known => known.target === target).map(known => known.backend);
}

export function gameTargetLabelText(gameTarget: GameTarget): string {
    const target = SIMULATED_TARGET_LABELS[gameTarget.target];
    if (backendsOf(gameTarget.target).length === SINGLE_BACKEND) return `Target: ${target}`;
    return `Target: ${target} (${RENDER_BACKEND_LABELS[gameTarget.backend]})`;
}

export function backendOverrideFromQuery(search: string): RenderBackendKind | undefined {
    const value = new URLSearchParams(search).get(BACKEND_QUERY_PARAMETER)?.trim();
    return isRenderBackendKind(value) ? value : undefined;
}

export function gpuFallbackNotice(gameTarget: GameTarget, reason: string): string {
    return `The ${SIMULATED_TARGET_LABELS[gameTarget.target]} target with ${RENDER_BACKEND_LABELS[GPU_BACKEND]} is unavailable here: ${reason}; `
        + `the editor uses ${RENDER_BACKEND_LABELS[GPU_FALLBACK_BACKEND]} instead`;
}

export function chooseGameTarget(remembered: GameTarget | undefined, search: string, webGpu: WebGpuAvailability): GameTargetChoice {
    const override = backendOverrideFromQuery(search);
    const requested = override === undefined ? remembered : {target: BACKEND_OVERRIDE_TARGET, backend: override};
    const wanted = requested ?? PREFERRED_GAME_TARGET;
    if (wanted.backend !== GPU_BACKEND || webGpu.usable) return {gameTarget: wanted};
    const gameTarget: GameTarget = {target: wanted.target, backend: GPU_FALLBACK_BACKEND};
    return requested === undefined ? {gameTarget} : {gameTarget, fallbackReason: webGpu.unusableReason};
}

function unavailableReason(gameTarget: GameTarget, options: GameTargetMenuOptions): string | undefined {
    if (sameGameTarget(gameTarget, options.current)) return undefined;
    if (options.switchUnavailableReason !== undefined) return options.switchUnavailableReason;
    return gameTarget.backend === GPU_BACKEND && !options.webGpu.usable ? options.webGpu.unusableReason : undefined;
}

function gameTargetAction(gameTarget: GameTarget, label: string, options: GameTargetMenuOptions): MenuItem {
    const reason = unavailableReason(gameTarget, options);
    return {
        label,
        checked: sameGameTarget(gameTarget, options.current),
        disabled: reason !== undefined,
        ...(reason === undefined ? {} : {title: reason}),
        run: () => options.choose(gameTarget),
    };
}

export function gameTargetMenuItems(options: GameTargetMenuOptions): MenuItem[] {
    return SIMULATED_TARGETS.map(target => {
        const label = SIMULATED_TARGET_LABELS[target];
        const gameTargets = backendsOf(target).map((backend): GameTarget => ({target, backend}));
        if (gameTargets.length === SINGLE_BACKEND) return gameTargetAction(gameTargets[0], label, options);
        return {
            label,
            checked: options.current.target === target,
            items: gameTargets.map(gameTarget => gameTargetAction(gameTarget, RENDER_BACKEND_LABELS[gameTarget.backend], options)),
        };
    });
}
