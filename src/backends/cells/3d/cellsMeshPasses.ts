import type {RenderPassCtor} from "../../../engine/rendering/renderPasses";
import {MeshCellPassSystem} from "./meshCellPassSystem";

export const CELLS_MESH_PASSES: readonly RenderPassCtor[] = [MeshCellPassSystem];
