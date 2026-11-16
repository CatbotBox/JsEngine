import {EntityQuery, System} from "../../../src/engine/core";
import type {World} from "../../../src/engine/core";
import {HudTextSpritePixelPassSystem} from "../../../src/backends/pixels";
import {MeshPixelPassSettings, MeshPixelPassSystem} from "../../../src/backends/pixels/3d";
import type {Demo3dRenderControls} from "../game";

const INCLUDING_DISABLED = {includeDisabled: true} as const;

function toggle(system: System | undefined): void {
    if (system) system.enabled = !system.enabled;
}

export function installPixelRendering3d(world: World): Demo3dRenderControls {
    world.ensureSystemExists(MeshPixelPassSystem);
    world.ensureSystemExists(HudTextSpritePixelPassSystem);
    const settingsQuery = new EntityQuery(world, [MeshPixelPassSettings]);
    const change = (apply: (settings: MeshPixelPassSettings) => void) =>
        settingsQuery.stream({write: {settings: MeshPixelPassSettings}}, INCLUDING_DISABLED).consume(({settings}) => apply(settings));

    return {
        toggleMeshPass: () => toggle(world.tryGetSystem(MeshPixelPassSystem)),
        toggleHud: () => toggle(world.tryGetSystem(HudTextSpritePixelPassSystem)),
        toggleTextures: () => change(settings => settings.textures = !settings.textures),
        toggleLod: () => change(settings => settings.lod = !settings.lod),
        changeLodBias: levels => change(settings => settings.lodBias += levels),
        setSupersample: (x, y) => change(settings => {
            settings.supersampleX = x;
            settings.supersampleY = y;
        }),
        stats: () => world.tryGetSystem(MeshPixelPassSystem),
    };
}
