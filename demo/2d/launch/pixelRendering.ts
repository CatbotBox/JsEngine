import {System} from "../../../src/engine/core";
import type {World} from "../../../src/engine/core";
import {HudTextSpritePixelPassSystem} from "../../../src/backends/pixels";
import {HudSpritePixelPassSystem, SpritePixelPassSystem} from "../../../src/backends/pixels/2d";
import type {Demo2dRenderControls} from "../game";

function toggle(system: System | undefined): void {
    if (system) system.enabled = !system.enabled;
}

export function installPixelRendering2d(world: World): Demo2dRenderControls {
    world.ensureSystemExists(SpritePixelPassSystem);
    world.ensureSystemExists(HudSpritePixelPassSystem);
    world.ensureSystemExists(HudTextSpritePixelPassSystem);

    return {
        toggleSpritePass: () => toggle(world.tryGetSystem(SpritePixelPassSystem)),
    };
}
