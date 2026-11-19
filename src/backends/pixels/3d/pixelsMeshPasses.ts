import type {RenderPassCtor} from "../../../engine/rendering/renderPasses";
import {MeshPixelPassSystem} from "./meshPixelPassSystem";

export const PIXELS_MESH_PASSES: readonly RenderPassCtor[] = [MeshPixelPassSystem];
