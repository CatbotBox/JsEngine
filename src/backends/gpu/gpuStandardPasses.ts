import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import {PIXELS_2D_AND_HUD_PASSES} from "../pixels/pixelsStandardPasses";
import {GPU_MESH_PASSES} from "./gpuMeshPasses";

export const GPU_STANDARD_PASSES: readonly RenderPassCtor[] = [...GPU_MESH_PASSES, ...PIXELS_2D_AND_HUD_PASSES];
