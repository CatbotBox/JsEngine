import type {World} from "../../../src/engine/core";
import {installCellsBackend} from "../../../src/backends/cells/cellsBackend";
import type {CellPresenter} from "../../../src/backends/cells/cellPresenter";
import {CELLS_HUD_TEXT_PASSES} from "../../../src/backends/cells/cellsHudTextPasses";
import {CELLS_SPRITE_PASSES} from "../../../src/backends/cells/2d/cellsSpritePasses";
import {CELLS_HUD_SPRITE_PASSES} from "../../../src/backends/cells/2d/cellsHudSpritePasses";
import {Demo2dCellsControlsSystem} from "../backend/cells/demo2dCellsControlsSystem";

export function installCellRendering2d(world: World, presenter: CellPresenter): void {
    installCellsBackend(world, presenter, [...CELLS_SPRITE_PASSES, ...CELLS_HUD_SPRITE_PASSES, ...CELLS_HUD_TEXT_PASSES]);
    world.ensureSystemExists(Demo2dCellsControlsSystem);
}
