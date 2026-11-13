import {EntityCommandBufferSystem, System, World} from "../../../src/engine/core";
import {HudTextSpritePixelPassSystem} from "../../../src/backends/pixels";
import {SpritePixelPassSettings, SpritePixelPassSystem} from "../../../src/backends/pixels/2d";
import type {SwarmRenderControls} from "../game";

function toggle(system: System | undefined): void {
    if (system) system.enabled = !system.enabled;
}

export function installPixelRenderingSwarm(world: World): SwarmRenderControls {
    const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
    buffer.createEntity("swarmRenderSettings", [new SpritePixelPassSettings()]);

    world.ensureSystemExists(SpritePixelPassSystem);
    world.ensureSystemExists(HudTextSpritePixelPassSystem);

    return {
        toggleHud: () => toggle(world.tryGetSystem(HudTextSpritePixelPassSystem)),
    };
}
