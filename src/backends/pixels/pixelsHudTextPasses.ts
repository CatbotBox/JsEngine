import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import {HudTextSpritePixelPassSystem} from "./hudTextSpritePixelPassSystem";

export const PIXELS_HUD_TEXT_PASSES: readonly RenderPassCtor[] = [HudTextSpritePixelPassSystem];
