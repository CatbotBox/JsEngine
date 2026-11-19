import type {RenderPassCtor} from "../../../engine/rendering/renderPasses";
import {TextSpriteCellPassSystem} from "./textSpriteCellPassSystem";

export const CELLS_WORLD_TEXT_PASSES: readonly RenderPassCtor[] = [TextSpriteCellPassSystem];
