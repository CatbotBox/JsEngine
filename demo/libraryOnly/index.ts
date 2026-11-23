import {installCellsBackend} from "@jsengine/backends/cells";
import {CELLS_WORLD_TEXT_PASSES} from "@jsengine/backends/cells/2d";
import {runTerminalGame} from "@jsengine/hosts/terminal";
import {startLibraryOnlyGame} from "./game";

const DEMO_NAME = "The library-only example";

runTerminalGame(DEMO_NAME, async (world, presenter) => {
    installCellsBackend(world, presenter, CELLS_WORLD_TEXT_PASSES);
    await startLibraryOnlyGame(world, {directory: __dirname});
});
