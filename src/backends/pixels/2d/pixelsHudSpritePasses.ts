import type {RenderPassCtor} from "../../../engine/rendering/renderPasses";
import {HudSpritePixelPassSystem} from "./hudSpritePixelPassSystem";

export const PIXELS_HUD_SPRITE_PASSES: readonly RenderPassCtor[] = [HudSpritePixelPassSystem];
