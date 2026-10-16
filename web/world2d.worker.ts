import {DebugWorld} from "../src/js_engine/core";
import {consoleInput} from "../src/js_engine/input";
import {setupDemo2d} from "../demo/2d/game";
import {runWorldWorker} from "./worldWorker";

/** The 2D demo draws its sprites in code; nothing to preload. */
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
