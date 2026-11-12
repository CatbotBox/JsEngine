import {DebugWorld} from "../../engine/core";
import {consoleInput} from "../../engine/input";
import {CellSurfaceResource} from "../../backends/cells";
import {setupDemo2d} from "../../../demo/2d/game";
import {runWorldWorker} from "./worldWorker";

runWorldWorker(page => {
    const world = new DebugWorld({platform: page.platform});
    world.resources.insert(new CellSurfaceResource(page.terminal));
    setupDemo2d(world, {
        terminal: page.terminal,
        quit: () => {
            consoleInput.disable();
            page.quit();
        },
    });
    world.startLoop();
});
