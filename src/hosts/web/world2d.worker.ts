import {DebugWorld} from "../../engine/core";
import {consoleInput} from "../../engine/input";
import {setupDemo2d} from "../../../demo/2d/game";
import {runWorldWorker} from "./worldWorker";

runWorldWorker(page => {
    const world = new DebugWorld({platform: page.platform});
    setupDemo2d(world, {
        quit: () => {
            consoleInput.disable();
            page.quit();
        },
    });
    world.startLoop();
});
