import {DebugWorld} from "../../src/engine";
import {consoleOverride} from "../../src/engine/debugging";
import {CellSurfaceResource} from "../../src/backends/cells";
import {nodePlatform, nodeTerminal} from "../../src/hosts/terminal";
import {fileLogger} from "../../src/hosts/terminal/fileLogger";
import {exitUnlessInteractiveTerminal} from "../_shared/interactiveTerminal";
import {setupDemo2d} from "./game";

exitUnlessInteractiveTerminal("The 2D demo");

consoleOverride.addConsoleEventListener(fileLogger);

const terminal = nodeTerminal();
const world = new DebugWorld({platform: nodePlatform()});
world.resources.insert(new CellSurfaceResource(terminal));

setupDemo2d(world, {
    terminal,
    quit: () => process.exit(0),
});

world.startLoop()
