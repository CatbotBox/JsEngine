import type {RenderPassCtor} from "../../../engine/rendering/renderPasses";
import {HudSpriteCellPassSystem} from "./hudSpriteCellPassSystem";

export const CELLS_HUD_SPRITE_PASSES: readonly RenderPassCtor[] = [HudSpriteCellPassSystem];
