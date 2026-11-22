import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import {CELLS_HUD_SPRITE_PASSES} from "./2d/cellsHudSpritePasses";
import {CELLS_SPRITE_PASSES} from "./2d/cellsSpritePasses";
import {CELLS_WORLD_TEXT_PASSES} from "./2d/cellsWorldTextPasses";
import {HudSpriteCellPassSystem} from "./2d/hudSpriteCellPassSystem";
import {SpriteCellPassSystem} from "./2d/spriteCellPassSystem";
import {TextSpriteCellPassSystem} from "./2d/textSpriteCellPassSystem";
import {CELLS_MESH_PASSES} from "./3d/cellsMeshPasses";
import {MeshCellPassSystem} from "./3d/meshCellPassSystem";
import {CELLS_HUD_TEXT_PASSES} from "./cellsHudTextPasses";
import {HudTextSpriteCellPassSystem} from "./hudTextSpriteCellPassSystem";

export const CELLS_PASS_LISTS: readonly (readonly RenderPassCtor[])[] = [
    CELLS_MESH_PASSES,
    CELLS_SPRITE_PASSES,
    CELLS_WORLD_TEXT_PASSES,
    CELLS_HUD_SPRITE_PASSES,
    CELLS_HUD_TEXT_PASSES,
];

export const CELLS_STANDARD_PASSES: readonly RenderPassCtor[] = [
    MeshCellPassSystem,
    SpriteCellPassSystem,
    TextSpriteCellPassSystem,
    HudSpriteCellPassSystem,
    HudTextSpriteCellPassSystem,
];
