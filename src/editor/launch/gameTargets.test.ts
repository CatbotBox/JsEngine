import {describe, expect, test} from "../../engine/testing/harness";
import type {GameTarget} from "../project/editorSettings";
import {menuItemsOf} from "../page/commandMenus";
import {CommandRegistry} from "../page/commandRegistry";
import {filterPaletteEntries, paletteEntries} from "../page/commandPalette";
import type {MenuAction, MenuItem, MenuSubmenu} from "../page/popupMenu";
import {
    backendOverrideFromQuery,
    chooseGameTarget,
    gameTargetLabelText,
    gameTargetName,
    PREFERRED_GAME_TARGET,
    projectGameTarget,
    registerGameTargetCommand,
    webGpuAvailability,
} from "./gameTargets";
import type {GameTargetCommandOptions} from "./gameTargets";

const TERMINAL: GameTarget = {target: "terminal", backend: "cells"};
const WEB_CELLS: GameTarget = {target: "web", backend: "cells"};
const WEB_PIXELS: GameTarget = {target: "web", backend: "pixels"};
const WEB_GPU: GameTarget = {target: "web", backend: "gpu"};
const WINDOW_PIXELS: GameTarget = {target: "window", backend: "pixels"};
const WINDOW_GPU: GameTarget = {target: "window", backend: "gpu"};
const USABLE = webGpuAvailability(true);
const UNUSABLE = webGpuAvailability(false);
const NO_QUERY = "";
const NO_SERVER = "needs the dev server";

function menu(options: Partial<GameTargetCommandOptions> = {}): {readonly items: MenuItem[], readonly chosen: GameTarget[], readonly registry: CommandRegistry} {
    const chosen: GameTarget[] = [];
    const registry = new CommandRegistry();
    const {menuEntries} = registerGameTargetCommand(registry, {current: () => WEB_PIXELS, webGpu: USABLE, choose: gameTarget => chosen.push(gameTarget), ...options});
    return {items: menuItemsOf(menuEntries), chosen, registry};
}

function named(items: readonly MenuItem[], label: string): MenuAction | MenuSubmenu {
    const found = items.find(item => typeof item !== "string" && item.label === label);
    if (found === undefined || typeof found === "string") throw new Error(`no menu item ${label}`);
    return found;
}

function action(items: readonly MenuItem[], ...path: readonly string[]): MenuAction {
    let current = named(items, path[0]);
    for (const label of path.slice(1)) {
        if (!("items" in current)) throw new Error(`${current.label} is not a submenu`);
        current = named(current.items, label);
    }
    if ("items" in current) throw new Error(`${current.label} is a submenu`);
    return current;
}

describe("game target choice", () => {
    test("with nothing remembered the editor prefers WebGPU on the web target and falls back to pixels quietly", () => {
        expect(chooseGameTarget(undefined, NO_QUERY, USABLE)).toEqual({gameTarget: PREFERRED_GAME_TARGET});
        expect(chooseGameTarget(undefined, NO_QUERY, UNUSABLE)).toEqual({gameTarget: WEB_PIXELS});
    });

    test("the remembered target wins; a remembered WebGPU target that is unusable keeps its target on pixels and says why", () => {
        expect(chooseGameTarget(TERMINAL, NO_QUERY, USABLE)).toEqual({gameTarget: TERMINAL});
        const fallback = chooseGameTarget(WINDOW_GPU, NO_QUERY, UNUSABLE);
        expect(fallback.gameTarget).toEqual(WINDOW_PIXELS);
        expect(fallback.fallbackReason).toBe(UNUSABLE.unusableReason);
        expect(UNUSABLE.unusableReason.includes("WebGPU")).toBe(true);
    });

    test("with nothing remembered a project's first target and its configured backend are preferred, keeping WebGPU where the target leaves it open", () => {
        expect(projectGameTarget(undefined)).toEqual(PREFERRED_GAME_TARGET);
        expect(projectGameTarget({web: {}, terminal: {}})).toEqual(WEB_GPU);
        expect(projectGameTarget({web: {backend: "cells"}})).toEqual(WEB_CELLS);
        expect(projectGameTarget({terminal: {}})).toEqual(TERMINAL);
        expect(projectGameTarget({window: {backend: "cells"}})).toEqual(WINDOW_GPU);
        expect(chooseGameTarget(undefined, NO_QUERY, USABLE, projectGameTarget({terminal: {}}))).toEqual({gameTarget: TERMINAL});
        expect(chooseGameTarget(WEB_PIXELS, NO_QUERY, USABLE, TERMINAL)).toEqual({gameTarget: WEB_PIXELS});
        expect(chooseGameTarget(undefined, NO_QUERY, UNUSABLE, WINDOW_GPU)).toEqual({gameTarget: WINDOW_PIXELS});
    });

    test("?backend= overrides the remembered target with that backend on the web target; an unknown value is ignored", () => {
        expect(backendOverrideFromQuery("?backend=cells")).toBe("cells");
        expect(backendOverrideFromQuery("?backend=vulkan")).toBeUndefined();
        expect(chooseGameTarget(TERMINAL, "?backend=cells", USABLE)).toEqual({gameTarget: WEB_CELLS});
        expect(chooseGameTarget(TERMINAL, "?backend=vulkan", USABLE)).toEqual({gameTarget: TERMINAL});
        expect(chooseGameTarget(TERMINAL, "?backend=gpu", UNUSABLE)).toEqual({gameTarget: WEB_PIXELS, fallbackReason: UNUSABLE.unusableReason});
    });

    test("the label names the target, and the backend only when the target has more than one", () => {
        expect(gameTargetLabelText(TERMINAL)).toBe("Target: Terminal");
        expect(gameTargetLabelText(WEB_CELLS)).toBe("Target: Web (Cells)");
        expect(gameTargetLabelText(WINDOW_GPU)).toBe("Target: Window (WebGPU)");
    });
});

