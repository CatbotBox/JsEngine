import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import {UiPixelPassSystem} from "./uiPixelPassSystem";

export const PIXELS_UI_PASSES: readonly RenderPassCtor[] = [UiPixelPassSystem];
