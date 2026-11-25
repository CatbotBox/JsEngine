import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import {HudSpritePixelPassSystem} from "./2d/hudSpritePixelPassSystem";
import {PIXELS_HUD_SPRITE_PASSES} from "./2d/pixelsHudSpritePasses";
import {PIXELS_SPRITE_PASSES} from "./2d/pixelsSpritePasses";
import {SpritePixelPassSystem} from "./2d/spritePixelPassSystem";
import {MeshPixelPassSystem} from "./3d/meshPixelPassSystem";
import {PIXELS_MESH_PASSES} from "./3d/pixelsMeshPasses";
import {HudTextSpritePixelPassSystem} from "./hudTextSpritePixelPassSystem";
import {PIXELS_HUD_TEXT_PASSES} from "./pixelsHudTextPasses";
import {PIXELS_UI_PASSES} from "./pixelsUiPasses";
import {PIXELS_WORLD_TEXT_PASSES} from "./pixelsWorldTextPasses";
import {TextSpritePixelPassSystem} from "./textSpritePixelPassSystem";
import {UiPixelPassSystem} from "./uiPixelPassSystem";

export const PIXELS_PASS_LISTS: readonly (readonly RenderPassCtor[])[] = [
    PIXELS_MESH_PASSES,
    PIXELS_SPRITE_PASSES,
    PIXELS_WORLD_TEXT_PASSES,
    PIXELS_HUD_SPRITE_PASSES,
    PIXELS_HUD_TEXT_PASSES,
    PIXELS_UI_PASSES,
];

export const PIXELS_2D_AND_HUD_PASSES: readonly RenderPassCtor[] = [
    SpritePixelPassSystem,
    TextSpritePixelPassSystem,
    HudSpritePixelPassSystem,
    HudTextSpritePixelPassSystem,
    UiPixelPassSystem,
];

export const PIXELS_STANDARD_PASSES: readonly RenderPassCtor[] = [
    MeshPixelPassSystem,
    SpritePixelPassSystem,
    TextSpritePixelPassSystem,
    HudSpritePixelPassSystem,
    HudTextSpritePixelPassSystem,
    UiPixelPassSystem,
];