describe("game target menu", () => {
    test("Terminal is one item, Web and Window are submenus of their backends, and the current target is checked", () => {
        const {items} = menu({current: () => WEB_GPU});
        expect(items.map(item => typeof item === "string" ? item : item.label)).toEqual(["Terminal", "Web", "Window"]);
        const web = named(items, "Web");
        const window = named(items, "Window");
        expect("items" in web && web.items.map(item => typeof item === "string" ? item : item.label)).toEqual(["Cells", "Pixels", "WebGPU"]);
        expect("items" in window && window.items.map(item => typeof item === "string" ? item : item.label)).toEqual(["Pixels", "WebGPU"]);
        expect([web.checked, window.checked, action(items, "Terminal").checked]).toEqual([true, false, false]);
        expect([action(items, "Web", "WebGPU").checked, action(items, "Web", "Pixels").checked]).toEqual([true, false]);
    });

    test("choosing an item hands its target over", () => {
        const {items, chosen} = menu();
        action(items, "Terminal").run();
        action(items, "Window", "WebGPU").run();
        expect(chosen).toEqual([TERMINAL, WINDOW_GPU]);
    });

    test("WebGPU items are disabled with the reason WebGPU is unusable", () => {
        const {items} = menu({webGpu: UNUSABLE});
        for (const path of [["Web", "WebGPU"], ["Window", "WebGPU"]]) {
            const item = action(items, ...path);
            expect([item.disabled, item.title]).toEqual([true, UNUSABLE.unusableReason]);
        }
        expect(action(items, "Web", "Cells").disabled).toBe(false);
    });

    test("without a way to rebuild every other target is disabled with that reason, the current one stays enabled", () => {
        const {items} = menu({switchUnavailableReason: NO_SERVER});
        expect([action(items, "Terminal").disabled, action(items, "Terminal").title]).toEqual([true, NO_SERVER]);
        expect(action(items, "Web", "Pixels").disabled).toBe(false);
    });
});

describe("game target command", () => {
    test("the palette lists every target by name under Target, with the unavailable ones disabled", () => {
        const {registry} = menu({webGpu: UNUSABLE});
        const entries = paletteEntries(registry.all());
        expect(entries.map(entry => `${entry.category}: ${entry.label}`)).toEqual([
            "Target: Terminal", "Target: Web (Cells)", "Target: Web (Pixels)", "Target: Web (WebGPU)", "Target: Window (Pixels)", "Target: Window (WebGPU)",
        ]);
        expect(filterPaletteEntries(entries, "webgpu").map(entry => [entry.label, entry.enabled])).toEqual([["Web (WebGPU)", false], ["Window (WebGPU)", false]]);
        expect(gameTargetName(TERMINAL)).toBe("Terminal");
    });

    test("the menu reads the current target when it is built, so a switch shows on the next open", () => {
        let current = WEB_PIXELS;
        const registry = new CommandRegistry();
        const {menuEntries} = registerGameTargetCommand(registry, {current: () => current, webGpu: USABLE, choose: () => undefined});
        current = TERMINAL;
        const items = menuItemsOf(menuEntries);
        expect([action(items, "Terminal").checked, action(items, "Web", "Pixels").checked, named(items, "Web").checked]).toEqual([true, false, false]);
    });
});
