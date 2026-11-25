import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import {UiCellPassSystem} from "./uiCellPassSystem";

export const CELLS_UI_PASSES: readonly RenderPassCtor[] = [UiCellPassSystem];
