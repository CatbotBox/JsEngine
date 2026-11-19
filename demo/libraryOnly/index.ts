import {DebugWorld} from "../../src/engine/core";
import {Input} from "../../src/engine/input";
import {CellPresenterResource} from "../../src/backends/cells";
import {TextSpriteCellPassSystem} from "../../src/backends/cells/2d";
import {AnsiCellPresenter, nodePlatform, nodeTerminal, TerminalInput} from "../../src/hosts/terminal";
import {exitAfterLaunchFailure, exitUnlessInteractiveTerminal} from "../_shared/interactiveTerminal";
import {startLibraryOnlyGame} from "./game";

const DEMO_NAME = "The library-only example";

exitUnlessInteractiveTerminal(DEMO_NAME);

const terminal = nodeTerminal();
const world = new DebugWorld({platform: nodePlatform()});
world.resources.insert(new CellPresenterResource(new AnsiCellPresenter(terminal)));
world.ensureSystemExists(TextSpriteCellPassSystem);
const terminalInput = new TerminalInput({
    terminal,
    platform: world.platform,
    sink: world.resources.getOrCreate(Input),
    mouse: false,
});

startLibraryOnlyGame(world, {
    directory: __dirname,
    quit: () => {
        terminalInput.stop();
        process.exit(0);
    },
}).then(() => {
    world.startLoop();
    terminalInput.start();
}, error => exitAfterLaunchFailure(DEMO_NAME, error));
