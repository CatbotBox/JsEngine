import type {RenderPassCtor} from "../../../engine/rendering/renderPasses";
import {SpritePixelPassSystem} from "./spritePixelPassSystem";

export const PIXELS_SPRITE_PASSES: readonly RenderPassCtor[] = [SpritePixelPassSystem];
