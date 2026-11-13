import {DebugWorld, EntityCommandBufferSystem, System} from "../../../src/engine/core";
import {HudTextSpriteCellPassSystem} from "../../../src/backends/cells";
import {HudSpriteCellPassSystem, SpriteCellPassSystem, TextSpriteCellPassSettings} from "../../../src/backends/cells/2d";
import type {Demo2dRenderControls} from "../game";

function toggle(system: System | undefined): void {
    if (system) system.enabled = !system.enabled;
}

export function installCellRendering2d(world: DebugWorld): Demo2dRenderControls {
    const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
    const settingsEntity = buffer.createEntity("2dRenderSettings");
    const renderSettings = buffer.addTrackedComponent(settingsEntity, new TextSpriteCellPassSettings());

    world.ensureSystemExists(SpriteCellPassSystem);
    world.ensureSystemExists(HudSpriteCellPassSystem);
    world.ensureSystemExists(HudTextSpriteCellPassSystem);

    return {
        toggleSpritePass: () => toggle(world.tryGetSystem(SpriteCellPassSystem)),
        toggleHalfBlockCells: () => renderSettings.halfBlockCells = !renderSettings.halfBlockCells,
    };
}
