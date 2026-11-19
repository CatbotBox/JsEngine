import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import {TextSpritePixelPassSystem} from "./textSpritePixelPassSystem";

export const PIXELS_WORLD_TEXT_PASSES: readonly RenderPassCtor[] = [TextSpritePixelPassSystem];
