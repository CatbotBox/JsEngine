import {DebugWorld} from "../../src/engine";
import {consoleOverride} from "../../src/engine/debugging";
import {CellSurfaceResource} from "../../src/backends/cells";
import {nodePlatform, nodeTerminal} from "../../src/hosts/terminal";
import {fileLogger} from "../../src/hosts/terminal/fileLogger";
import {exitUnlessInteractiveTerminal} from "../_shared/interactiveTerminal";
import {setupDemo3d} from "./game";
import {findDemoModels} from "./models";

exitUnlessInteractiveTerminal("The 3D demo");

consoleOverride.addConsoleEventListener(fileLogger);

const terminal = nodeTerminal();
const world = new DebugWorld({platform: nodePlatform()});
world.resources.insert(new CellSurfaceResource(terminal));

setupDemo3d(world, {
    terminal,
    listModels: () => findDemoModels(),
    quit: () => process.exit(0),
});

world.startLoop()
