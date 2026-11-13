import {DebugWorld, EntityCommandBufferSystem, System} from "../../../src/engine/core";
import {HudTextSpritePixelPassSystem, PixelRenderSettings} from "../../../src/backends/pixels";
import {MeshPixelPassSettings, MeshPixelPassSystem} from "../../../src/backends/pixels/3d";
import type {Demo3dRenderControls} from "../game";

function toggle(system: System | undefined): void {
    if (system) system.enabled = !system.enabled;
}

export function installPixelRendering3d(world: DebugWorld): Demo3dRenderControls {
    const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
    const settingsEntity = buffer.createEntity("renderSettings", [new PixelRenderSettings()]);
    const settings = buffer.addTrackedComponent(settingsEntity, new MeshPixelPassSettings());

    world.ensureSystemExists(MeshPixelPassSystem);
    world.ensureSystemExists(HudTextSpritePixelPassSystem);

    return {
        toggleMeshPass: () => toggle(world.tryGetSystem(MeshPixelPassSystem)),
        toggleHud: () => toggle(world.tryGetSystem(HudTextSpritePixelPassSystem)),
        toggleTextures: () => settings.textures = !settings.textures,
        toggleLod: () => settings.lod = !settings.lod,
        changeLodBias: levels => settings.lodBias += levels,
        setSupersample: (x, y) => {
            settings.supersampleX = x;
            settings.supersampleY = y;
        },
        stats: () => world.tryGetSystem(MeshPixelPassSystem),
    };
}
