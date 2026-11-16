import {EntityQuery, System} from "../../../src/engine/core";
import type {World} from "../../../src/engine/core";
import {HudTextSpriteCellPassSystem} from "../../../src/backends/cells";
import {HudSpriteCellPassSystem, SpriteCellPassSystem, SpriteCellPassSettings} from "../../../src/backends/cells/2d";
import type {Demo2dRenderControls} from "../game";

const INCLUDING_DISABLED = {includeDisabled: true} as const;

function toggle(system: System | undefined): void {
    if (system) system.enabled = !system.enabled;
}

export function installCellRendering2d(world: World): Demo2dRenderControls {
    world.ensureSystemExists(SpriteCellPassSystem);
    world.ensureSystemExists(HudSpriteCellPassSystem);
    world.ensureSystemExists(HudTextSpriteCellPassSystem);
    const settings = new EntityQuery(world, [SpriteCellPassSettings]);

    return {
        toggleSpritePass: () => toggle(world.tryGetSystem(SpriteCellPassSystem)),
        toggleHalfBlockCells: () => settings.stream({write: {settings: SpriteCellPassSettings}}, INCLUDING_DISABLED).consume(({settings}) => {
            settings.halfBlockCells = !settings.halfBlockCells;
        }),
    };
}
