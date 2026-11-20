import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import {PIXELS_HUD_SPRITE_PASSES} from "./2d/pixelsHudSpritePasses";
import {PIXELS_SPRITE_PASSES} from "./2d/pixelsSpritePasses";
import {PIXELS_MESH_PASSES} from "./3d/pixelsMeshPasses";
import {PIXELS_HUD_TEXT_PASSES} from "./pixelsHudTextPasses";
import {PIXELS_WORLD_TEXT_PASSES} from "./pixelsWorldTextPasses";

export const PIXELS_2D_AND_HUD_PASSES: readonly RenderPassCtor[] = [
    ...PIXELS_SPRITE_PASSES,
    ...PIXELS_WORLD_TEXT_PASSES,
    ...PIXELS_HUD_SPRITE_PASSES,
    ...PIXELS_HUD_TEXT_PASSES,
];

export const PIXELS_STANDARD_PASSES: readonly RenderPassCtor[] = [...PIXELS_MESH_PASSES, ...PIXELS_2D_AND_HUD_PASSES];
