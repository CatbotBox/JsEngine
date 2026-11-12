import {DebugWorld} from "../../src/js_engine";
import {consoleOverride} from "../../src/js_engine/debugging";
import {fileLogger} from "../../src/js_engine/debugging/fileLogger";
import {setupDemo2d} from "./game";

consoleOverride.addConsoleEventListener(fileLogger);

const world = new DebugWorld();

setupDemo2d(world, {
    quit: () => process.exit(0),
});

world.startLoop()
