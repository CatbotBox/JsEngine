import {DebugWorld, EntityCommandBufferSystem, System} from "../../../src/engine/core";
import {HudTextSpritePixelPassSystem, PixelRenderSettings} from "../../../src/backends/pixels";
import {
    GpuMeshPassSettings,
    GpuMeshPassSystem,
    LINEAR_TEXTURE_FILTERING,
    MULTISAMPLE_COUNT,
    NEAREST_TEXTURE_FILTERING,
    SINGLE_SAMPLE_COUNT,
} from "../../../src/backends/gpu";
import type {Demo3dRenderControls} from "../game";

const SINGLE_SAMPLE_PER_PIXEL = 1;

function toggle(system: System | undefined): void {
    if (system) system.enabled = !system.enabled;
}

export function installGpuRendering3d(world: DebugWorld): Demo3dRenderControls {
    const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
    const settingsEntity = buffer.createEntity("renderSettings", [new PixelRenderSettings()]);
    const settings = buffer.addTrackedComponent(settingsEntity, new GpuMeshPassSettings());

    world.ensureSystemExists(GpuMeshPassSystem);
    world.ensureSystemExists(HudTextSpritePixelPassSystem);

    return {
        toggleMeshPass: () => toggle(world.tryGetSystem(GpuMeshPassSystem)),
        toggleHud: () => toggle(world.tryGetSystem(HudTextSpritePixelPassSystem)),
        toggleTextures: () => settings.textures = !settings.textures,
        toggleTextureFiltering: () => {
            settings.textureFiltering = settings.textureFiltering === LINEAR_TEXTURE_FILTERING ? NEAREST_TEXTURE_FILTERING : LINEAR_TEXTURE_FILTERING;
        },
        toggleLod: () => settings.lod = !settings.lod,
        changeLodBias: levels => settings.lodBias += levels,
        setSupersample: (x, y) => {
            settings.sampleCount = x * y > SINGLE_SAMPLE_PER_PIXEL ? MULTISAMPLE_COUNT : SINGLE_SAMPLE_COUNT;
        },
        stats: () => world.tryGetSystem(GpuMeshPassSystem),
    };
}
