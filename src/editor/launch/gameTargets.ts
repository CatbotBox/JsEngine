import {declaredTargets, targetSettingsOf} from "../../engine/project/projectTargets";
import type {ProjectTargets} from "../../engine/project/projectTargets";
import {isRenderBackendKind} from "../../engine/rendering/renderBackend";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import {chooseRenderBackend} from "../../hosts/web/renderBackendBootstrap";
import {GAME_TARGETS, sameGameTarget, SIMULATED_TARGETS} from "../project/editorSettings";
import type {GameTarget, SimulatedTarget} from "../project/editorSettings";
import {commandEntryFor, submenuEntry} from "../page/commandMenus";
import type {MenuEntry} from "../page/commandMenus";
import type {Command, CommandRegistry} from "../page/commandRegistry";

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
export const GAME_TARGET_COMMAND_ID = "game.target";
export const GAME_TARGET_CATEGORY = "Target";

const BACKEND_QUERY_PARAMETER = "backend";
const GPU_BACKEND: RenderBackendKind = "gpu";
const GPU_FALLBACK_BACKEND: RenderBackendKind = "pixels";
const GPU_SCRIPT_AVAILABLE = true;
const SINGLE_BACKEND = 1;
const SWITCH_TARGET_LABEL = "Switch Target";
const TARGET_LABEL_PREFIX = "Target: ";
const GAME_TARGET_SUBMENU_PREFIX = "gameTarget.";

export interface WebGpuAvailability {
    readonly usable: boolean;
    readonly unusableReason: string;
}

export interface GameTargetChoice {
    readonly gameTarget: GameTarget;
    readonly fallbackReason?: string;
}

export interface GameTargetCommand {
    readonly command: Command<GameTarget>;
    readonly menuEntries: readonly MenuEntry[];
}

export interface GameTargetCommandOptions {
    readonly current: () => GameTarget;
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

export function gameTargetName(gameTarget: GameTarget): string {
    const target = SIMULATED_TARGET_LABELS[gameTarget.target];
    if (backendsOf(gameTarget.target).length === SINGLE_BACKEND) return target;
    return `${target} (${RENDER_BACKEND_LABELS[gameTarget.backend]})`;
}

export function gameTargetLabelText(gameTarget: GameTarget): string {
    return TARGET_LABEL_PREFIX + gameTargetName(gameTarget);
}

export function backendOverrideFromQuery(search: string): RenderBackendKind | undefined {
    const value = new URLSearchParams(search).get(BACKEND_QUERY_PARAMETER)?.trim();
    return isRenderBackendKind(value) ? value : undefined;
}

export function addressKeepingBackendOverride(pathname: string, search: string): string {
    const override = backendOverrideFromQuery(search);
    return override === undefined ? pathname : `${pathname}?${new URLSearchParams({[BACKEND_QUERY_PARAMETER]: override})}`;
}

export function gpuFallbackNotice(gameTarget: GameTarget, reason: string): string {
    return `The ${SIMULATED_TARGET_LABELS[gameTarget.target]} target with ${RENDER_BACKEND_LABELS[GPU_BACKEND]} is unavailable here: ${reason}; `
        + `the editor uses ${RENDER_BACKEND_LABELS[GPU_FALLBACK_BACKEND]} instead`;
}

export function projectGameTarget(targets: ProjectTargets | undefined): GameTarget {
    const target = declaredTargets(targets)[0] ?? PREFERRED_GAME_TARGET.target;
    const backends = backendsOf(target);
    const configured = targetSettingsOf(targets, target).backend;
    if (configured !== undefined && backends.includes(configured)) return {target, backend: configured};
    return {target, backend: backends.includes(PREFERRED_GAME_TARGET.backend) ? PREFERRED_GAME_TARGET.backend : backends[0]};
}

export function chooseGameTarget(remembered: GameTarget | undefined, search: string, webGpu: WebGpuAvailability, preferred: GameTarget = PREFERRED_GAME_TARGET): GameTargetChoice {
    const override = backendOverrideFromQuery(search);
    const requested = override === undefined ? remembered : {target: BACKEND_OVERRIDE_TARGET, backend: override};
    const wanted = requested ?? preferred;
    if (wanted.backend !== GPU_BACKEND || webGpu.usable) return {gameTarget: wanted};
    const gameTarget: GameTarget = {target: wanted.target, backend: GPU_FALLBACK_BACKEND};
    return requested === undefined ? {gameTarget} : {gameTarget, fallbackReason: webGpu.unusableReason};
}

function unavailableReason(gameTarget: GameTarget, options: GameTargetCommandOptions): string | undefined {
    if (sameGameTarget(gameTarget, options.current())) return undefined;
    if (options.switchUnavailableReason !== undefined) return options.switchUnavailableReason;
    return gameTarget.backend === GPU_BACKEND && !options.webGpu.usable ? options.webGpu.unusableReason : undefined;
}

function gameTargetMenuEntries(command: Command<GameTarget>, current: () => GameTarget): MenuEntry[] {
    return SIMULATED_TARGETS.map(target => {
        const label = SIMULATED_TARGET_LABELS[target];
        const gameTargets = backendsOf(target).map((backend): GameTarget => ({target, backend}));
        if (gameTargets.length === SINGLE_BACKEND) return commandEntryFor(command, gameTargets[0], label);
        const entries = gameTargets.map(gameTarget => commandEntryFor(command, gameTarget, RENDER_BACKEND_LABELS[gameTarget.backend]));
        return submenuEntry(`${GAME_TARGET_SUBMENU_PREFIX}${target}`, label, entries, () => current().target === target);
    });
}

export function registerGameTargetCommand(registry: CommandRegistry, options: GameTargetCommandOptions): GameTargetCommand {
    const command = registry.addTargeted<GameTarget>({
        id: GAME_TARGET_COMMAND_ID,
        category: GAME_TARGET_CATEGORY,
        label: SWITCH_TARGET_LABEL,
        labelFor: gameTargetName,
        choices: () => GAME_TARGETS,
        checked: gameTarget => sameGameTarget(gameTarget, options.current()),
        disabledReason: gameTarget => unavailableReason(gameTarget, options),
        run: gameTarget => options.choose(gameTarget),
    });
    return {command, menuEntries: gameTargetMenuEntries(command, options.current)};
}
