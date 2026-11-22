import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import {HudSpritePixelPassSystem} from "../pixels/2d/hudSpritePixelPassSystem";
import {PIXELS_HUD_SPRITE_PASSES} from "../pixels/2d/pixelsHudSpritePasses";
import {PIXELS_SPRITE_PASSES} from "../pixels/2d/pixelsSpritePasses";
import {SpritePixelPassSystem} from "../pixels/2d/spritePixelPassSystem";
import {HudTextSpritePixelPassSystem} from "../pixels/hudTextSpritePixelPassSystem";
import {PIXELS_HUD_TEXT_PASSES} from "../pixels/pixelsHudTextPasses";
import {PIXELS_WORLD_TEXT_PASSES} from "../pixels/pixelsWorldTextPasses";
import {TextSpritePixelPassSystem} from "../pixels/textSpritePixelPassSystem";
import {GPU_MESH_PASSES} from "./gpuMeshPasses";
import {GpuMeshPassSystem} from "./gpuMeshPassSystem";

export const GPU_PASS_LISTS: readonly (readonly RenderPassCtor[])[] = [
    GPU_MESH_PASSES,
    PIXELS_SPRITE_PASSES,
    PIXELS_WORLD_TEXT_PASSES,
    PIXELS_HUD_SPRITE_PASSES,
    PIXELS_HUD_TEXT_PASSES,
];

export const GPU_STANDARD_PASSES: readonly RenderPassCtor[] = [
    GpuMeshPassSystem,
    SpritePixelPassSystem,
    TextSpritePixelPassSystem,
    HudSpritePixelPassSystem,
    HudTextSpritePixelPassSystem,
];
