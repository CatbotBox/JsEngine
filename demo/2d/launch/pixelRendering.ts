import {DebugWorld, EntityCommandBufferSystem, System} from "../../../src/engine/core";
import {HudTextSpritePixelPassSystem} from "../../../src/backends/pixels";
import {HudSpritePixelPassSystem, SpritePixelPassSettings, SpritePixelPassSystem} from "../../../src/backends/pixels/2d";
import type {Demo2dRenderControls} from "../game";

function toggle(system: System | undefined): void {
    if (system) system.enabled = !system.enabled;
}

export function installPixelRendering2d(world: DebugWorld): Demo2dRenderControls {
    const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
    buffer.createEntity("2dRenderSettings", [new SpritePixelPassSettings()]);

    world.ensureSystemExists(SpritePixelPassSystem);
    world.ensureSystemExists(HudSpritePixelPassSystem);
    world.ensureSystemExists(HudTextSpritePixelPassSystem);

    return {
        toggleSpritePass: () => toggle(world.tryGetSystem(SpritePixelPassSystem)),
    };
}
