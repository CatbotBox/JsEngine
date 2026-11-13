import {EntityCommandBufferSystem, System, World} from "../../../src/engine/core";
import {HudTextSpriteCellPassSystem} from "../../../src/backends/cells";
import {SpriteCellPassSystem, TextSpriteCellPassSettings} from "../../../src/backends/cells/2d";
import type {SwarmRenderControls} from "../game";

function toggle(system: System | undefined): void {
    if (system) system.enabled = !system.enabled;
}

export function installCellRenderingSwarm(world: World): SwarmRenderControls {
    const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
    buffer.createEntity("swarmRenderSettings", [new TextSpriteCellPassSettings()]);

    world.ensureSystemExists(SpriteCellPassSystem);
    world.ensureSystemExists(HudTextSpriteCellPassSystem);

    return {
        toggleHud: () => toggle(world.tryGetSystem(HudTextSpriteCellPassSystem)),
    };
}
