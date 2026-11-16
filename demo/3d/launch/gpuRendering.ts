import {EntityQuery, System} from "../../../src/engine/core";
import type {World} from "../../../src/engine/core";
import {HudTextSpritePixelPassSystem} from "../../../src/backends/pixels";
import {
    GpuMeshPassSettings,
    GpuMeshPassSystem,
    LINEAR_TEXTURE_FILTERING,
    MULTISAMPLE_COUNT,
    NEAREST_TEXTURE_FILTERING,
    SINGLE_SAMPLE_COUNT,
} from "../../../src/backends/gpu";
import type {Demo3dRenderControls} from "../game";
import {DemoSurfaceShaderSystem} from "./gpuSurfaceShaders";

const SINGLE_SAMPLE_PER_PIXEL = 1;

const INCLUDING_DISABLED = {includeDisabled: true} as const;

function toggle(system: System | undefined): void {
    if (system) system.enabled = !system.enabled;
}

export function installGpuRendering3d(world: World): Demo3dRenderControls {
    world.ensureSystemExists(GpuMeshPassSystem);
    world.ensureSystemExists(HudTextSpritePixelPassSystem);
    world.ensureSystemExists(DemoSurfaceShaderSystem);
    const settingsQuery = new EntityQuery(world, [GpuMeshPassSettings]);
    const change = (apply: (settings: GpuMeshPassSettings) => void) =>
        settingsQuery.stream({write: {settings: GpuMeshPassSettings}}, INCLUDING_DISABLED).consume(({settings}) => apply(settings));

    return {
        toggleMeshPass: () => toggle(world.tryGetSystem(GpuMeshPassSystem)),
        toggleHud: () => toggle(world.tryGetSystem(HudTextSpritePixelPassSystem)),
        toggleTextures: () => change(settings => settings.textures = !settings.textures),
        toggleTextureFiltering: () => change(settings => {
            settings.textureFiltering = settings.textureFiltering === LINEAR_TEXTURE_FILTERING ? NEAREST_TEXTURE_FILTERING : LINEAR_TEXTURE_FILTERING;
        }),
        toggleLod: () => change(settings => settings.lod = !settings.lod),
        changeLodBias: levels => change(settings => settings.lodBias += levels),
        setSupersample: (x, y) => change(settings => {
            settings.sampleCount = x * y > SINGLE_SAMPLE_PER_PIXEL ? MULTISAMPLE_COUNT : SINGLE_SAMPLE_COUNT;
        }),
        cycleSurfaceShader: () => world.tryGetSystem(DemoSurfaceShaderSystem)?.cycle(),
        stats: () => world.tryGetSystem(GpuMeshPassSystem),
    };
}
