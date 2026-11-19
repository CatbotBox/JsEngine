import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import {HudTextSpriteCellPassSystem} from "./hudTextSpriteCellPassSystem";

export const CELLS_HUD_TEXT_PASSES: readonly RenderPassCtor[] = [HudTextSpriteCellPassSystem];
