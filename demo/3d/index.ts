import {DebugWorld} from "../../src/engine";
import {Input} from "../../src/engine/input";
import {consoleOverride} from "../../src/engine/debugging";
import {CellPresenterResource} from "../../src/backends/cells";
import {AnsiCellPresenter, nodePlatform, nodeTerminal, TerminalInput} from "../../src/hosts/terminal";
import {fileLogger} from "../../src/hosts/terminal/fileLogger";
import {exitUnlessInteractiveTerminal} from "../_shared/interactiveTerminal";
import {setupDemo3d} from "./game";
import {findDemoModels} from "./models";
import {installCellRendering3d} from "./launch/cellRendering";

exitUnlessInteractiveTerminal("The 3D demo");

consoleOverride.addConsoleEventListener(fileLogger);

const terminal = nodeTerminal();
const world = new DebugWorld({platform: nodePlatform()});
world.resources.insert(new CellPresenterResource(new AnsiCellPresenter(terminal)));
const terminalInput = new TerminalInput({
    terminal,
    platform: world.platform,
    sink: world.resources.getOrCreate(Input),
    mouse: true,
    hideCursor: true,
}).start();

setupDemo3d(world, {
    render: installCellRendering3d(world),
    listModels: () => findDemoModels(),
    quit: () => {
        terminalInput.stop();
        process.exit(0);
    },
});

world.startLoop()
