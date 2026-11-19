import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import {GpuMeshPassSystem} from "./gpuMeshPassSystem";

export const GPU_MESH_PASSES: readonly RenderPassCtor[] = [GpuMeshPassSystem];
