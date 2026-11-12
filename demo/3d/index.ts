import {DebugWorld} from "../../src/engine";
import {consoleOverride} from "../../src/engine/debugging";
import {fileLogger} from "../../src/hosts/terminal/fileLogger";
import {exitUnlessInteractiveTerminal} from "../_shared/interactiveTerminal";
import {setupDemo3d} from "./game";
import {findDemoModels} from "./models";

exitUnlessInteractiveTerminal("The 3D demo");

consoleOverride.addConsoleEventListener(fileLogger);

const world = new DebugWorld();

setupDemo3d(world, {
    listModels: () => findDemoModels(),
    quit: () => process.exit(0),
});

world.startLoop()
