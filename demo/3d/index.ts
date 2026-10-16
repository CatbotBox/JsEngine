import {DebugWorld} from "../../src/js_engine";
import {consoleOverride} from "../../src/js_engine/debugging";
import {fileLogger} from "../../src/js_engine/debugging/fileLogger";
import {setupDemo3d} from "./game";
import {findDemoModels} from "./models";

// The renderer owns the terminal, so console output is only readable in ./logs.
consoleOverride.addConsoleEventListener(fileLogger);

const world = new DebugWorld();

setupDemo3d(world, {
    listModels: () => findDemoModels(),
    quit: () => process.exit(0),
});

world.startLoop()
