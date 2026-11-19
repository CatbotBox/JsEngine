import type {RenderPassCtor} from "../../../engine/rendering/renderPasses";
import {SpriteCellPassSystem} from "./spriteCellPassSystem";

export const CELLS_SPRITE_PASSES: readonly RenderPassCtor[] = [SpriteCellPassSystem];
