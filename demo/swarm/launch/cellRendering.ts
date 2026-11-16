import {System, World} from "../../../src/engine/core";
import {HudTextSpriteCellPassSystem} from "../../../src/backends/cells";
import {SpriteCellPassSystem} from "../../../src/backends/cells/2d";
import type {SwarmRenderControls} from "../game";

function toggle(system: System | undefined): void {
    if (system) system.enabled = !system.enabled;
}

export function installCellRenderingSwarm(world: World): SwarmRenderControls {
    world.ensureSystemExists(SpriteCellPassSystem);
    world.ensureSystemExists(HudTextSpriteCellPassSystem);

    return {
        toggleHud: () => toggle(world.tryGetSystem(HudTextSpriteCellPassSystem)),
    };
}
