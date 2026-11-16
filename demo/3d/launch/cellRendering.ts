import {EntityQuery, System} from "../../../src/engine/core";
import type {World} from "../../../src/engine/core";
import {HudTextSpriteCellPassSystem} from "../../../src/backends/cells";
import {MeshCellPassSettings, MeshCellPassSystem} from "../../../src/backends/cells/3d";
import type {Demo3dRenderControls} from "../game";

const INCLUDING_DISABLED = {includeDisabled: true} as const;

function toggle(system: System | undefined): void {
    if (system) system.enabled = !system.enabled;
}

export function installCellRendering3d(world: World): Demo3dRenderControls {
    world.ensureSystemExists(MeshCellPassSystem);
    world.ensureSystemExists(HudTextSpriteCellPassSystem);
    const settingsQuery = new EntityQuery(world, [MeshCellPassSettings]);
    const change = (apply: (settings: MeshCellPassSettings) => void) =>
        settingsQuery.stream({write: {settings: MeshCellPassSettings}}, INCLUDING_DISABLED).consume(({settings}) => apply(settings));

    return {
        toggleMeshPass: () => toggle(world.tryGetSystem(MeshCellPassSystem)),
        toggleHud: () => toggle(world.tryGetSystem(HudTextSpriteCellPassSystem)),
        toggleTextures: () => change(settings => settings.textures = !settings.textures),
        toggleHalfBlockCells: () => change(settings => settings.halfBlockCells = !settings.halfBlockCells),
        toggleLod: () => change(settings => settings.lod = !settings.lod),
        changeLodBias: levels => change(settings => settings.lodBias += levels),
        setSupersample: (x, y) => change(settings => {
            settings.supersampleX = x;
            settings.supersampleY = y;
        }),
        stats: () => world.tryGetSystem(MeshCellPassSystem),
    };
}
