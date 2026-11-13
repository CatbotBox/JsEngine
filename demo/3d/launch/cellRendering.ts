import {DebugWorld, EntityCommandBufferSystem, System} from "../../../src/engine/core";
import {CellRenderSettings, HudTextSpriteCellPassSystem} from "../../../src/backends/cells";
import {MeshCellPassSettings, MeshCellPassSystem} from "../../../src/backends/cells/3d";
import type {Demo3dRenderControls} from "../game";

function toggle(system: System | undefined): void {
    if (system) system.enabled = !system.enabled;
}

export function installCellRendering3d(world: DebugWorld): Demo3dRenderControls {
    const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
    const settingsEntity = buffer.createEntity("renderSettings", [new CellRenderSettings()]);
    const settings = buffer.addTrackedComponent(settingsEntity, new MeshCellPassSettings());

    world.ensureSystemExists(MeshCellPassSystem);
    world.ensureSystemExists(HudTextSpriteCellPassSystem);

    return {
        toggleMeshPass: () => toggle(world.tryGetSystem(MeshCellPassSystem)),
        toggleHud: () => toggle(world.tryGetSystem(HudTextSpriteCellPassSystem)),
        toggleTextures: () => settings.textures = !settings.textures,
        toggleHalfBlockCells: () => settings.halfBlockCells = !settings.halfBlockCells,
        toggleLod: () => settings.lod = !settings.lod,
        changeLodBias: levels => settings.lodBias += levels,
        setSupersample: (x, y) => {
            settings.supersampleX = x;
            settings.supersampleY = y;
        },
        stats: () => world.tryGetSystem(MeshCellPassSystem),
    };
}
