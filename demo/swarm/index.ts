import {DebugWorld} from "../../src/engine";
import {Input} from "../../src/engine/input";
import {consoleOverride} from "../../src/engine/debugging";
import {CellPresenterResource} from "../../src/backends/cells";
import {AnsiCellPresenter, nodePlatform, nodeTerminal, TerminalInput} from "../../src/hosts/terminal";
import {fileLogger} from "../../src/hosts/terminal/fileLogger";
import {exitUnlessInteractiveTerminal} from "../_shared/interactiveTerminal";
import {setupSwarm} from "./game";
import {installCellRenderingSwarm} from "./launch/cellRendering";

exitUnlessInteractiveTerminal("Swarm");

consoleOverride.addConsoleEventListener(fileLogger);

const terminal = nodeTerminal();
const world = new DebugWorld({platform: nodePlatform()});
world.resources.insert(new CellPresenterResource(new AnsiCellPresenter(terminal)));
const terminalInput = new TerminalInput({
    terminal,
    platform: world.platform,
    sink: world.resources.getOrCreate(Input),
    mouse: false,
}).start();

setupSwarm(world, {
    render: installCellRenderingSwarm(world),
    quit: () => {
        terminalInput.stop();
        process.exit(0);
    },
});

world.startLoop();
