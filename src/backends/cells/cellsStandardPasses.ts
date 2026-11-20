import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import {CELLS_HUD_SPRITE_PASSES} from "./2d/cellsHudSpritePasses";
import {CELLS_SPRITE_PASSES} from "./2d/cellsSpritePasses";
import {CELLS_WORLD_TEXT_PASSES} from "./2d/cellsWorldTextPasses";
import {CELLS_MESH_PASSES} from "./3d/cellsMeshPasses";
import {CELLS_HUD_TEXT_PASSES} from "./cellsHudTextPasses";

export const CELLS_STANDARD_PASSES: readonly RenderPassCtor[] = [
    ...CELLS_MESH_PASSES,
    ...CELLS_SPRITE_PASSES,
    ...CELLS_WORLD_TEXT_PASSES,
    ...CELLS_HUD_SPRITE_PASSES,
    ...CELLS_HUD_TEXT_PASSES,
];
