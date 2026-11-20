import {installCellsBackend} from "../../src/backends/cells/cellsBackend";
import {CELLS_WORLD_TEXT_PASSES} from "../../src/backends/cells/2d/cellsWorldTextPasses";
import {runTerminalGame} from "../../src/hosts/terminal/terminalGame";
import {startLibraryOnlyGame} from "./game";

const DEMO_NAME = "The library-only example";

runTerminalGame(DEMO_NAME, async (world, presenter) => {
    installCellsBackend(world, presenter, CELLS_WORLD_TEXT_PASSES);
    await startLibraryOnlyGame(world, {directory: __dirname});
});
