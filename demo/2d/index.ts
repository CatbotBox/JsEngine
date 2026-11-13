import {DebugWorld} from "../../src/engine";
import {Input} from "../../src/engine/input";
import {consoleOverride} from "../../src/engine/debugging";
import {CellSurfaceResource} from "../../src/backends/cells";
import {nodePlatform, nodeTerminal, TerminalInput} from "../../src/hosts/terminal";
import {fileLogger} from "../../src/hosts/terminal/fileLogger";
import {exitUnlessInteractiveTerminal} from "../_shared/interactiveTerminal";
import {setupDemo2d} from "./game";

exitUnlessInteractiveTerminal("The 2D demo");

consoleOverride.addConsoleEventListener(fileLogger);

const terminal = nodeTerminal();
const world = new DebugWorld({platform: nodePlatform()});
world.resources.insert(new CellSurfaceResource(terminal));
const terminalInput = new TerminalInput({
    terminal,
    platform: world.platform,
    sink: world.resources.getOrCreate(Input),
    mouse: true,
}).start();

setupDemo2d(world, {
    quit: () => {
        terminalInput.stop();
        process.exit(0);
    },
});

world.startLoop()
