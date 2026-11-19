import type {World} from "../../../src/engine/core";
import {installCellsBackend} from "../../../src/backends/cells/cellsBackend";
import type {CellPresenter} from "../../../src/backends/cells/cellPresenter";
import {CELLS_HUD_TEXT_PASSES} from "../../../src/backends/cells/cellsHudTextPasses";
import {CELLS_MESH_PASSES} from "../../../src/backends/cells/3d/cellsMeshPasses";
import {Demo3dCellsControlsSystem} from "../backend/cells/demo3dCellsControlsSystem";

export function installCellRendering3d(world: World, presenter: CellPresenter): void {
    installCellsBackend(world, presenter, [...CELLS_MESH_PASSES, ...CELLS_HUD_TEXT_PASSES]);
    world.ensureSystemExists(Demo3dCellsControlsSystem);
}
